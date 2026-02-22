import dotenv from "dotenv";
import { query, closePool } from "../db/connection.js";
import { seedUsers } from "./data/users.js";
import { seedRemittances } from "./data/remittance.js";

dotenv.config();

const seedScores = async () => {
  console.log("Seeding scores table...");

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
      console.log(`  Inserted user: ${user.user_id} with score: ${user.current_score}`);
    } else {
      console.log(`  Skipping existing user: ${user.user_id}`);
    }
  }
};

const seedRemittanceHistory = async () => {
  console.log("Seeding remittance_history table...");

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
      console.log(`  Inserted remittance: ${remittance.user_id} - ${remittance.month}`);
    } else {
      console.log(`  Skipping existing remittance: ${remittance.user_id} - ${remittance.month}`);
    }
  }
};

const runSeed = async () => {
  console.log("Starting database seeding...");
  console.log("=".repeat(50));

  try {
    await seedScores();
    console.log("");
    await seedRemittanceHistory();

    console.log("");
    console.log("=".repeat(50));
    console.log("Database seeding completed successfully!");
  } catch (error) {
    console.error("Error during seeding:", error);
    process.exit(1);
  } finally {
    await closePool();
  }
};

runSeed();
