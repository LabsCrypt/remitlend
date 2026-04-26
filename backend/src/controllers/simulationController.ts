import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { query } from "../db/connection.js";

export const getRemittanceHistory = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.params;

    // 1. Fetch current score from database
    const scoreResult = await query(
      "SELECT current_score FROM scores WHERE user_id = $1",
      [userId],
    );
    const score = scoreResult.rows[0]?.current_score ?? 500;

    // 2. Fetch all repayment and default events for history calculation
    const eventsResult = await query(
      `SELECT event_type, amount, ledger_closed_at 
       FROM contract_events 
       WHERE address = $1 AND event_type IN ('LoanRepaid', 'LoanDefaulted')
       ORDER BY ledger_closed_at ASC`,
      [userId],
    );

    const events = eventsResult.rows;

    // 3. Group by month for display
    const historyMap = new Map<
      string,
      { month: string; amount: number; status: string }
    >();

    for (const e of events) {
      const date = new Date(e.ledger_closed_at);
      const monthYear = date.toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      });
      const month = date.toLocaleString("en-US", { month: "long" });

      const existing = historyMap.get(monthYear);
      if (e.event_type === "LoanRepaid") {
        if (existing) {
          existing.amount += parseFloat(e.amount || "0") / 10000000; // Assuming 7 decimals
        } else {
          historyMap.set(monthYear, {
            month,
            amount: parseFloat(e.amount || "0") / 10000000,
            status: "Completed",
          });
        }
      } else if (e.event_type === "LoanDefaulted") {
        if (existing) {
          existing.status = "Defaulted";
        } else {
          historyMap.set(monthYear, { month, amount: 0, status: "Defaulted" });
        }
      }
    }

    const history = Array.from(historyMap.values()).slice(-6);

    // 4. Calculate streak (consecutive "Completed" months from history)
    let streak = 0;
    const historyReverse = Array.from(historyMap.values()).reverse();
    for (const h of historyReverse) {
      if (h.status === "Completed") {
        streak++;
      } else if (h.status === "Defaulted") {
        break;
      }
    }

    res.json({
      userId,
      score,
      streak,
      history,
    });
  },
);

export const simulatePayment = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId, amount } = req.body;

    // Fetch current score
    const scoreResult = await query(
      "SELECT current_score FROM scores WHERE user_id = $1",
      [userId],
    );
    const currentScore = scoreResult.rows[0]?.current_score ?? 500;

    // Calculation matches eventIndexer.ts: +15 for each repayment
    const newScore = Math.min(850, currentScore + 15);

    res.json({
      success: true,
      message: `A payment of ${amount} would increase your estimated credit score from ${currentScore} to ${newScore}.`,
      newScore,
    });
  },
);
