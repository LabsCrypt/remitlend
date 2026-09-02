import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { query } from '../db/connection.js';
import { sorobanService } from '../services/sorobanService.js';
import { fromStroops, MoneyError } from '../money/decimal.js';

/**
 * `contract_events.amount` is a Postgres `NUMERIC` column holding an integer
 * stroop count as a string (eventIndexer.ts writes `bigint.toString()`; see
 * `decodeAmount` in `services/eventIndexer.ts`). `NUMERIC` does not itself
 * forbid a fractional value, so parse defensively: accept an optional
 * all-zero fractional part (e.g. Postgres formatting `150.0`) but reject any
 * genuinely fractional stroop amount rather than silently truncating it.
 */
function parseEventAmountStroops(raw: string | null | undefined): bigint {
  if (!raw) return 0n;
  const [wholeRaw, fraction = ''] = raw.split('.');
  const whole = wholeRaw && wholeRaw.length > 0 ? wholeRaw : '0';
  if (fraction.length > 0 && /[1-9]/.test(fraction)) {
    throw new MoneyError(`contract_events.amount must be an integer stroop count, got "${raw}"`);
  }
  return BigInt(whole);
}

export const getRemittanceHistory = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;

  // 1. Fetch current score from database
  const scoreResult = await query('SELECT score FROM scores WHERE borrower = $1', [userId]);
  const score = scoreResult.rows[0]?.score ?? scoreResult.rows[0]?.current_score ?? 500;

  // 2. Fetch all repayment and default events for history calculation
  const eventsResult = await query(
    `SELECT event_type, amount, ledger_closed_at
       FROM contract_events
       WHERE address = $1 AND event_type IN ('LoanRepaid', 'LoanDefaulted')
       ORDER BY ledger_closed_at ASC`,
    [userId],
  );

  const events = eventsResult.rows;

  // 3. Group by month for display. Accrue in stroops (bigint) so repeated
  // `+=` across many repayments never accumulates float drift — previously
  // this summed `parseFloat(amount) / 10000000` per event, which both loses
  // sub-stroop precision per event and compounds float rounding error across
  // the reduce. The exact stroop total is only converted to a display string
  // once, at the end, via the shared money policy (backend/src/money/decimal.ts).
  const historyStroops = new Map<
    string,
    { month: string; amountStroops: bigint; status: string }
  >();

  for (const e of events) {
    const date = new Date(e.ledger_closed_at);
    const monthYear = date.toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });
    const month = date.toLocaleString('en-US', { month: 'long' });

    const existing = historyStroops.get(monthYear);
    if (e.event_type === 'LoanRepaid') {
      const eventStroops = parseEventAmountStroops(e.amount);
      if (existing) {
        existing.amountStroops += eventStroops;
      } else {
        historyStroops.set(monthYear, {
          month,
          amountStroops: eventStroops,
          status: 'Completed',
        });
      }
    } else if (e.event_type === 'LoanDefaulted') {
      if (existing) {
        existing.status = 'Defaulted';
      } else {
        historyStroops.set(monthYear, { month, amountStroops: 0n, status: 'Defaulted' });
      }
    }
  }

  const historyMap = new Map(
    Array.from(historyStroops.entries()).map(([key, { month, amountStroops, status }]) => [
      key,
      { month, amount: Number(fromStroops(amountStroops)), status },
    ]),
  );

  const history = Array.from(historyMap.values()).slice(-6);

  // 4. Calculate streak (consecutive "Completed" months from history)
  //    Check calendar month continuity so gaps between non-adjacent months
  //    are not counted as part of the streak.
  let streak = 0;
  const historyReverse = Array.from(historyMap.entries()).reverse();
  let prevDate: Date | null = null;

  for (const [key, h] of historyReverse) {
    if (h.status === 'Completed') {
      const parts = key.split(' ');
      if (parts.length < 2) break;
      const [monthName, yearStr] = parts as [string, string];
      const monthNum = new Date(`${monthName} 1, ${yearStr}`).getMonth();
      const yearNum = parseInt(yearStr, 10);
      const currentDate = new Date(yearNum, monthNum);

      if (prevDate) {
        const diffMonths =
          (prevDate.getFullYear() - currentDate.getFullYear()) * 12 +
          (prevDate.getMonth() - currentDate.getMonth());
        if (diffMonths !== 1) break;
      }
      prevDate = currentDate;
      streak++;
    } else if (h.status === 'Defaulted') {
      break;
    }
  }

  res.json({
    userId,
    score,
    streak,
    history,
  });
});

export const simulatePayment = asyncHandler(async (req: Request, res: Response) => {
  const { amount } = req.body;
  const userId = req.user!.publicKey;

  // Fetch current score
  const scoreResult = await query('SELECT score FROM scores WHERE borrower = $1', [userId]);
  const currentScore = scoreResult.rows[0]?.score ?? scoreResult.rows[0]?.current_score ?? 500;

  const { repaymentDelta } = sorobanService.getScoreConfig();
  const newScore = Math.min(850, currentScore + repaymentDelta);

  res.json({
    success: true,
    message: `A payment of ${amount} would increase your estimated credit score from ${currentScore} to ${newScore}.`,
    newScore,
  });
});
