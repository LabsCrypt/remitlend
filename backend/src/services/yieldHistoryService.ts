import { scValToNative, xdr } from '@stellar/stellar-sdk';
import { query } from '../db/connection.js';

export const SHARE_PRICE_SCALE = 1_000_000;
export const YIELD_HISTORY_ALLOWED_DAYS = [7, 30, 90] as const;
export const YIELD_HISTORY_DEFAULT_DAYS = 30 as const;
const MAX_POINTS = 90;

export type YieldHistoryDayRange = (typeof YIELD_HISTORY_ALLOWED_DAYS)[number];

export interface YieldHistoryPoint {
  timestamp: string;
  depositedValue: number;
  currentValue: number;
  netYield: number;
}

interface PoolEventRow {
  event_type: string;
  amount: string | null;
  ledger_closed_at: Date;
  value: string | null;
}

function parseNumeric(value: unknown): number {
  const n = parseFloat(String(value ?? 0));
  return Number.isFinite(n) ? n : 0;
}

function parseDepositWithdrawAmounts(
  _eventType: string,
  amount: string | null,
  valueXdr: string | null,
): { assetAmount: number; shares: number } {
  const assetAmount = parseNumeric(amount);

  if (!valueXdr) {
    return { assetAmount, shares: assetAmount };
  }

  try {
    const scVal = xdr.ScVal.fromXDR(valueXdr, 'base64');
    const native = scValToNative(scVal);
    if (!Array.isArray(native) || native.length < 2) {
      return { assetAmount, shares: assetAmount };
    }
    const sharesRaw = native[1];
    const shares =
      typeof sharesRaw === 'bigint'
        ? Number(sharesRaw)
        : typeof sharesRaw === 'number'
          ? sharesRaw
          : assetAmount;
    return { assetAmount, shares };
  } catch {
    return { assetAmount, shares: assetAmount };
  }
}

function assetValueFromShares(shares: number, poolBalance: number, totalShares: number): number {
  if (shares <= 0 || totalShares <= 0) {
    return 0;
  }
  return (shares * poolBalance) / totalShares;
}

function applyPoolEvent(
  state: { poolBalance: number; totalShares: number },
  event: PoolEventRow,
): void {
  const { assetAmount, shares } = parseDepositWithdrawAmounts(
    event.event_type,
    event.amount,
    event.value,
  );

  switch (event.event_type) {
    case 'Deposit':
      state.poolBalance += assetAmount;
      state.totalShares += shares;
      break;
    case 'Withdraw':
    case 'EmergencyWithdraw':
      state.poolBalance = Math.max(0, state.poolBalance - assetAmount);
      state.totalShares = Math.max(0, state.totalShares - shares);
      break;
    case 'YieldDistributed':
      state.poolBalance += assetAmount;
      break;
    default:
      break;
  }
}

function applyDepositorEvent(
  state: { shares: number; costBasis: number },
  _pool: { poolBalance: number; totalShares: number },
  event: PoolEventRow,
): void {
  const { assetAmount, shares } = parseDepositWithdrawAmounts(
    event.event_type,
    event.amount,
    event.value,
  );

  if (event.event_type === 'Deposit') {
    state.shares += shares;
    state.costBasis += assetAmount;
    return;
  }

  if (event.event_type === 'Withdraw' || event.event_type === 'EmergencyWithdraw') {
    if (state.shares <= 0) {
      return;
    }
    const shareRatio = Math.min(1, shares / state.shares);
    state.costBasis = Math.max(0, state.costBasis * (1 - shareRatio));
    state.shares = Math.max(0, state.shares - shares);
  }
}

function computeApy(netYield: number, depositedValue: number, daysElapsed: number): number {
  if (depositedValue <= 0 || daysElapsed <= 0) {
    return 0;
  }
  const periodReturn = netYield / depositedValue;
  const annualized = periodReturn * (365 / daysElapsed);
  return parseFloat((annualized * 100).toFixed(4));
}

