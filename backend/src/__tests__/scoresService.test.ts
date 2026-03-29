import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { query } from "../db/connection.js";
import { updateUserScoresBulk } from "../services/scoresService.js";

let __scoresService_dbAvailable = false;

beforeAll(async () => {
  try {
    await query("SELECT 1");
    __scoresService_dbAvailable = true;
  } catch {
    __scoresService_dbAvailable = false;
  }
});

const describeIf_scoresService = (name: string, fn: () => void) => {
  if (__scoresService_dbAvailable) {
    describe(name, fn);
  } else {
    // Ensure at least one skipped test exists so Jest considers the suite valid
    describe.skip(name, () => {
      it.skip("skipped: no database", () => {});
    });
  }
};

describeIf_scoresService("Scores Service - bulk updates", () => {
  const userA = "G_TEST_USER_A";
  const userB = "G_TEST_USER_B";

  beforeAll(async () => {
    await query(`
			CREATE TABLE IF NOT EXISTS scores (
				id SERIAL PRIMARY KEY,
				user_id VARCHAR(255) UNIQUE NOT NULL,
				current_score INTEGER NOT NULL,
				updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);
  });

  afterAll(async () => {
    await query("DELETE FROM scores WHERE user_id LIKE $1", ["G_TEST_%"]);
  });

  it("applies multiple deltas in a single operation and initializes new rows", async () => {
    // ensure clean
    await query("DELETE FROM scores WHERE user_id IN ($1, $2)", [userA, userB]);

    const updates = new Map<string, number>();
    updates.set(userA, 10);
    updates.set(userB, -20);

    await updateUserScoresBulk(updates);

    const res = await query(
      "SELECT user_id, current_score FROM scores WHERE user_id IN ($1, $2) ORDER BY user_id",
      [userA, userB],
    );

    const rows = res.rows.reduce(
      (acc: Record<string, number>, r: any) => {
        acc[r.user_id] = Number(r.current_score);
        return acc;
      },
      {} as Record<string, number>,
    );

    expect(rows[userA]).toBe(500 + 10);
    expect(rows[userB]).toBe(500 - 20);

    // apply more deltas to same users
    const more = new Map<string, number>();
    more.set(userA, 5);
    more.set(userB, -10);
    await updateUserScoresBulk(more);

    const res2 = await query(
      "SELECT user_id, current_score FROM scores WHERE user_id IN ($1, $2) ORDER BY user_id",
      [userA, userB],
    );

    const rows2 = res2.rows.reduce(
      (acc: Record<string, number>, r: any) => {
        acc[r.user_id] = Number(r.current_score);
        return acc;
      },
      {} as Record<string, number>,
    );

    expect(rows2[userA]).toBe(Math.min(850, Math.max(300, 500 + 10 + 5)));
    expect(rows2[userB]).toBe(Math.min(850, Math.max(300, 500 - 20 - 10)));
  });
});
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { query } from "../db/connection.js";
import { updateUserScoresBulk } from "../services/scoresService.js";

let dbAvailable = false;

beforeAll(async () => {
  try {
    await query("SELECT 1");
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

const describeIf = (name: string, fn: () => void) => {
  if (dbAvailable) {
    describe(name, fn);
  } else {
    // Ensure at least one skipped test exists so Jest considers the suite valid
    describe.skip(name, () => {
      it.skip("skipped: no database", () => {});
    });
  }
};

describeIf("Scores Service - bulk updates", () => {
  const userA = "G_TEST_USER_A";
  const userB = "G_TEST_USER_B";

  beforeAll(async () => {
    await query(`
			CREATE TABLE IF NOT EXISTS scores (
				id SERIAL PRIMARY KEY,
				user_id VARCHAR(255) UNIQUE NOT NULL,
				current_score INTEGER NOT NULL,
				updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);
  });

  afterAll(async () => {
    await query("DELETE FROM scores WHERE user_id LIKE $1", ["G_TEST_%"]);
  });

  it("applies multiple deltas in a single operation and initializes new rows", async () => {
    // ensure clean
    await query("DELETE FROM scores WHERE user_id IN ($1, $2)", [userA, userB]);

    const updates = new Map<string, number>();
    updates.set(userA, 10);
    updates.set(userB, -20);

    await updateUserScoresBulk(updates);

    const res = await query(
      "SELECT user_id, current_score FROM scores WHERE user_id IN ($1, $2) ORDER BY user_id",
      [userA, userB],
    );

    const rows = res.rows.reduce(
      (acc: Record<string, number>, r: any) => {
        acc[r.user_id] = Number(r.current_score);
        return acc;
      },
      {} as Record<string, number>,
    );

    expect(rows[userA]).toBe(500 + 10);
    expect(rows[userB]).toBe(500 - 20);

    // apply more deltas to same users
    const more = new Map<string, number>();
    more.set(userA, 5);
    more.set(userB, -10);
    await updateUserScoresBulk(more);

    const res2 = await query(
      "SELECT user_id, current_score FROM scores WHERE user_id IN ($1, $2) ORDER BY user_id",
      [userA, userB],
    );

    const rows2 = res2.rows.reduce(
      (acc: Record<string, number>, r: any) => {
        acc[r.user_id] = Number(r.current_score);
        return acc;
      },
      {} as Record<string, number>,
    );

    expect(rows2[userA]).toBe(Math.min(850, Math.max(300, 500 + 10 + 5)));
    expect(rows2[userB]).toBe(Math.min(850, Math.max(300, 500 - 20 - 10)));
  });
});
