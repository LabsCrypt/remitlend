import {
  rateLimitService,
  SCORE_UPDATE_RATE_LIMIT,
} from "../services/rateLimitService.js";

/**
 * Demo script to show rate limiting functionality for score updates
 */
async function demonstrateRateLimiting() {
  console.log("=== Rate Limiting Demo for Score Updates ===\n");

  const userId = "demo-user-123";

  console.log(`Configuration:`);
  console.log(
    `- Max requests per user per day: ${SCORE_UPDATE_RATE_LIMIT.maxRequests}`,
  );
  console.log(
    `- Window duration: ${SCORE_UPDATE_RATE_LIMIT.windowSeconds} seconds (24 hours)`,
  );
  console.log(`- User ID: ${userId}`);
  console.log();

  // Test 1: First request should be allowed
  console.log("1. First request (should be allowed):");
  const result1 = await rateLimitService.checkRateLimit(
    userId,
    SCORE_UPDATE_RATE_LIMIT,
  );
  console.log(`   Allowed: ${result1.allowed}`);
  console.log(`   Remaining: ${result1.remaining}`);
  console.log(`   Current count: ${result1.currentCount}`);
  console.log(`   Reset time: ${result1.resetTime.toISOString()}`);
  console.log();

  // Test 2: Several more requests within limit
  console.log("2-4. Making 3 more requests (should be allowed):");
  for (let i = 2; i <= 4; i++) {
    const result = await rateLimitService.checkRateLimit(
      userId,
      SCORE_UPDATE_RATE_LIMIT,
    );
    console.log(
      `   Request ${i}: Allowed=${result.allowed}, Remaining=${result.remaining}, Count=${result.currentCount}`,
    );
  }
  console.log();

  // Test 3: Check status without incrementing
  console.log("5. Current rate limit status (without incrementing):");
  const status = await rateLimitService.getRateLimitStatus(
    userId,
    SCORE_UPDATE_RATE_LIMIT,
  );
  console.log(`   Allowed: ${status.allowed}`);
  console.log(`   Remaining: ${status.remaining}`);
  console.log(`   Reset time: ${status.resetTime.toISOString()}`);
  console.log();

  // Test 4: Final request that hits the limit
  console.log("6. Final request (should hit the limit):");
  const result6 = await rateLimitService.checkRateLimit(
    userId,
    SCORE_UPDATE_RATE_LIMIT,
  );
  console.log(`   Allowed: ${result6.allowed}`);
  console.log(`   Remaining: ${result6.remaining}`);
  console.log(`   Current count: ${result6.currentCount}`);
  console.log();

  // Test 5: Request beyond limit (should be blocked)
  console.log("7. Request beyond limit (should be blocked):");
  const result7 = await rateLimitService.checkRateLimit(
    userId,
    SCORE_UPDATE_RATE_LIMIT,
  );
  console.log(`   Allowed: ${result7.allowed}`);
  console.log(`   Remaining: ${result7.remaining}`);
  console.log(`   Current count: ${result7.currentCount}`);
  console.log();

  // Test 6: Different user should have independent limit
  const differentUserId = "demo-user-456";
  console.log(
    `8. Different user (${differentUserId}) should have independent limit:`,
  );
  const resultDifferent = await rateLimitService.checkRateLimit(
    differentUserId,
    SCORE_UPDATE_RATE_LIMIT,
  );
  console.log(`   Allowed: ${resultDifferent.allowed}`);
  console.log(`   Remaining: ${resultDifferent.remaining}`);
  console.log(`   Current count: ${resultDifferent.currentCount}`);
  console.log();

  // Test 7: Reset rate limit
  console.log("9. Resetting rate limit for first user...");
  await rateLimitService.resetRateLimit(userId);
  console.log("   Reset completed");
  console.log();

  // Test 8: First request after reset
  console.log("10. First request after reset (should be allowed):");
  const resultAfterReset = await rateLimitService.checkRateLimit(
    userId,
    SCORE_UPDATE_RATE_LIMIT,
  );
  console.log(`    Allowed: ${resultAfterReset.allowed}`);
  console.log(`    Remaining: ${resultAfterReset.remaining}`);
  console.log(`    Current count: ${resultAfterReset.currentCount}`);
  console.log();

  console.log("=== Security Impact ===");
  console.log(
    "Before fix: Compromised API key could spam unlimited score updates",
  );
  console.log("After fix:  Maximum 5 score updates per user per day");
  console.log(
    "This prevents score inflation attacks while allowing legitimate usage.",
  );
}

// Run the demonstration
demonstrateRateLimiting().catch(console.error);