export function normalizeYieldHistoryDays(days: number | undefined): YieldHistoryDayRange {
  if ((YIELD_HISTORY_ALLOWED_DAYS as readonly number[]).includes(days as number)) {
    return days as YieldHistoryDayRange;
  }
  return YIELD_HISTORY_DEFAULT_DAYS;
}

export async function buildDepositorYieldHistory(
  address: string,
  _token: string,
  days: YieldHistoryDayRange,
  currentSharePrice?: number,
): Promise<YieldHistoryPoint[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const poolContractId = process.env.LENDING_POOL_CONTRACT_ID ?? '';

  const [poolEventsResult, depositorEventsResult] = await Promise.all([
    query(
      `
      SELECT event_type, amount, ledger_closed_at, value
      FROM contract_events
      WHERE contract_id = $1
        AND event_type IN ('Deposit', 'Withdraw', 'EmergencyWithdraw', 'YieldDistributed')
        AND ledger_closed_at >= $2
      ORDER BY ledger_closed_at ASC
      `,
      [poolContractId, since.toISOString()],
    ),
    query(
      `
      SELECT event_type, amount, ledger_closed_at, value
      FROM contract_events
      WHERE address = $1
        AND event_type IN ('Deposit', 'Withdraw', 'EmergencyWithdraw')
        AND ledger_closed_at >= $2
      ORDER BY ledger_closed_at ASC
      `,
      [address, since.toISOString()],
    ),
  ]);

  const poolEvents = poolEventsResult.rows as PoolEventRow[];
  const depositorEvents = depositorEventsResult.rows as PoolEventRow[];

  if (depositorEvents.length === 0) {
    return [];
  }

  const bucketDates: Date[] = [];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(since);
  start.setUTCHours(0, 0, 0, 0);

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    bucketDates.push(new Date(cursor));
    if (bucketDates.length >= MAX_POINTS) {
      break;
    }
  }

  if (bucketDates.length === 0) {
    bucketDates.push(end);
  }

  const poolState = { poolBalance: 0, totalShares: 0 };
  const depositorState = { shares: 0, costBasis: 0 };
  let poolIdx = 0;
  let depositorIdx = 0;

  const points: YieldHistoryPoint[] = [];

  for (const bucketEnd of bucketDates) {
    while (
      poolIdx < poolEvents.length &&
      new Date(poolEvents[poolIdx]!.ledger_closed_at) <= bucketEnd
    ) {
      applyPoolEvent(poolState, poolEvents[poolIdx]!);
      poolIdx += 1;
    }

    while (
      depositorIdx < depositorEvents.length &&
      new Date(depositorEvents[depositorIdx]!.ledger_closed_at) <= bucketEnd
    ) {
      applyDepositorEvent(depositorState, poolState, depositorEvents[depositorIdx]!);
      depositorIdx += 1;
    }

    let currentValue = assetValueFromShares(
      depositorState.shares,
      poolState.poolBalance,
      poolState.totalShares,
    );

    const isLastBucket = bucketEnd.getTime() === bucketDates[bucketDates.length - 1]!.getTime();
    if (isLastBucket && currentSharePrice !== undefined && depositorState.shares > 0) {
      currentValue = (depositorState.shares * currentSharePrice) / SHARE_PRICE_SCALE;
    }

    const depositedValue = depositorState.costBasis;
    const netYield = Math.max(0, currentValue - depositedValue);

    points.push({
      timestamp: bucketEnd.toISOString(),
      depositedValue: parseFloat(depositedValue.toFixed(7)),
      currentValue: parseFloat(currentValue.toFixed(7)),
      netYield: parseFloat(netYield.toFixed(7)),
    });
  }

  // Trim leading buckets that predate any depositor activity, but keep the
  // tail so a full withdraw (state collapses back to zero) still shows up in
  // the chart instead of being silently dropped.
  const firstActiveIdx = points.findIndex(
    (point) => point.depositedValue > 0 || point.currentValue > 0,
  );
  if (firstActiveIdx === -1) {
    return [];
  }
  return points.slice(firstActiveIdx);
}

export { MAX_POINTS, computeApy };
