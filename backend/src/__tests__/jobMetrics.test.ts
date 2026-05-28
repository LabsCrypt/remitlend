import { jest } from "@jest/globals";
import { jobMetricsService } from "../services/jobMetricsService.js";

describe("jobMetricsService", () => {
  beforeEach(() => {
    jobMetricsService.resetAll();
  });

  it("initializes job metrics", () => {
    jobMetricsService.initializeJob("testJob");
    const metrics = jobMetricsService.getJobMetrics("testJob");

    expect(metrics).not.toBeNull();
    expect(metrics?.lastRunAt).toBeNull();
    expect(metrics?.lastSuccessAt).toBeNull();
    expect(metrics?.lastError).toBeNull();
    expect(metrics?.runsTotal).toBe(0);
    expect(metrics?.failuresTotal).toBe(0);
    expect(metrics?.durationMs).toBeNull();
  });

  it("records successful job run", () => {
    jobMetricsService.recordSuccess("testJob", 1500);
    const metrics = jobMetricsService.getJobMetrics("testJob");

    expect(metrics).not.toBeNull();
    expect(metrics?.lastRunAt).not.toBeNull();
    expect(metrics?.lastSuccessAt).not.toBeNull();
    expect(metrics?.lastError).toBeNull();
    expect(metrics?.runsTotal).toBe(1);
    expect(metrics?.failuresTotal).toBe(0);
    expect(metrics?.durationMs).toBe(1500);
  });

  it("records failed job run", () => {
    const error = new Error("Test error");
    jobMetricsService.recordFailure("testJob", error, 2000);
    const metrics = jobMetricsService.getJobMetrics("testJob");

    expect(metrics).not.toBeNull();
    expect(metrics?.lastRunAt).not.toBeNull();
    expect(metrics?.lastSuccessAt).toBeNull();
    expect(metrics?.lastError).toBe("Test error");
    expect(metrics?.runsTotal).toBe(1);
    expect(metrics?.failuresTotal).toBe(1);
    expect(metrics?.durationMs).toBe(2000);
  });

  it("tracks multiple runs", () => {
    jobMetricsService.recordSuccess("testJob", 1000);
    jobMetricsService.recordSuccess("testJob", 1200);
    jobMetricsService.recordFailure("testJob", "Error", 1500);

    const metrics = jobMetricsService.getJobMetrics("testJob");

    expect(metrics?.runsTotal).toBe(3);
    expect(metrics?.failuresTotal).toBe(1);
    expect(metrics?.durationMs).toBe(1500);
  });

  it("tracks multiple jobs independently", () => {
    jobMetricsService.recordSuccess("job1", 1000);
    jobMetricsService.recordFailure("job2", "Error", 2000);

    const metrics1 = jobMetricsService.getJobMetrics("job1");
    const metrics2 = jobMetricsService.getJobMetrics("job2");

    expect(metrics1?.runsTotal).toBe(1);
    expect(metrics1?.failuresTotal).toBe(0);
    expect(metrics2?.runsTotal).toBe(1);
    expect(metrics2?.failuresTotal).toBe(1);
  });

  it("returns all metrics snapshot", () => {
    jobMetricsService.recordSuccess("job1", 1000);
    jobMetricsService.recordFailure("job2", "Error", 2000);

    const allMetrics = jobMetricsService.getAllMetrics();

    expect(Object.keys(allMetrics)).toHaveLength(2);
    expect(allMetrics.job1?.runsTotal).toBe(1);
    expect(allMetrics.job2?.runsTotal).toBe(1);
  });

  it("resets individual job metrics", () => {
    jobMetricsService.recordSuccess("testJob", 1000);
    jobMetricsService.resetJob("testJob");

    const metrics = jobMetricsService.getJobMetrics("testJob");
    expect(metrics).toBeNull();
  });

  it("resets all metrics", () => {
    jobMetricsService.recordSuccess("job1", 1000);
    jobMetricsService.recordSuccess("job2", 2000);
    jobMetricsService.resetAll();

    const allMetrics = jobMetricsService.getAllMetrics();
    expect(Object.keys(allMetrics)).toHaveLength(0);
  });
});
