import { parseCappedLimit } from "./queryHelpers.js";
import type { Request } from "express";

// Demo script to show how the limit capping prevents database performance issues
function demonstrateLimitCapping() {
  console.log("=== API Security: Limit Query Parameter Capping ===\n");
  
  // Simulate different request scenarios
  const scenarios = [
    { name: "Normal request", limit: "20" },
    { name: "High but reasonable limit", limit: "75" },
    { name: "Dangerous high limit (before fix)", limit: "1000000" },
    { name: "Negative limit (invalid)", limit: "-10" },
    { name: "Zero limit (invalid)", limit: "0" },
    { name: "Decimal limit (invalid)", limit: "50.5" },
    { name: "Non-numeric limit (invalid)", limit: "abc" },
    { name: "No limit provided", limit: undefined },
  ];

  scenarios.forEach(scenario => {
    const mockReq = { query: { limit: scenario.limit } } as unknown as Request;
    const effectiveLimit = parseCappedLimit(mockReq, 20);
    
    console.log(`${scenario.name}:`);
    console.log(`  Input: limit=${scenario.limit}`);
    console.log(`  Output: ${effectiveLimit}`);
    console.log(`  Status: ${effectiveLimit <= 100 ? '✅ SAFE' : '❌ DANGEROUS'}`);
    console.log();
  });
  
  console.log("=== Security Impact ===");
  console.log("Before fix: limit=1000000 could trigger full table scan → DB crash");
  console.log("After fix:  limit=1000000 is capped to 100 → DB remains responsive");
  console.log("\nMaximum allowed limit: 100 records per request");
  console.log("This prevents malicious clients from causing database performance issues.");
}

// Run demonstration
demonstrateLimitCapping();
