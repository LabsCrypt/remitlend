#!/bin/bash

# Fuzz Testing Campaign Script for RemitLend Contracts
# This script runs comprehensive fuzz testing on all contracts

set -euo pipefail

echo "🔍 Starting RemitLend Fuzz Testing Campaign"
echo "=========================================="

# Configuration
FUZZ_TIME=${1:-60}  # Default 60 seconds per target if not specified
CORPUS_DIR="fuzz/corpus"
ARTIFACTS_DIR="fuzz/artifacts"
REPORT_DIR="fuzz/reports"
RUN_ID="$(date +%Y%m%d_%H%M%S)"

# Create directories
mkdir -p "$CORPUS_DIR" "$ARTIFACTS_DIR" "$REPORT_DIR"

# Function to run fuzz test
run_fuzz() {
    local target=$1
    local description=$2
    
    echo ""
    echo "🎯 Fuzzing: $description"
    echo "Target: $target"
    echo "Time: ${FUZZ_TIME}s"
    echo "----------------------------------------"
    
    # Create corpus directory for this target
    mkdir -p "$CORPUS_DIR/$target"
    local target_artifacts_dir="$ARTIFACTS_DIR/$RUN_ID-$target"
    mkdir -p "$target_artifacts_dir"
    
    # Run the fuzz test
    cargo +nightly fuzz run "$target" \
        -- -max_total_time="${FUZZ_TIME}" \
        -artifact_prefix="$target_artifacts_dir/" \
        -print_final_stats=1 \
        2>&1 | tee "$REPORT_DIR/$target.log"
    
    # Check if any crashes were found
    if [[ -n "$(find "$target_artifacts_dir" -type f -print -quit)" ]]; then
        echo "❌ CRASHES FOUND for $target!"
        echo "Artifacts saved in: $ARTIFACTS_DIR"
    else
        echo "✅ No crashes found for $target"
    fi
}

# Function to generate summary report
generate_report() {
    echo ""
    echo "📊 Generating Summary Report"
    echo "==========================="
    
    local report_file="$REPORT_DIR/summary_$(date +%Y%m%d_%H%M%S).md"
    
    cat > "$report_file" << EOF
# RemitLend Fuzz Testing Report

**Date:** $(date)
**Fuzz Time per Target:** ${FUZZ_TIME}s

## Test Results

EOF
    
    # Add results for each target
    for target in "lending_pool_fuzz" "loan_manager_fuzz" "remittance_nft_fuzz" "multisig_governance_fuzz"; do
        echo "### $target" >> "$report_file"
        
        local target_artifacts_dir="$ARTIFACTS_DIR/$RUN_ID-$target"
        if find "$target_artifacts_dir" -type f -print -quit | grep -q .; then
            echo "- Status: ❌ CRASHES FOUND" >> "$report_file"
            echo "- Artifacts: $(find "$target_artifacts_dir" -type f | wc -l | tr -d ' ') crash artifacts" >> "$report_file"
        else
            echo "- Status: ✅ PASSED" >> "$report_file"
        fi
        
        if [ -f "$REPORT_DIR/$target.log" ]; then
            echo "- Log: [$target.log]($target.log)" >> "$report_file"
        fi
        
        echo "" >> "$report_file"
    done
    
    echo "## Invariants Tested" >> "$report_file"
    echo "" >> "$report_file"
    echo "### LendingPool (v2 Share Accounting)" >> "$report_file"
    echo "- TotalManagedAssets consistency (idle balance + TotalOutstanding)" >> "$report_file"
    echo "- Share price monotonicity and virtual-offset defense" >> "$report_file"
    echo "- TotalOutstanding tracking and non-negativity" >> "$report_file"
    echo "- Typed PoolError return on invalid inputs" >> "$report_file"
    echo "" >> "$report_file"
    
    echo "### LoanManager" >> "$report_file"
    echo "- Score threshold enforcement (300-850 band, min_score >= 500)" >> "$report_file"
    echo "- Accrual index consistency and repayment waterfall (#1382)" >> "$report_file"
    echo "- 7-state lifecycle preservation (Pending/Approved/Repaid/Defaulted/Liquidated/Cancelled/Rejected)" >> "$report_file"
    echo "- Collateral lock and release invariants" >> "$report_file"
    echo "" >> "$report_file"
    
    echo "### RemittanceNFT" >> "$report_file"
    echo "- Unique metadata record per borrower address" >> "$report_file"
    echo "- Score bounded to [300, 850] with typed error handling" >> "$report_file"
    echo "- Minter authorization and score history immutability" >> "$report_file"
    echo "- Active-loan transfer guard" >> "$report_file"
    echo "" >> "$report_file"

    echo "### MultisigGovernance" >> "$report_file"
    echo "- Quorum threshold verification (approvals >= threshold)" >> "$report_file"
    echo "- Timelock delay enforcement" >> "$report_file"
    echo "- Single pending proposal lifecycle and emergency cancellation" >> "$report_file"
    echo "" >> "$report_file"
    
    echo "Report saved to: $report_file"
}

# Main execution
echo "Building fuzz targets..."
cargo +nightly fuzz build

echo ""
echo "Starting fuzz testing campaign..."
echo "================================"

# Run fuzz tests for each contract
run_fuzz "lending_pool_fuzz" "LendingPool Contract"
run_fuzz "loan_manager_fuzz" "LoanManager Contract"
run_fuzz "remittance_nft_fuzz" "RemittanceNFT Contract"
run_fuzz "multisig_governance_fuzz" "MultisigGovernance Contract"

# Generate summary report
generate_report

echo ""
echo "🏁 Fuzz Testing Campaign Complete!"
echo "=================================="
echo "Reports available in: $REPORT_DIR"
echo "Crash artifacts (if any) available in: $ARTIFACTS_DIR"

# Exit with error if any crashes were found
if [[ -n "$(find "$ARTIFACTS_DIR" -path "$ARTIFACTS_DIR/$RUN_ID-*/*" -type f -print -quit)" ]]; then
    echo ""
    echo "⚠️  Some fuzz tests found crashes. Please review the artifacts."
    exit 1
else
    echo ""
    echo "🎉 All fuzz tests passed successfully!"
    exit 0
fi