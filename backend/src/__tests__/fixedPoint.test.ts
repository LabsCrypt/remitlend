import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mulDiv, calculateOwedFromIndex, INDEX_SCALE } from '../lib/fixedPoint.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type AccrualVector = {
  principal: string;
  rate_per_ledger_scaled: string;
  ledgers: number;
  expected_index: string;
  expected_owed: string;
};

describe('fixedPoint - mulDiv & Index Parity (issue #1382)', () => {
  it('should round half-up exactly on ties', () => {
    expect(mulDiv(1n, 1n, 2n)).toBe(1n); // 0.5 -> 1
    expect(mulDiv(1n, 1n, 3n)).toBe(0n); // 0.333... -> 0
    expect(mulDiv(2n, 1n, 3n)).toBe(1n); // 0.666... -> 1
    expect(mulDiv(100n, INDEX_SCALE, INDEX_SCALE)).toBe(100n);
  });

  it('should reject divide-by-zero and negative values', () => {
    expect(() => mulDiv(10n, 10n, 0n)).toThrow('mulDiv overflow or invalid arguments');
    expect(() => mulDiv(-1n, 10n, 10n)).toThrow('mulDiv overflow or invalid arguments');
    expect(() => mulDiv(10n, -1n, 10n)).toThrow('mulDiv overflow or invalid arguments');
    expect(() => mulDiv(10n, 10n, -1n)).toThrow('mulDiv overflow or invalid arguments');
  });

  it('should match all shared golden vectors bit-for-bit with contract calculations', () => {
    const vectorsPath = path.resolve(__dirname, '../../../contracts/testdata/accrual_vectors.json');
    const rawData = fs.readFileSync(vectorsPath, 'utf8');
    const vectors: AccrualVector[] = JSON.parse(rawData);

    expect(vectors.length).toBeGreaterThan(0);

    for (const vec of vectors) {
      let index = INDEX_SCALE;
      const rate = BigInt(vec.rate_per_ledger_scaled);
      const principal = BigInt(vec.principal);

      for (let i = 0; i < vec.ledgers; i++) {
        index = mulDiv(index, INDEX_SCALE + rate, INDEX_SCALE);
      }

      expect(index.toString()).toBe(vec.expected_index);

      const owed = calculateOwedFromIndex(principal, index, INDEX_SCALE);
      expect(owed.toString()).toBe(vec.expected_owed);
    }
  });

  it('should prevent sub-stroop accrual from truncating to zero over time', () => {
    const principal = 10_000_000n; // 1 XLM in stroops (10^7)
    const ratePerLedger = 7_922_020_087n; // ~5% APR / 6,311,520 ledgers

    let index = INDEX_SCALE;
    for (let i = 0; i < 100; i++) {
      index = mulDiv(index, INDEX_SCALE + ratePerLedger, INDEX_SCALE);
    }

    const owed = calculateOwedFromIndex(principal, index, INDEX_SCALE);
    // Over 100 ledgers, 1 XLM accrues 8 stroops instead of truncating to zero
    expect(owed).toBe(principal + 8n);
  });
});
