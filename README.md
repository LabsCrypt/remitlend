# RemitLend

RemitLend treats remittance history as credit history. Migrant workers prove reliability through monthly transfers. They receive fair loans without predatory fees. Lenders earn transparent yield on Stellar testnet.

## Problem

Workers send money home every pay cycle. Banks in host countries ignore that record. Payday shops accept them, charge triple digit rates, and trap families in debt. RemitLend flips that script by turning payment streaks into a score that lenders respect.

## Today’s product

You connect a Stellar wallet. You mint a remittance NFT that holds your payment score. You request a loan against that NFT. Lenders deposit test USDC into a shared pool. The loan manager contract releases funds to your wallet. You repay inside the borrower dashboard and the NFT unlocks once the balance hits zero.

## Borrower experience

- Review your payment summary and reliability score.
- Check modeled terms before you commit.
- Stake the NFT, request the loan, and receive funds in minutes.
- Track progress on the My Loans tab.
- Repay on demand through the Make Payment button.
- The dashboard only lists loans tied to the connected wallet.

## Lender experience

- Enable USDC spending in one click.
- Mint test USDC directly inside the dashboard.
- Add liquidity to the pool.
- Monitor APY, utilization, and allowance in real time.
- Approve or reject pending loans.
- Withdraw liquidity when availability allows.

## Live components

- Soroban contracts cover the remittance NFT, the loan manager, the lending pool, and the oracle hooks.
- React dashboards integrate Stellar Wallet Kit.
- Allowance helpers and the test-token minter support every wallet.
- Borrower filtering keeps portfolios personal.

## Simulated components

- Payment history uses generated data inside each NFT.
- Auto repayment detection runs manually for now.
- Fiat bridges and production remittance APIs are pending.

## Roadmap

- Replace dummy streams with live data from Wise, Western Union, and PayPal.
- Automate on-chain updates when remittances land.
- Launch a capped mainnet pool after audits.
- Run a pilot on the UAE to Philippines corridor.
- Expand scoring to cover multi recipient families.
- Add risk tranches for lenders after repayment stats mature.

## Why Stellar

- Five second finality aligns with cross border flows.
- Native USDC keeps payouts stable.
- Fees stay under one cent, so small loans remain feasible.
- Soroban contracts interoperate cleanly with remittance rails.

## Impact goal

- Drop borrowing costs from four hundred percent APR to twenty percent APR for migrant families.
- Give workers a portable credit profile instead of a payday bill.

## Try it now

1. Open the hosted testnet app.
2. Connect Freighter or another supported wallet.
3. Mint the test remittance certificate.
4. Request a loan.
5. Approve it in the admin view.
6. Repay it.
7. Watch your score respond and your NFT unlock.

## Running with Docker

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed and running
- A `.env` file inside `backend/` (see below)

### Environment variables

Create `backend/.env` with at minimum:

```
PORT=3001
```

Add any other variables your app needs (e.g. API keys) to this file. It is already gitignored.

### Local development

From the **repo root**:

```bash
docker compose up --build
```

This starts the backend on **http://localhost:3001** with source files mounted for hot-reload.
To stop: `Ctrl-C`, then `docker compose down`.

### Production image

Build and run the optimised production image directly:

```bash
# From the backend/ directory
docker build -t remitlend-backend .
docker run --env-file .env -p 3001:3001 remitlend-backend
```

The multistage build compiles TypeScript in a `builder` stage, then copies only the compiled `dist/` and production `node_modules` into the final image — keeping it lean and running as a non-root user.
