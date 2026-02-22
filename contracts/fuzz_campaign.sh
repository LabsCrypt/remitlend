#!/bin/bash

# Fuzz Testing Campaign Script for RemitLend Contracts
# This script runs comprehensive fuzz testing on all contracts

set -e

echo "🔍 Starting RemitLend Fuzz Testing Campaign"
echo "=========================================="

# Configuration
FUZZ_TIME=${1:-60}  # Default 60 seconds per target if not specified
CORPUS_DIR="fuzz/corpus"
ARTIFACTS_DIR="fuzz/artifacts"
REPORT_DIR="fuzz/reports"

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
    
    # Run the fuzz test
    cargo +nightly fuzz run "$target" \
        -- -max_total_time="${FUZZ_TIME}" \
        -artifact_prefix="$ARTIFACTS_DIR/$target-" \
        -print_final_stats=1 \
        2>&1 | tee "$REPORT_DIR/$target.log"
    
    # Check if any crashes were found
    if ls "$ARTIFACTS_DIR/$target"-* 1> /dev/null 2>&1; then
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
    for target in "lending_pool_fuzz" "loan_manager_fuzz" "remittance_nft_fuzz"; do
        echo "### $target" >> "$report_file"
        
        if ls "$ARTIFACTS_DIR/$target"-* 1> /dev/null 2>&1; then
            echo "- Status: ❌ CRASHES FOUND" >> "$report_file"
            echo "- Artifacts: $(ls "$ARTIFACTS_DIR/$target"-* | wc -l) crash artifacts" >> "$report_file"
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
    echo "### LendingPool" >> "$report_file"
    echo "- Total deposits >= total withdrawals" >> "$report_file"
    echo "- Individual balances never negative" >> "$report_file"
    echo "- Balance consistency across operations" >> "$report_file"
    echo "" >> "$report_file"
    
    echo "### LoanManager" >> "$report_file"
    echo "- Score threshold enforcement (>= 500 for loans)" >> "$report_file"
    echo "- Scores never negative" >> "$report_file"
    echo "- Authorization controls" >> "$report_file"
    echo "" >> "$report_file"
    
    echo "### RemittanceNFT" >> "$report_file"
    echo "- Unique NFT per user" >> "$report_file"
    echo "- Score range validation" >> "$report_file"
    echo "- Authorization controls" >> "$report_file"
    echo "- Metadata integrity" >> "$report_file"
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

# Generate summary report
generate_report

echo ""
echo "🏁 Fuzz Testing Campaign Complete!"
echo "=================================="
echo "Reports available in: $REPORT_DIR"
echo "Crash artifacts (if any) available in: $ARTIFACTS_DIR"

# Exit with error if any crashes were found
if ls "$ARTIFACTS_DIR"/*-* 1> /dev/null 2>&1; then
    echo ""
    echo "⚠️  Some fuzz tests found crashes. Please review the artifacts."
    exit 1
else
    echo ""
    echo "🎉 All fuzz tests passed successfully!"
    exit 0
fi