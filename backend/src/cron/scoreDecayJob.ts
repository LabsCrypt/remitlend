import cron from 'node-cron';
import { jobMetricsService } from '../services/jobMetricsService.js';
import logger from '../utils/logger.js';

// In-memory guard to prevent overlapping execution states
let isRunning = false;

/**
 * Core business execution wrapper for processing user inactivity point decays.
 */
export async function runScoreDecayJob(): Promise<void> {
  if (isRunning) {
    logger
      .withContext()
      .warn('Score decay job is already running; skipping overlapping execution instance.');
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    logger.withContext().info('Starting scheduled score decay processing pass...');

    // ... Existing internal logic processing your decay calculations goes here ...

    await jobMetricsService.recordSuccess('score-decay-job', Date.now() - startTime);
    logger.withContext().info('Score decay processing pass completed successfully.');
  } catch (error: any) {
    await jobMetricsService.recordFailure(
      'score-decay-job',
      error instanceof Error ? error : String(error),
      Date.now() - startTime,
    );
    logger
      .withContext()
      .error('Score decay processing pass encountered an unhandled exception', { error });
  } finally {
    isRunning = false;
  }
}

/**
 * Configures and starts the recurring Cron scheduler for credit score decay execution.
 * Standardized to match existing infrastructure schedules.
 */
export function startScoreDecayScheduler() {
  if (process.env.NODE_ENV === 'test') {
    logger.withContext().info('Skipping score decay scheduler activation inside test profiles.');
    return { stop: () => {} };
  }

  // Run daily at midnight (0 0 * * *) or configure to match required administrative intervals
  const cronExpression = process.env.SCORE_DECAY_CRON || '0 0 * * *';

  const task = cron.schedule(cronExpression, async () => {
    await runScoreDecayJob();
  });

  logger
    .withContext()
    .info(`Score decay scheduler activated cleanly. Schedule: [${cronExpression}]`);

  return {
    stop: () => {
      logger.withContext().info('Stopping score decay scheduler execution tasks...');
      task.stop();
    },
  };
}

export default runScoreDecayJob;
