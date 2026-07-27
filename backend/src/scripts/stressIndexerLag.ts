import { Address, Keypair, nativeToScVal } from '@stellar/stellar-sdk';
import { closePool, query } from '../db/connection.js';
import { EventIndexer, type SorobanRawEvent } from '../services/eventIndexer.js';

interface StressOptions {
  startLedger: number;
  ledgers: number;
  eventsPerLedger: number;
  missingEvery: number;
  maxLagMs: number;
}

const readInt = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const options: StressOptions = {
  startLedger: readInt('STRESS_START_LEDGER', 1_000_000),
  ledgers: readInt('STRESS_LEDGER_COUNT', 120),
  eventsPerLedger: readInt('STRESS_EVENTS_PER_LEDGER', 8),
  missingEvery: readInt('STRESS_MISSING_EVERY', 17),
  maxLagMs: readInt('STRESS_MAX_LAG_MS', 5_000),
};

const contractId = process.env.STRESS_CONTRACT_ID ?? 'CINDEXERSTRESS';
const borrower = Keypair.random().publicKey();

function makeEvent(ledger: number, ordinal: number): SorobanRawEvent {
  return {
    id: `stress-${ledger}-${ordinal}`,
    pagingToken: `${ledger}-${ordinal}`,
    topic: [
      nativeToScVal('LoanRequested', { type: 'symbol' }),
      nativeToScVal(ledger * 1000 + ordinal, { type: 'u32' }),
      nativeToScVal(Address.fromString(borrower), { type: 'address' }),
    ],
    value: nativeToScVal(BigInt(1_000 + ordinal), { type: 'i128' }),
    ledger,
    ledgerClosedAt: new Date().toISOString(),
    txHash: `stress-tx-${ledger}-${ordinal}`,
    contractId,
  };
}

function buildBurst(includeMissing: boolean): SorobanRawEvent[] {
  const events: SorobanRawEvent[] = [];

  for (let offset = 0; offset < options.ledgers; offset += 1) {
    const ledger = options.startLedger + offset;
    const isMissing = offset > 0 && offset % options.missingEvery === 0;
    if (isMissing && !includeMissing) {
      continue;
    }

    for (let ordinal = 0; ordinal < options.eventsPerLedger; ordinal += 1) {
      events.push(makeEvent(ledger, ordinal));
    }
  }

  return events;
}

async function ensureDatabaseReachable(): Promise<void> {
  await query('SELECT 1');
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required so the stress test can measure database sync speed.');
  }

  await ensureDatabaseReachable();

  const indexer = new EventIndexer({
    rpcUrl: process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    contractIds: [contractId],
    dbWriteConcurrency: readInt('STRESS_DB_WRITE_CONCURRENCY', 4),
    dbWriteBatchSize: readInt('STRESS_DB_WRITE_BATCH_SIZE', 64),
  });

  const partialBurst = buildBurst(false);
  const fullBurst = buildBurst(true);
  const gaps = indexer.detectSequenceGaps(partialBurst);
  const missingEvents = fullBurst.filter((event) =>
    gaps.some((gap) => event.ledger >= gap.fromLedger && event.ledger <= gap.toLedger),
  );

  const startedAt = performance.now();
  const firstPass = await indexer.ingestRawEvents(partialBurst);
  const repair = await indexer.ingestRawEvents(missingEvents);
  const elapsedMs = performance.now() - startedAt;

  const expectedEvents = fullBurst.length;
  const insertedEvents = firstPass.insertedCount + repair.insertedCount;
  const caughtUp = elapsedMs <= options.maxLagMs && insertedEvents === expectedEvents;

  console.log(
    JSON.stringify(
      {
        ledgers: options.ledgers,
        eventsPerLedger: options.eventsPerLedger,
        expectedEvents,
        insertedEvents,
        missingRangesDetected: gaps.length,
        repairedEvents: repair.insertedCount,
        processingDelayMs: Math.round(elapsedMs),
        maxLagMs: options.maxLagMs,
        caughtUp,
      },
      null,
      2,
    ),
  );

  if (!caughtUp) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });
