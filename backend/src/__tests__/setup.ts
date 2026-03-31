import { db } from "../src/db/connection";
import Redis from "ioredis";

let redis: Redis;

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL);
  if (db.connect) {
    await db.connect();
  }
});

afterAll(async () => {
  if (redis) {
    await redis.quit();
  }
  if (db.end) {
    await db.end();
  }
});
