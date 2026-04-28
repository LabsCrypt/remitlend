# RemitLend

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Frontend: Next.js](https://img.shields.io/badge/Frontend-Next.js-black?logo=next.js)](https://nextjs.org/)
[![Backend: Express](https://img.shields.io/badge/Backend-Express.js-white?logo=express)](https://expressjs.com/)
[![Smart Contracts: Soroban](https://img.shields.io/badge/Smart_Contracts-Soroban-orange)](https://soroban.stellar.org/)
[![Stellar](https://img.shields.io/badge/Stellar-Soroban-purple)](https://stellar.org)

RemitLend treats remittance history as credit history. Migrant workers prove their financial reliability through monthly cross-border transfers, allowing them to receive fair loans without predatory fees. In return, lenders earn transparent yield powered by the Stellar network.

## ✨ Key Features

### For Borrowers
- **Credit Building**: Convert your existing remittance history into an actionable credit score.
- **Fair Rates**: Access loans with transparent, non-predatory interest rates.
- **Self-Custody**: Maintain full control of your assets using Stellar wallets.

### For Lenders
- **Transparent Yield**: Earn interest by providing liquidity to audited borrowing pools.
- **Risk Assessment**: Make informed decisions based on verifiable, on-chain remittance proofs (Remittance NFTs).

### Technical Highlights
- **NFT-Based Collateral**: Remittance NFTs serve as proof of reliability and loan collateral.
- **Decentralized Lending Pools**: Lenders provide liquidity and earn transparent yields.
- **Transparent & Auditable**: All transactions and loan terms recorded on-chain.

## 🏗 Project Structure

The repository is organized as a monorepo containing three core packages:

- **`backend/`**: Node.js/Express server providing API support, score generation, and metadata management.
- **`frontend/`**: Next.js web application providing the UI for both borrowers and lenders.
- **`contracts/`**: Soroban (Rust) smart contracts covering the lending pools, loan management, and NFT collateral logic.

*For a detailed look at how these components interact, see our [Architecture Diagram](ARCHITECTURE.md).*
*New contributor? Start with the in-repo wiki: [docs/wiki/README.md](docs/wiki/README.md).*

## 🛠 Tech Stack

- **Blockchain**: [Stellar](https://stellar.org) (Soroban Smart Contracts)
- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Backend**: Node.js, Express, TypeScript, Jest
- **Wallet Integration**: [Stellar Wallet Kit](https://github.com/stellar/stellar-wallet-kit) (Freighter)

## 🏁 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
- [Docker & Docker Compose](https://www.docker.com/) (Recommended for easy setup)
- [Rust & Cargo](https://rustup.rs/) (Required for contract development)
- [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup) (Required for contract deployment)
- [Stellar Wallet](https://www.stellar.org/ecosystem/wallets) (Freighter recommended for testing)

### Quick Start with Docker (Recommended)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/remitlend.git
   cd remitlend
   ```

2. **Configure environment:**
   ```bash
   cp backend/.env.example backend/.env
   ```
   Edit `backend/.env` if needed (defaults work for local development).

3. **Start all services:**
   ```bash
   docker compose up --build
   ```
   Docker Compose uses healthchecks so services start cleanly:
   - PostgreSQL (`db`) is marked healthy via `pg_isready`
   - The backend waits for healthy Postgres before starting, runs `npm run migrate:up`, then starts the API
   - The backend container is marked healthy by polling `GET /health` every 10 seconds (3 retries)

4. **Access the application:**
   - Frontend: [http://localhost:3000](http://localhost:3000)
   - Backend API: [http://localhost:3001](http://localhost:3001)
   - API Documentation: [http://localhost:3001/api-docs](http://localhost:3001/api-docs)

### Manual Setup

#### Backend Setup

1. **Navigate to backend directory:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   Update `.env` with your configuration (at minimum `DATABASE_URL` for PostgreSQL):
   ```env
   CORS_ALLOWED_ORIGINS=http://localhost:3000
   PORT=3001
   NODE_ENV=development
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/remitlend
   ```

4. **Apply database migrations** (creates `scores`, `loan_events`, `indexer_state`, and other tables):
   ```bash
   npm run migrate:up
   ```
   Migration scripts use the colon form (`migrate:up` / `migrate:down`), which is the standard npm convention.

5. **Run development server:**
   ```bash
   npm run dev
   ```

6. **Available scripts:**
   - `npm run dev` - Start development server with hot reload
   - `npm run build` - Build for production
   - `npm start` - Run production build
   - `npm test` - Run test suite
   - `npm run lint` - Check code quality
   - `npm run format` - Format code with Prettier

#### Frontend Setup

1. **Navigate to frontend directory:**
   ```bash
   cd frontend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run development server:**
   ```bash
   npm run dev
   ```

4. **Access the application:**
   Open [http://localhost:3000](http://localhost:3000) in your browser

5. **Available scripts:**
   - `npm run dev` - Start development server
   - `npm run build` - Build for production
   - `npm start` - Run production build
   - `npm run lint` - Check code quality

#### Smart Contracts Setup

1. **Install Rust and wasm32 target:**
   ```bash
   rustup target add wasm32-unknown-unknown
   ```

2. **Install Soroban CLI:**
   ```bash
   cargo install --locked soroban-cli
   ```

3. **Navigate to contracts directory:**
   ```bash
   cd contracts
   ```

4. **Build all contracts:**
   ```bash
   cargo build --target wasm32-unknown-unknown --release
   ```

5. **Run tests:**
   ```bash
   cargo test
   ```

6. **Deploy to testnet (example):**
   ```bash
   soroban contract deploy \
     --wasm target/wasm32-unknown-unknown/release/remittance_nft.wasm \
     --source <YOUR_SECRET_KEY> \
     --rpc-url https://soroban-testnet.stellar.org \
     --network-passphrase "Test SDF Network ; September 2015"
   ```

## 🤝 Contributing

We welcome contributions from developers of all skill levels! Please see our [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines on how to get started.

### Quick Contribution Guide

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/amazing-feature`).
3. Make your changes and commit (`git commit -m 'Add amazing feature'`).
4. Push to your branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

## 📄 License

This project is licensed under the ISC License. See the `LICENSE` file for details..
