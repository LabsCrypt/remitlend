const fs = require("fs");
const path = require("path");

const files = [
  "src/services/sorobanService.ts",
  "src/controllers/loanController.ts",
  "src/services/notificationService.ts",
  "src/services/eventIndexer.ts",
  "src/controllers/indexerController.ts",
  "src/services/webhookService.ts",
  "src/services/defaultChecker.ts",
  "src/services/scoreReconciliationService.ts",
  "src/services/eventStreamService.ts",
  "src/services/cacheService.ts",
  "src/services/webhookRetryScheduler.ts",
  "src/services/indexerManager.ts",
  "src/services/webhookRetryProcessor.ts",
  "src/services/scoresService.ts",
  "src/services/remittanceService.ts",
  "src/services/rateLimitService.ts",
  "src/controllers/remittanceController.ts",
  "src/controllers/poolController.ts",
  "src/controllers/eventStreamController.ts",
  "src/controllers/notificationController.ts",
];

for (const file of files) {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    continue;
  }
  let content = fs.readFileSync(filePath, "utf8");
  // replace logger.info( -> logger.withContext().info(
  // and so on for warn, error
  content = content.replace(
    /\blogger\.(info|warn|error)\s*\(/g,
    "logger.withContext().$1(",
  );
  fs.writeFileSync(filePath, content, "utf8");
  console.log(`Updated ${file}`);
}
