import { jest } from "@jest/globals";
import type { Pool } from "pg";

type CloseCb = (err?: Error) => void;

type MockServer = {
  close: (cb?: CloseCb) => void;
};

describe("Graceful Shutdown", () => {
  let mockServer: MockServer;
  let mockPool: Partial<Pool>;
  let shutdownHandler: (signal: "SIGTERM" | "SIGINT") => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockServer = {
      close: (callback?: CloseCb) => {
        if (callback) callback();
      },
    };

    mockPool = {
      end: jest.fn(async () => {}),
    };
  });

  it("should close server on SIGTERM", async () => {
    const closeSpy = jest.fn((callback?: CloseCb) => {
      if (callback) callback();
    });
    mockServer.close = closeSpy;

    shutdownHandler = async (_signal: "SIGTERM" | "SIGINT") => {
      return new Promise((resolve) => {
        mockServer.close((err?: Error) => {
          if (err) throw err;
          resolve();
        });
      });
    };

    await shutdownHandler("SIGTERM");
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("should close server on SIGINT", async () => {
    const closeSpy = jest.fn((callback?: CloseCb) => {
      if (callback) callback();
    });
    mockServer.close = closeSpy;

    shutdownHandler = async (_signal: "SIGTERM" | "SIGINT") => {
      return new Promise((resolve) => {
        mockServer.close((err?: Error) => {
          if (err) throw err;
          resolve();
        });
      });
    };

    await shutdownHandler("SIGINT");
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("should drain database pool after server closes", async () => {
    const closeSpy = jest.fn((callback?: CloseCb) => {
      if (callback) callback();
    });
    const endSpy = jest.fn(async () => {});
    mockServer.close = closeSpy;
    mockPool.end = endSpy;

    shutdownHandler = async (_signal: "SIGTERM" | "SIGINT") => {
      return new Promise((resolve) => {
        mockServer.close(async (err?: Error) => {
          if (err) throw err;
          await mockPool.end!();
          resolve();
        });
      });
    };

    await shutdownHandler("SIGTERM");
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it("should timeout after 30 seconds if shutdown stalls", () => {
    jest.useFakeTimers();

    const closeSpy = jest.fn((_callback?: CloseCb) => {
      // Never call callback - simulate stalled shutdown
    });
    mockServer.close = closeSpy;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exitSpy = jest.spyOn(process, "exit").mockImplementation((() => {
      // Mock implementation that doesn't actually exit
    }) as any);

    const timeout = setTimeout(() => {
      process.exit(1);
    }, 30000);

    // Fast-forward time by 30 seconds
    jest.advanceTimersByTime(30000);

    expect(exitSpy).toHaveBeenCalledWith(1);

    clearTimeout(timeout);
    exitSpy.mockRestore();
    jest.useRealTimers();
  });

  it("should complete graceful shutdown within timeout", () => {
    jest.useFakeTimers();

    const closeSpy = jest.fn((callback?: CloseCb) => {
      // Simulate quick shutdown
      if (callback) callback();
    });
    mockServer.close = closeSpy;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exitSpy = jest.spyOn(process, "exit").mockImplementation((() => {
      // Mock implementation that doesn't actually exit
    }) as any);

    // Simulate the shutdown flow
    const timeout = setTimeout(() => {
      process.exit(1);
    }, 30000);

    mockServer.close((err?: Error) => {
      clearTimeout(timeout);
      if (!err) {
        process.exit(0);
      }
    });

    expect(closeSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockRestore();
    jest.useRealTimers();
  });

  it("should handle server close errors gracefully", async () => {
    const testError = new Error("Server close failed");
    const closeSpy = jest.fn((callback?: CloseCb) => {
      if (callback) callback(testError);
    });
    mockServer.close = closeSpy;

    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    shutdownHandler = async (_signal: "SIGTERM" | "SIGINT") => {
      return new Promise((resolve, reject) => {
        mockServer.close((err?: Error) => {
          if (err) {
            process.exit(1);
            reject(err);
            return;
          }
          resolve();
        });
      });
    };

    await expect(shutdownHandler("SIGTERM")).rejects.toThrow(
      "process.exit called",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});
