import { getClient } from "./connection.js";
import type { PoolClient } from "pg";

export const withTransaction = async <T>(
    fn: (client: PoolClient) => Promise<T>,
): Promise<T> => {
    const client = await getClient();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
};

export const withStellarAndDbTransaction = async <TStellar, TDb>(
    stellarOp: () => Promise<TStellar>,
    dbOp: (stellarResult: TStellar, client: PoolClient) => Promise<TDb>,
): Promise<{ stellarResult: TStellar; dbResult: TDb }> => {
    const stellarResult = await stellarOp();
    const dbResult = await withTransaction((client) => dbOp(stellarResult, client));
    return { stellarResult, dbResult };
};
