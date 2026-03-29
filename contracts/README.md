# RemitLend Smart Contracts

Soroban smart contracts for the RemitLend decentralized lending platform on Stellar. These contracts handle NFT minting, loan management, and lending pool operations.

## Overview

RemitLend uses three core smart contracts:

1. **Remittance NFT** - Stores credit scores and remittance history as NFTs
2. **Loan Manager** - Manages the complete loan lifecycle
3. **Lending Pool** - Handles liquidity deposits and withdrawals

## Prerequisites

- [Rust Toolchain](https://www.rust-lang.org/tools/install) (latest stable)
- [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup)
- [wasm32-unknown-unknown target](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html)

### Installation

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add wasm32 target
rustup target add wasm32-unknown-unknown

# Install Soroban CLI
cargo install --locked soroban-cli
```

## Project Structure

```
contracts/
├── remittance_nft/          # NFT contract for credit scores
│   ├── src/
│   │   ├── lib.rs          # Main contract logic
│   │   └── test.rs         # Contract tests
│   ├── test_snapshots/     # Test snapshots
│   └── Cargo.toml
├── loan_manager/            # Loan lifecycle management
│   ├── src/
│   │   ├── lib.rs
│   │   └── test.rs
│   ├── test_snapshots/
│   └── Cargo.toml
├── lending_pool/            # Liquidity pool management
│   ├── src/
│   │   ├── lib.rs
│   │   └── test.rs
│   ├── test_snapshots/
│   └── Cargo.toml
├── Cargo.toml               # Workspace configuration
├── Cargo.lock
└── README.md
```

## Building Contracts

### Build All Contracts

```bash
# From contracts directory
cargo build --target wasm32-unknown-unknown --release
```

### Build Specific Contract

```bash
# Build only NFT contract
cargo build -p remittance_nft --target wasm32-unknown-unknown --release

# Build only Loan Manager
cargo build -p loan_manager --target wasm32-unknown-unknown --release

# Build only Lending Pool
cargo build -p lending_pool --target wasm32-unknown-unknown --release
```

### Build Output

Compiled WASM files are located at:
```
target/wasm32-unknown-unknown/release/
├── remittance_nft.wasm
├── loan_manager.wasm
└── lending_pool.wasm
```

## Testing

### Run All Tests

```bash
cargo test
```

### Run Specific Contract Tests

```bash
# Test NFT contract
cargo test -p remittance_nft

# Test Loan Manager
cargo test -p loan_manager

# Test Lending Pool
cargo test -p lending_pool
```

### Run Tests with Output

```bash
# Show println! output
cargo test -- --nocapture

# Show test names
cargo test -- --test-threads=1 --nocapture
```

### Test Coverage

```bash
# Install tarpaulin
cargo install cargo-tarpaulin

# Generate coverage report
cargo tarpaulin --out Html
```

## Contract Details

### 1. Remittance NFT Contract

**Purpose**: Mint and manage NFTs representing borrower credit scores.

**Key Functions**:
```rust
// Initialize the contract
pub fn initialize(env: Env, admin: Address)

// Mint a new NFT
pub fn mint_nft(env: Env, owner: Address, score: u32) -> u64

// Update credit score
pub fn update_score(env: Env, nft_id: u64, new_score: u32)

// Update remittance history hash
pub fn update_history_hash(env: Env, nft_id: u64, hash: BytesN<32>)

// Get NFT score
pub fn get_score(env: Env, nft_id: u64) -> u32

// Lock NFT (for loan collateral)
pub fn lock_nft(env: Env, nft_id: u64)

// Unlock NFT (after loan repayment)
pub fn unlock_nft(env: Env, nft_id: u64)
```

**Storage Keys**:
- `NFT_COUNTER` - Total NFTs minted
- `NFT_OWNER_{id}` - NFT ownership mapping
- `NFT_SCORE_{id}` - Credit score storage
- `NFT_HASH_{id}` - Remittance history hash
- `NFT_LOCKED_{id}` - Lock status

**Tests**:
- ✅ Mint NFT flow
- ✅ Update score
- ✅ Update history hash
- ✅ Lock/unlock NFT
- ✅ Unauthorized access prevention
- ✅ Migration compatibility

### 2. Loan Manager Contract

**Purpose**: Coordinate loan requests, approvals, and repayments.

**Key Functions**:
```rust
// Initialize the contract
pub fn initialize(env: Env, admin: Address, pool_address: Address)

// Request a loan
pub fn request_loan(
    env: Env,
    borrower: Address,
    nft_id: u64,
    amount: i128
) -> u64

// Approve a loan
pub fn approve_loan(env: Env, loan_id: u64)

// Repay loan
pub fn repay_loan(env: Env, loan_id: u64, amount: i128)

// Get loan details
pub fn get_loan(env: Env, loan_id: u64) -> Loan

// Check loan status
pub fn get_loan_status(env: Env, loan_id: u64) -> LoanStatus
```

**Loan States**:
```rust
pub enum LoanStatus {
    Requested,   // Loan requested, awaiting approval
    Approved,    // Approved, funds disbursed
    Active,      // Repayment in progress
    Repaid,      // Fully repaid
    Defaulted,   // Payment missed
}
```

**Business Logic**:
- Minimum credit score: 600
- Maximum loan-to-value: 80%
- Interest rate: Based on credit score
- Repayment period: Configurable

**Tests**:
- ✅ Loan request flow
- ✅ Loan approval flow
- ✅ Repayment flow
- ✅ Low score rejection
- ✅ Unauthorized repayment prevention
- ✅ Access controls

### 3. Lending Pool Contract

**Purpose**: Manage lender deposits and loan fund allocation.

**Key Functions**:
```rust
// Initialize the contract
pub fn initialize(env: Env, admin: Address)

// Deposit funds
pub fn deposit(env: Env, lender: Address, amount: i128)

// Withdraw funds
pub fn withdraw(env: Env, lender: Address, amount: i128)

// Get available liquidity
pub fn get_available_liquidity(env: Env) -> i128

// Allocate funds for loan (called by Loan Manager)
pub fn allocate_funds(env: Env, loan_id: u64, amount: i128)

// Return funds from repayment (called by Loan Manager)
pub fn return_funds(env: Env, loan_id: u64, amount: i128)

// Get lender balance
pub fn get_lender_balance(env: Env, lender: Address) -> i128
```

**Pool Mechanics**:
- Proportional share tracking
- Interest distribution
- Reserve ratio maintenance
- Withdrawal limits

**Tests**:
- ✅ Deposit flow
- ✅ Withdrawal flow
- ✅ Liquidity tracking
- ✅ Unauthorized access prevention
- ✅ Fund allocation

## Deployment

### Deploy to Testnet

```bash
# Set up Soroban identity
soroban keys generate --global alice --network testnet

# Deploy NFT contract
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/remittance_nft.wasm \
  --source alice \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"

# Save the contract ID
export NFT_CONTRACT_ID=<contract_id>

# Initialize the contract
soroban contract invoke \
  --id $NFT_CONTRACT_ID \
  --source alice \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- initialize \
  --admin <admin_address>
```

### Deploy All Contracts

```bash
# Deploy and initialize all three contracts
./scripts/deploy.sh testnet
```

### Verify Deployment

```bash
# Check contract info
soroban contract info \
  --id $NFT_CONTRACT_ID \
  --rpc-url https://soroban-testnet.stellar.org
```

## Interacting with Contracts

### Using Soroban CLI

```bash
# Mint an NFT
soroban contract invoke \
  --id $NFT_CONTRACT_ID \
  --source alice \
  -- mint_nft \
  --owner <owner_address> \
  --score 750

# Get NFT score
soroban contract invoke \
  --id $NFT_CONTRACT_ID \
  -- get_score \
  --nft_id 1

# Request a loan
soroban contract invoke \
  --id $LOAN_MANAGER_ID \
  --source alice \
  -- request_loan \
  --borrower <borrower_address> \
  --nft_id 1 \
  --amount 1000000000
```

### Using Stellar SDK (JavaScript)

```javascript
import { Contract, SorobanRpc } from '@stellar/stellar-sdk';

const contract = new Contract(contractId);
const server = new SorobanRpc.Server('https://soroban-testnet.stellar.org');

// Call contract method
const result = await contract.call('get_score', [nftId]);
console.log('Score:', result);
```

## Development

### Code Style

```bash
# Format code
cargo fmt

# Check code quality
cargo clippy

# Fix clippy warnings
cargo clippy --fix
```

### Best Practices

- Use `Result` types for error handling
- Avoid panics in production code
- Write comprehensive tests
- Document public functions
- Use descriptive variable names
- Keep functions small and focused

### Documentation

```bash
# Generate documentation
cargo doc --open

# Generate docs for all contracts
cargo doc --workspace --open
```

## Security Considerations

### Access Control

- Admin-only functions protected
- Owner verification for sensitive operations
- Contract-to-contract authentication

### Data Validation

- Input parameter validation
- Score range checks (0-1000)
- Amount validation (positive values)
- NFT existence verification

### Reentrancy Protection

Soroban provides built-in reentrancy protection through its execution model.

### Integer Overflow

Rust's type system prevents integer overflow in debug mode. Use checked arithmetic in production.

```rust
// Good
let result = amount.checked_add(interest)?;

// Avoid
let result = amount + interest;
```

## Upgrading Contracts

### Contract Upgrades

Soroban contracts can be upgraded using the upgrade mechanism:

```bash
# Build new version
cargo build --target wasm32-unknown-unknown --release

# Upgrade contract
soroban contract upgrade \
  --id $CONTRACT_ID \
  --wasm target/wasm32-unknown-unknown/release/contract.wasm \
  --source admin
```

### Migration Strategy

- Test upgrades on testnet first
- Implement data migration functions
- Maintain backward compatibility
- Document breaking changes

## Troubleshooting

### Build Errors

```bash
# Clean build artifacts
cargo clean

# Update dependencies
cargo update

# Rebuild
cargo build --target wasm32-unknown-unknown --release
```

### Test Failures

```bash
# Run tests with verbose output
cargo test -- --nocapture

# Run specific test
cargo test test_name -- --nocapture
```

### Deployment Issues

```bash
# Check Soroban CLI version
soroban --version

# Verify network connectivity
curl https://soroban-testnet.stellar.org

# Check account balance
soroban keys address alice
```

## Resources

- [Soroban Documentation](https://soroban.stellar.org/docs)
- [Soroban Examples](https://github.com/stellar/soroban-examples)
- [Rust Book](https://doc.rust-lang.org/book/)
- [Stellar Documentation](https://developers.stellar.org)

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

### Before Submitting PR

```bash
cargo fmt
cargo clippy
cargo test
cargo build --target wasm32-unknown-unknown --release
```

## License

ISC License - See LICENSE file for details.

## Support

- Open an issue for bug reports
- Check existing issues before creating new ones
- Provide error messages and logs
- Include contract IDs for deployment issues

