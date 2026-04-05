// Cron job to apply score decay to inactive borrowers
// Run this script periodically (e.g., daily) via a scheduler or as part of backend startup

import { getInactiveBorrowers, applyScoreDecay } from "../services/scoreDecayService.js";

async function runScoreDecayJob() {
  try {
    const borrowers = await getInactiveBorrowers();
    for (const borrower of borrowers) {
      await applyScoreDecay(borrower);
    }
    console.log(`Score decay applied to ${borrowers.length} inactive borrowers.`);
  } catch (err) {
    console.error("Score decay job failed:", err);
  }
}

export default runScoreDecayJob;
