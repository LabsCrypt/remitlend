/**
 * Service for tracking per-job metrics (lastRunAt, lastSuccessAt, lastError, runsTotal, failuresTotal, durationMs)
 * Exposes metrics via Prometheus or JSON endpoint
 */

export interface JobMetrics {
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  runsTotal: number;
  failuresTotal: number;
  durationMs: number | null;
}

export interface JobMetricsSnapshot {
  [jobName: string]: JobMetrics;
}

class JobMetricsService {
  private metrics: Map<string, JobMetrics> = new Map();

  /**
   * Initialize metrics for a job
   */
  initializeJob(jobName: string): void {
    if (!this.metrics.has(jobName)) {
      this.metrics.set(jobName, {
        lastRunAt: null,
        lastSuccessAt: null,
        lastError: null,
        runsTotal: 0,
        failuresTotal: 0,
        durationMs: null,
      });
    }
  }

  /**
   * Record a successful job run
   */
  recordSuccess(jobName: string, durationMs: number): void {
    this.initializeJob(jobName);
    const metrics = this.metrics.get(jobName)!;
    metrics.lastRunAt = new Date();
    metrics.lastSuccessAt = new Date();
    metrics.lastError = null;
    metrics.runsTotal++;
    metrics.durationMs = durationMs;
  }

  /**
   * Record a failed job run
   */
  recordFailure(
    jobName: string,
    error: Error | string,
    durationMs: number,
  ): void {
    this.initializeJob(jobName);
    const metrics = this.metrics.get(jobName)!;
    metrics.lastRunAt = new Date();
    metrics.lastError = error instanceof Error ? error.message : String(error);
    metrics.runsTotal++;
    metrics.failuresTotal++;
    metrics.durationMs = durationMs;
  }

  /**
   * Get metrics for a specific job
   */
  getJobMetrics(jobName: string): JobMetrics | null {
    return this.metrics.get(jobName) ?? null;
  }

  /**
   * Get all job metrics
   */
  getAllMetrics(): JobMetricsSnapshot {
    const snapshot: JobMetricsSnapshot = {};
    for (const [jobName, metrics] of this.metrics) {
      snapshot[jobName] = { ...metrics };
    }
    return snapshot;
  }

  /**
   * Reset metrics for a job (useful for testing)
   */
  resetJob(jobName: string): void {
    this.metrics.delete(jobName);
  }

  /**
   * Reset all metrics (useful for testing)
   */
  resetAll(): void {
    this.metrics.clear();
  }
}

export const jobMetricsService = new JobMetricsService();
