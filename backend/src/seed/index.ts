import dotenv from "dotenv";
import { query, closePool } from "../db/connection.js";
import { seedUsers } from "./data/users.js";
import { seedRemittances } from "./data/remittance.js";
import logger from "../utils/logger.js";

dotenv.config();

const seedScores = async () => {
  logger.info("Seeding scores table...");

  for (const user of seedUsers) {
    const existingUser = await query(
      "SELECT id FROM scores WHERE user_id = $1",
      [user.user_id]
    );

    if (existingUser.rowCount === 0) {
      await query(
        "INSERT INTO scores (user_id, current_score) VALUES ($1, $2)",
        [user.user_id, user.current_score]
      );
      logger.info("Inserted user", {
        user_id: user.user_id,
        current_score: user.current_score,
      });
    } else {
      logger.debug("Skipping existing user", { user_id: user.user_id });
    }
  }
};

const seedRemittanceHistory = async () => {
  logger.info("Seeding remittance_history table...");

  for (const remittance of seedRemittances) {
    const existingRecord = await query(
      "SELECT id FROM remittance_history WHERE user_id = $1 AND month = $2",
      [remittance.user_id, remittance.month]
    );

    if (existingRecord.rowCount === 0) {
      await query(
        "INSERT INTO remittance_history (user_id, amount, month, status) VALUES ($1, $2, $3, $4)",
        [remittance.user_id, remittance.amount, remittance.month, remittance.status]
      );
      logger.info("Inserted remittance", {
        user_id: remittance.user_id,
        month: remittance.month,
      });
    } else {
      logger.debug("Skipping existing remittance", {
        user_id: remittance.user_id,
        month: remittance.month,
      });
    }
  }
};

const runSeed = async () => {
  logger.info("Starting database seeding...");
  logger.info("=".repeat(50));

  try {
    await seedScores();
    logger.info("");
    await seedRemittanceHistory();

    logger.info("");
    logger.info("=".repeat(50));
    logger.info("Database seeding completed successfully!");
  } catch (error) {
    logger.error("Error during seeding", {
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack && { stack: error.stack }),
    });
    process.exit(1);
  } finally {
    await closePool();
  }
};

runSeed();
