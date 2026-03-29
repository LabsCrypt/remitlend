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
