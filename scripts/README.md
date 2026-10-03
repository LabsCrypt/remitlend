# RemitLend Deployment Scripts

Automated scripts for building and deploying Soroban smart contracts.

## Scripts

### 1. Build Script (`build.sh`)
Builds all contracts in the workspace and generates WASM files.

```bash
./scripts/build.sh
```

### 2. Deployment Script (`deploy.ts`)
Deploys, initializes, and links contracts on Stellar networks.

```bash
# Install dependencies (first time)
cd scripts && npm install

# Run deployment to testnet
SECRET_KEY=S... npx ts-node deploy.ts testnet
```

## Configuration

- `deploy-config.json`: Contains network RPC URLs, passphrase, and initial contract parameters.
- `.env`: (Optional) Can store `SECRET_KEY`, `RPC_URL`, etc.

## Workflow

1. **Build**: Run `./scripts/build.sh`.
2. **Configure**: Update `scripts/deploy-config.json` if needed (admin address, token address).
3. **Deploy**: Run `SECRET_KEY=... npm run deploy -- testnet` from the `scripts` directory.
4. **Verify**: Check `frontend/.env.local` and `backend/.env` for updated contract IDs.

## Multisig Governance & Target Admin API

`scripts/deploy.ts` initializes `MultisigGovernance` with targets `[LendingPool, LoanManager, RemittanceNFT]`.
Target selection must match the standard RemitLend Admin API:
- `propose_admin(new_admin: Address)`: Callable by current admin to propose a new administrator.
- `accept_admin()`: Callable by the proposed administrator to claim the admin role.
- `set_admin(new_admin: Address)`: Callable by current admin to directly transfer the admin role immediately.

### Deployment & Handover Sequence
1. Target contracts (`LendingPool`, `LoanManager`, `RemittanceNFT`) are initialized with the deployer admin.
2. `MultisigGovernance` is initialized with the deployer admin and target addresses (`[pool, manager, nft]`).
3. Each target executes `contract.propose_admin(governance_contract_id)`.
4. `MultisigGovernance.accept_target_admins()` executes to complete the admin handover on each target.
5. When `finalize_admin_transfer` is finalized on governance, it cross-invokes `target.propose_admin(new_admin)` on all targets, which the incoming admin claims by invoking `accept_admin()`.

## Load Testing

The repository includes a baseline load test using [k6](https://k6.io/). It hits key API endpoints to measure latency and error rates.

To run locally:
```bash
# Install k6 (https://k6.io/docs/get-started/installation/)
# Run against local environment
TARGET_URL=http://localhost:3000 k6 run scripts/loadtest/baseline.js
```


