# RemitLend System Architecture

RemitLend is a decentralized lending platform built on the Stellar network using Soroban smart contracts. It leverages remittance history to establish creditworthiness for migrant workers who lack traditional credit history.

## Table of Contents

- [Overview](#overview)
- [Architecture Principles](#architecture-principles)
- [System Components](#system-components)
- [Data Flow](#data-flow)
- [Smart Contract Architecture](#smart-contract-architecture)
- [Technical Deep-Dives (Wiki)](#technical-deep-dives-wiki)
    - [Soroban Contract State Machine](docs/wiki/contract-state-machine.md)
    - [Indexer <-> Database Sync Flow](docs/wiki/indexer-sync-flow.md)
    - [Frontend Standard Library & Patterns](docs/wiki/frontend-patterns.md)
- [Security Model](#security-model)
- [Technology Stack](#technology-stack)

## Overview

RemitLend transforms the challenge of financial exclusion into an opportunity by treating consistent remittance payments as proof of creditworthiness. The system creates an on-chain credit score based on remittance history, mints it as an NFT, and uses it as collateral for loans from decentralized lending pools.

### System Architecture at a Glance

```mermaid
flowchart TB
    subgraph Users["👥 Users"]
        B["🏃 Borrower<br/>(Migrant Worker)"]
        L["💰 Lender<br/>(Liquidity Provider)"]
    end
    
    subgraph Frontend["🖥️ Frontend Layer"]
        UI["Next.js Web App<br/>• Wallet Connection<br/>• Dashboard<br/>• Transaction UI"]
    end
    
    subgraph Backend["⚙️ Backend Layer"]
        API["Express API<br/>• Credit Scoring<br/>• Metadata<br/>• Validation"]
        Cache["Redis Cache<br/>(Planned)"]
    end
    
    subgraph Blockchain["⛓️ Stellar Blockchain"]
        direction LR
        NFT["📜 Remittance NFT<br/>• Store Credit Score<br/>• Lock/Unlock<br/>• History Hash"]
        LM["🏦 Loan Manager<br/>• Request Loan<br/>• Approve/Reject<br/>• Track Repayment"]
        LP["💵 Lending Pool<br/>• Deposit/Withdraw<br/>• Allocate Funds<br/>• Distribute Yield"]
    end
    
    subgraph External["🌐 External Services"]
        Wise["Wise API<br/>(Planned)"]
        WU["Western Union<br/>(Planned)"]
        IPFS["IPFS<br/>(Planned)"]
    end
    
    B --> UI
    L --> UI
    UI <--> API
    API <--> Cache
    API -.-> Wise
    API -.-> WU
    API -.-> IPFS
    UI <--> NFT
    UI <--> LM
    UI <--> LP
    LM <--> NFT
    LM <--> LP
    
    style NFT fill:#e1f5ff,stroke:#0066cc,stroke-width:2px
    style LM fill:#ffe1e1,stroke:#cc0000,stroke-width:2px
    style LP fill:#e1ffe1,stroke:#00cc00,stroke-width:2px
    style UI fill:#fff4e1,stroke:#ff9900,stroke-width:2px
    style API fill:#f0e1ff,stroke:#9900cc,stroke-width:2px
```

## Architecture Principles

1. **Non-Custodial**: Users maintain full control of their funds through Stellar wallets
2. **Transparent**: All transactions, loan terms, and pool balances are recorded on-chain
3. **Decentralized**: No central authority controls the lending process
4. **Composable**: Smart contracts are modular and can be upgraded independently
5. **Auditable**: Open-source code enables community verification and security audits

## High-Level System Overview

```mermaid
graph TB
    subgraph "User Layer"
        B[Borrower]
        L[Lender]
    end
    
    subgraph "Frontend Layer"
        FE[Next.js Frontend]
        W[Stellar Wallet]
    end
    
    subgraph "Backend Layer"
        API[Express API]
        DB[(Metadata Storage)]
    end
    
    subgraph "Blockchain Layer - Stellar/Soroban"
        NFT[Remittance NFT Contract]
        LM[Loan Manager Contract]
        LP[Lending Pool Contract]
    end
    
    B --> FE
    L --> FE
    FE <--> W
    FE <--> API
    API <--> DB
    W <--> NFT
    W <--> LM
    W <--> LP
    LM <--> NFT
    LM <--> LP
    
    style NFT fill:#e1f5ff
    style LM fill:#e1f5ff
    style LP fill:#e1f5ff
```

```mermaid
sequenceDiagram
    participant B as Borrower
    participant F as Frontend
    participant S as Soroban Contracts
    participant N as NFT Contract
    
    B->>F: Connect Wallet
    F->>F: Fetch Account Data
    B->>F: Mint Remittance NFT
    F->>N: call mint_nft(remittance_data)
    N-->>F: NFT Minted
    B->>F: Request Loan
    F->>S: call request_loan(nft_id, amount)
    S-->>F: Loan Pending
    Note right of S: Lender approves loan in different view
    S-->>F: Funds Disbursed
```

## System Components

### Credit Scoring Flow

```mermaid
flowchart LR
    subgraph Input["📊 Data Sources"]
        RH["Remittance History<br/>• Frequency<br/>• Amount<br/>• Consistency"]
        Profile["User Profile<br/>• Duration<br/>• Recipients<br/>• Countries"]
    end
    
    subgraph Processing["🔄 Score Calculation"]
        Collect["Collect Data"]
        Analyze["Analyze Patterns"]
        Calculate["Calculate Score<br/>(0-1000)"]
    end
    
    subgraph Output["✅ Results"]
        Score["Credit Score"]
        Hash["History Hash<br/>(SHA-256)"]
        NFT["Mint NFT"]
    end
    
    RH --> Collect
    Profile --> Collect
    Collect --> Analyze
    Analyze --> Calculate
    Calculate --> Score
    Calculate --> Hash
    Score --> NFT
    Hash --> NFT
    
    style Score fill:#90EE90
    style Hash fill:#87CEEB
    style NFT fill:#FFD700
```

### Loan State Machine

```mermaid
stateDiagram-v2
    [*] --> Requested: Borrower submits<br/>loan request
    
    Requested --> Approved: Lender/System<br/>approves
    Requested --> Rejected: Score too low or<br/>insufficient liquidity
    
    Approved --> Active: Funds disbursed<br/>to borrower
    
    Active --> Repaying: Borrower makes<br/>payments
    Repaying --> Repaying: Partial payment
    Repaying --> Repaid: Final payment
    
    Active --> Defaulted: Payment missed<br/>after due date
    Repaying --> Defaulted: Payment missed<br/>after due date
    
    Repaid --> [*]: NFT unlocked<br/>and returned
    Rejected --> [*]: NFT remains<br/>with owner
    Defaulted --> [*]: NFT seized<br/>by protocol
    
    note right of Requested
        NFT locked as collateral
        Credit score verified
    end note
    
    note right of Active
        Interest accrues
        Repayment schedule set
    end note
    
    note right of Repaid
        Success! Credit score
        may be improved
    end note
```

### 1. Frontend (Next.js Application)

**Location**: `frontend/`

The frontend provides user interfaces for both borrowers and lenders.

**Key Features**:
- Wallet integration (Freighter, Albedo, etc.)
- Borrower dashboard for NFT minting and loan management
- Lender dashboard for pool management and loan approval
- Real-time transaction status updates
- Responsive design for mobile and desktop

**Technology**:
- Next.js 16 (React 19)
- TypeScript for type safety
- Tailwind CSS for styling
- Stellar Wallet Kit for wallet connections

**Key Pages**:
- `/` - Landing page and wallet connection
- `/borrower` - Borrower dashboard (planned)
- `/lender` - Lender dashboard (planned)
- `/loans` - Active loans view (planned)

### 2. Backend (Express.js API)

**Location**: `backend/`

The backend serves as a bridge between the frontend and blockchain, handling off-chain data and providing API endpoints.

**Responsibilities**:
- Generate and verify remittance scores (simulated for MVP)
- Provide NFT metadata (IPFS integration planned)
- Rate limiting and request validation
- API documentation via Swagger
- Future: Integration with remittance APIs (Wise, Western Union)

**Technology**:
- Express.js 5
- TypeScript
- Zod for schema validation
- Swagger for API documentation
- Jest for testing

**Key Endpoints**:
- `GET /api/health` - Health check
- `GET /api/score/:userId` - Get user credit score
- `POST /api/score/simulate` - Simulate remittance history
- `GET /api-docs` - Swagger documentation

**Middleware**:
- `errorHandler` - Centralized error handling
- `validation` - Request validation with Zod
- `rateLimiter` - Rate limiting protection
- `auth` - Authentication (planned)
- `asyncHandler` - Async error wrapper

### 3. Smart Contracts (Soroban/Rust)

**Location**: `contracts/`

Three core smart contracts handle the lending protocol logic on Stellar.

#### 3.1 Remittance NFT Contract

**Location**: `contracts/remittance_nft/`

**Purpose**: Stores borrower credit scores and remittance history as NFTs.

**Key Functions**:
```rust
// Mint a new NFT with credit score
pub fn mint_nft(env: Env, owner: Address, score: u32) -> Result<(), Error>

// Update credit score
pub fn update_score(env: Env, nft_id: u64, new_score: u32) -> Result<(), Error>

// Get current score
pub fn get_score(env: Env, nft_id: u64) -> u32

// Update remittance history hash
pub fn update_history_hash(env: Env, nft_id: u64, hash: BytesN<32>) -> Result<(), Error>
```

**Storage**:
- NFT ID → Owner mapping
- NFT ID → Credit Score
- NFT ID → History Hash (proof of remittance pattern)
- NFT ID → Locked status (when used as collateral)

#### 3.2 Loan Manager Contract

**Location**: `contracts/loan_manager/`

**Purpose**: Manages the complete loan lifecycle from request to repayment.

**Key Functions**:
```rust
// Request a loan using NFT as collateral
pub fn request_loan(env: Env, borrower: Address, nft_id: u64, amount: i128) -> Result<u64, Error>

// Approve a loan request
pub fn approve_loan(env: Env, loan_id: u64) -> Result<(), Error>

// Repay loan
pub fn repay_loan(env: Env, loan_id: u64, amount: i128) -> Result<(), Error>

// Get loan details
pub fn get_loan(env: Env, loan_id: u64) -> Loan
```

**Loan States**:
1. `Requested` - Borrower submitted loan request
2. `Approved` - Lender/system approved the loan
3. `Active` - Funds disbursed, repayment in progress
4. `Repaid` - Fully repaid, NFT unlocked
5. `Defaulted` - Payment missed, NFT seized

**Business Logic**:
- Minimum credit score threshold (e.g., 600)
- Loan-to-value ratio based on score
- Interest rate calculation
- Repayment schedule enforcement

#### 3.3 Lending Pool Contract

**Location**: `contracts/lending_pool/`

**Purpose**: Manages liquidity provided by lenders and fund distribution.

**Key Functions**:
```rust
// Deposit funds into the pool
pub fn deposit(env: Env, lender: Address, amount: i128) -> Result<(), Error>

// Withdraw funds from the pool
pub fn withdraw(env: Env, lender: Address, amount: i128) -> Result<(), Error>

// Get available liquidity
pub fn get_available_liquidity(env: Env) -> i128

// Allocate funds for approved loan
pub fn allocate_funds(env: Env, loan_id: u64, amount: i128) -> Result<(), Error>
```

**Pool Mechanics**:
- Lenders deposit XLM or other Stellar assets
- Funds earn yield from loan interest
- Proportional share tracking for lenders
- Liquidity management and reserve ratios

## Data Flow

### User Journey: Borrower Flow

```mermaid
journey
    title Borrower's Journey to Get a Loan
    section Onboarding
      Visit RemitLend: 5: Borrower
      Connect Wallet: 4: Borrower
      View Dashboard: 5: Borrower
    section Credit Building
      Submit Remittance History: 3: Borrower
      System Calculates Score: 5: System
      Review Credit Score: 4: Borrower
    section NFT Creation
      Mint Remittance NFT: 4: Borrower
      Pay Gas Fee: 3: Borrower
      Receive NFT: 5: Borrower
    section Loan Request
      Browse Loan Options: 5: Borrower
      Select Loan Amount: 4: Borrower
      Submit Loan Request: 4: Borrower
      NFT Locked as Collateral: 3: Borrower
    section Approval
      Wait for Approval: 2: Borrower
      Loan Approved: 5: System
      Receive Funds: 5: Borrower
    section Repayment
      Make Monthly Payments: 3: Borrower
      Track Progress: 4: Borrower
      Final Payment: 4: Borrower
      NFT Unlocked: 5: Borrower
      Credit Score Improved: 5: Borrower
```

### User Journey: Lender Flow

```mermaid
journey
    title Lender's Journey to Earn Yield
    section Onboarding
      Visit RemitLend: 5: Lender
      Connect Wallet: 4: Lender
      View Pool Stats: 5: Lender
    section Deposit
      Review Pool APY: 4: Lender
      Deposit Funds: 4: Lender
      Receive Pool Shares: 5: Lender
    section Monitoring
      Track Pool Performance: 5: Lender
      View Active Loans: 4: Lender
      Monitor Yield: 5: Lender
    section Approval (Optional)
      Review Loan Requests: 4: Lender
      Approve/Reject Loans: 4: Lender
    section Withdrawal
      Check Available Liquidity: 4: Lender
      Withdraw Funds + Yield: 5: Lender
      Receive Payment: 5: Lender
```

### Complete Loan Lifecycle Sequence

```mermaid
sequenceDiagram
    participant B as Borrower
    participant F as Frontend
    participant W as Wallet
    participant API as Backend API
    participant NFT as NFT Contract
    participant LM as Loan Manager
    participant LP as Lending Pool
    
    Note over B,LP: Phase 1: Onboarding & Scoring
    B->>F: Connect Wallet
    F->>W: Request Connection
    W-->>F: Wallet Connected
    
    B->>F: Request Credit Score
    F->>API: GET /api/score/:userId
    API->>API: Calculate Score from Remittance History
    API-->>F: Return Score (e.g., 750)
    
    Note over B,LP: Phase 2: NFT Minting
    B->>F: Mint Remittance NFT
    F->>W: Sign Transaction
    W->>NFT: mint_nft(owner, score=750)
    NFT->>NFT: Store NFT Data
    NFT-->>W: NFT Minted (ID: 1)
    W-->>F: Transaction Confirmed
    F-->>B: NFT Created Successfully
    
    Note over B,LP: Phase 3: Loan Request
    B->>F: Request Loan (amount: 1000 XLM)
    F->>W: Sign Transaction
    W->>LM: request_loan(borrower, nft_id=1, amount=1000)
    LM->>NFT: Verify NFT & Score
    NFT-->>LM: Score: 750 (Valid)
    LM->>NFT: Lock NFT
    LM->>LM: Create Loan Record (Status: Requested)
    LM-->>W: Loan ID: 42
    W-->>F: Transaction Confirmed
    F-->>B: Loan Request Submitted
    
    Note over B,LP: Phase 4: Loan Approval & Disbursement
    Note right of LM: Lender or automated system approves
    LM->>LP: Check Available Liquidity
    LP-->>LM: Available: 5000 XLM
    LM->>LP: allocate_funds(loan_id=42, amount=1000)
    LP->>LP: Reserve 1000 XLM
    LP-->>LM: Funds Allocated
    LM->>W: Transfer 1000 XLM to Borrower
    LM->>LM: Update Loan Status: Active
    LM-->>F: Loan Approved & Disbursed
    F-->>B: Funds Received!
    
    Note over B,LP: Phase 5: Repayment
    B->>F: Make Payment (200 XLM)
    F->>W: Sign Transaction
    W->>LM: repay_loan(loan_id=42, amount=200)
    LM->>LP: Return Funds to Pool
    LP->>LP: Update Available Liquidity
    LM->>LM: Update Loan Balance (800 remaining)
    LM-->>W: Payment Recorded
    W-->>F: Transaction Confirmed
    F-->>B: Payment Successful
    
    Note over B,LP: Phase 6: Loan Completion
    B->>F: Final Payment (800 XLM)
    F->>W: Sign Transaction
    W->>LM: repay_loan(loan_id=42, amount=800)
    LM->>LP: Return Final Funds
    LM->>LM: Update Loan Status: Repaid
    LM->>NFT: Unlock NFT
    NFT-->>LM: NFT Unlocked
    LM-->>W: Loan Fully Repaid
    W-->>F: Transaction Confirmed
    F-->>B: Loan Complete! NFT Returned
```

### Lender Flow

```mermaid
sequenceDiagram
    participant L as Lender
    participant F as Frontend
    participant W as Wallet
    participant LP as Lending Pool
    
    Note over L,LP: Deposit Liquidity
    L->>F: Deposit 5000 XLM
    F->>W: Sign Transaction
    W->>LP: deposit(lender, amount=5000)
    LP->>LP: Update Pool Balance
    LP->>LP: Issue Pool Shares
    LP-->>W: Deposit Confirmed
    W-->>F: Transaction Confirmed
    F-->>L: Earning Yield on 5000 XLM
    
    Note over L,LP: Monitor & Withdraw
    L->>F: View Pool Stats
    F->>LP: get_pool_info()
    LP-->>F: Total: 10000 XLM, Available: 7000 XLM
    F-->>L: Display Pool Health
    
    L->>F: Withdraw 2000 XLM
    F->>W: Sign Transaction
    W->>LP: withdraw(lender, amount=2000)
    LP->>LP: Check Available Liquidity
    LP->>LP: Burn Pool Shares
    LP->>W: Transfer 2000 XLM + Interest
    LP-->>W: Withdrawal Confirmed
    W-->>F: Transaction Confirmed
    F-->>L: Funds Withdrawn
```

## Smart Contract Architecture

### Smart Contract Interactions

```mermaid
graph LR
    subgraph "User Actions"
        B[Borrower]
        L[Lender]
    end
    
    subgraph "Smart Contracts"
        NFT[Remittance NFT]
        LM[Loan Manager]
        LP[Lending Pool]
    end
    
    B -->|1. Mint NFT| NFT
    B -->|2. Request Loan| LM
    LM -->|3. Verify Score| NFT
    LM -->|4. Lock NFT| NFT
    LM -->|5. Check Liquidity| LP
    LM -->|6. Allocate Funds| LP
    LP -->|7. Disburse| B
    B -->|8. Repay| LM
    LM -->|9. Return Funds| LP
    LM -->|10. Unlock NFT| NFT
    
    L -->|Deposit| LP
    L -->|Withdraw| LP
    
    style NFT fill:#e1f5ff
    style LM fill:#ffe1e1
    style LP fill:#e1ffe1
```

### Contract Communication Flow

```mermaid
sequenceDiagram
    autonumber
    participant B as Borrower
    participant NFT as NFT Contract
    participant LM as Loan Manager
    participant LP as Lending Pool
    participant L as Lender
    
    Note over B,L: Phase 1: Setup
    L->>LP: deposit(5000 XLM)
    LP->>LP: Update pool balance
    LP-->>L: Pool shares issued
    
    Note over B,L: Phase 2: NFT Creation
    B->>NFT: mint_nft(score=750)
    NFT->>NFT: Store NFT data
    NFT-->>B: NFT ID: 1
    
    Note over B,L: Phase 3: Loan Request
    B->>LM: request_loan(nft_id=1, amount=1000)
    LM->>NFT: verify_score(nft_id=1)
    NFT-->>LM: score=750 ✓
    LM->>NFT: lock_nft(nft_id=1)
    NFT-->>LM: NFT locked ✓
    LM->>LP: check_liquidity()
    LP-->>LM: available=5000 XLM ✓
    LM-->>B: Loan ID: 42 (Pending)
    
    Note over B,L: Phase 4: Approval & Disbursement
    LM->>LP: allocate_funds(loan_id=42, 1000)
    LP->>LP: Reserve 1000 XLM
    LP-->>LM: Funds allocated ✓
    LM->>B: Transfer 1000 XLM
    LM->>LM: Set status: Active
    
    Note over B,L: Phase 5: Repayment
    B->>LM: repay_loan(loan_id=42, 1000)
    LM->>LP: return_funds(1000 + interest)
    LP->>LP: Update pool balance
    LP->>L: Distribute yield
    LM->>NFT: unlock_nft(nft_id=1)
    NFT-->>B: NFT returned ✓
    LM->>LM: Set status: Repaid
```

### Data Models

#### NFT Data Structure
```rust
pub struct RemittanceNFT {
    pub id: u64,
    pub owner: Address,
    pub score: u32,              // 0-1000 credit score
    pub history_hash: BytesN<32>, // Hash of remittance history
    pub locked: bool,             // True when used as collateral
    pub minted_at: u64,          // Timestamp
}
```

#### Loan Data Structure
```rust
pub struct Loan {
    pub id: u64,
    pub borrower: Address,
    pub nft_id: u64,
    pub amount: i128,            // Loan amount in stroops
    pub interest_rate: u32,      // Basis points (e.g., 500 = 5%)
    pub outstanding: i128,       // Remaining balance
    pub status: LoanStatus,
    pub created_at: u64,
    pub due_date: u64,
}

pub enum LoanStatus {
    Requested,
    Approved,
    Active,
    Repaid,
    Defaulted,
}
```

#### Pool Data Structure
```rust
pub struct LendingPool {
    pub total_deposits: i128,
    pub available_liquidity: i128,
    pub total_loaned: i128,
    pub total_shares: i128,
    pub lenders: Map<Address, LenderInfo>,
}

pub struct LenderInfo {
    pub shares: i128,
    pub deposited_at: u64,
}
```

### Access Control

**Remittance NFT Contract**:
- `mint_nft`: Anyone can mint (with valid score from backend)
- `update_score`: Only authorized minters (backend oracle)
- `lock_nft`: Only Loan Manager contract
- `unlock_nft`: Only Loan Manager contract

**Loan Manager Contract**:
- `request_loan`: Only NFT owner
- `approve_loan`: Only authorized approvers or automated logic
- `repay_loan`: Only borrower
- `default_loan`: Only contract admin (after due date)

**Lending Pool Contract**:
- `deposit`: Any lender
- `withdraw`: Only depositor (with available liquidity)
- `allocate_funds`: Only Loan Manager contract
- `return_funds`: Only Loan Manager contract

## Security Model

### Security Architecture Layers

```mermaid
graph TB
    subgraph Layer1["🔐 Layer 1: User Security"]
        Wallet["Wallet Security<br/>• Private Key Control<br/>• Hardware Wallet Support<br/>• Multi-sig (Planned)"]
        Auth["Authentication<br/>• Wallet Signature<br/>• Session Management<br/>• JWT Tokens (Planned)"]
    end
    
    subgraph Layer2["🛡️ Layer 2: Application Security"]
        Input["Input Validation<br/>• Zod Schemas<br/>• Type Checking<br/>• Sanitization"]
        Rate["Rate Limiting<br/>• API Throttling<br/>• DDoS Protection<br/>• Request Quotas"]
        CORS["CORS Policy<br/>• Origin Whitelist<br/>• Secure Headers<br/>• CSP"]
    end
    
    subgraph Layer3["⚙️ Layer 3: Smart Contract Security"]
        Access["Access Control<br/>• Owner Checks<br/>• Role-based Permissions<br/>• Admin Functions"]
        Validation["Data Validation<br/>• Score Range (0-1000)<br/>• Amount Checks<br/>• State Verification"]
        Reentrancy["Reentrancy Protection<br/>• Soroban Built-in<br/>• State Updates First<br/>• External Calls Last"]
    end
    
    subgraph Layer4["🔒 Layer 4: Network Security"]
        TLS["TLS/HTTPS<br/>• Encrypted Transport<br/>• Certificate Pinning<br/>• Secure WebSocket"]
        Stellar["Stellar Security<br/>• Byzantine Fault Tolerance<br/>• Federated Consensus<br/>• Transaction Signing"]
    end
    
    subgraph Layer5["📊 Layer 5: Monitoring & Response"]
        Logging["Security Logging<br/>• Audit Trail<br/>• Error Tracking<br/>• Anomaly Detection"]
        Alerts["Alert System<br/>• Failed Transactions<br/>• Unusual Activity<br/>• System Health"]
        Recovery["Incident Response<br/>• Contract Pause<br/>• Emergency Withdrawal<br/>• Rollback Plan"]
    end
    
    Layer1 --> Layer2
    Layer2 --> Layer3
    Layer3 --> Layer4
    Layer4 --> Layer5
    
    style Layer1 fill:#ffe1e1
    style Layer2 fill:#fff4e1
    style Layer3 fill:#e1f5ff
    style Layer4 fill:#e1ffe1
    style Layer5 fill:#f0e1ff
```

### Threat Model & Mitigations

```mermaid
mindmap
  root((Security<br/>Threats))
    User Level
      Phishing Attacks
        ::icon(fa fa-shield)
        Wallet Education
        Domain Verification
        Warning Messages
      Private Key Theft
        ::icon(fa fa-key)
        Hardware Wallet Support
        Never Store Keys
        Secure Connection Only
    Application Level
      API Abuse
        ::icon(fa fa-ban)
        Rate Limiting
        Authentication
        Request Validation
      XSS/CSRF
        ::icon(fa fa-bug)
        Input Sanitization
        CSP Headers
        CORS Policy
      Data Breach
        ::icon(fa fa-database)
        Encryption at Rest
        Minimal PII Storage
        Access Logs
    Smart Contract Level
      Reentrancy
        ::icon(fa fa-repeat)
        Soroban Protection
        State Updates First
        Comprehensive Tests
      Access Control
        ::icon(fa fa-lock)
        Owner Verification
        Role Checks
        Admin Functions
      Integer Overflow
        ::icon(fa fa-calculator)
        Rust Type System
        Checked Arithmetic
        Range Validation
    Network Level
      Man-in-Middle
        ::icon(fa fa-user-secret)
        TLS/HTTPS Only
        Certificate Pinning
        Secure WebSocket
      DDoS Attack
        ::icon(fa fa-server)
        Rate Limiting
        CDN Protection
        Load Balancing
```

### Security Considerations

1. **Non-Custodial Design**
   - Users always maintain control of their funds through Stellar wallets
   - No private keys stored on backend or frontend
   - All transactions require user signature

2. **Smart Contract Security**
   - Access control on all sensitive functions
   - Reentrancy protection using Soroban's built-in safeguards
   - Integer overflow protection with Rust's type system
   - Comprehensive test coverage including edge cases

3. **Data Integrity**
   - Remittance history stored as cryptographic hash
   - On-chain verification of credit scores
   - Immutable loan records on blockchain

4. **Rate Limiting & Validation**
   - Backend API rate limiting to prevent abuse
   - Input validation using Zod schemas
   - Transaction validation on smart contracts

5. **Transparency & Auditability**
   - All loan terms recorded on-chain
   - Open-source smart contract code
   - Public transaction history on Stellar

### Threat Model

**Potential Threats**:
- Fake remittance data → Mitigated by backend verification and future API integration
- NFT theft → Mitigated by wallet security and Stellar's built-in protections
- Pool liquidity attacks → Mitigated by withdrawal limits and reserve ratios
- Smart contract bugs → Mitigated by testing, audits, and gradual rollout

**Future Security Enhancements**:
- Multi-signature approval for large loans
- Time-locked withdrawals for lenders
- Insurance fund for defaults
- Third-party security audit
- Bug bounty program

## Technology Stack

### Technology Stack Overview

```mermaid
graph TB
    subgraph Frontend["🎨 Frontend Stack"]
        FE1["Next.js 16<br/>React 19"]
        FE2["TypeScript 5"]
        FE3["Tailwind CSS 4"]
        FE4["Stellar Wallet Kit"]
    end
    
    subgraph Backend["⚙️ Backend Stack"]
        BE1["Node.js 18+"]
        BE2["Express.js 5"]
        BE3["TypeScript 5"]
        BE4["Zod Validation"]
        BE5["Swagger/OpenAPI"]
    end
    
    subgraph Blockchain["⛓️ Blockchain Stack"]
        BC1["Stellar Network"]
        BC2["Soroban Runtime"]
        BC3["Rust + Cargo"]
        BC4["Stellar SDK"]
    end
    
    subgraph Database["💾 Data Stack (Planned)"]
        DB1["PostgreSQL"]
        DB2["Redis Cache"]
        DB3["IPFS Storage"]
    end
    
    subgraph DevOps["🚀 DevOps Stack"]
        DO1["Docker"]
        DO2["Docker Compose"]
        DO3["GitHub Actions"]
        DO4["Vercel"]
    end
    
    subgraph Testing["🧪 Testing Stack"]
        T1["Jest"]
        T2["Supertest"]
        T3["Rust Test Framework"]
        T4["React Testing Library"]
    end
    
    subgraph Tools["🛠️ Development Tools"]
        TL1["ESLint + Prettier"]
        TL2["Clippy + rustfmt"]
        TL3["Git + GitHub"]
        TL4["VS Code"]
    end
    
    Frontend --> Backend
    Frontend --> Blockchain
    Backend --> Database
    Backend --> Blockchain
    DevOps --> Frontend
    DevOps --> Backend
    Testing --> Frontend
    Testing --> Backend
    Testing --> Blockchain
    Tools --> Frontend
    Tools --> Backend
    Tools --> Blockchain
    
    style Frontend fill:#fff4e1
    style Backend fill:#f0e1ff
    style Blockchain fill:#e1f5ff
    style Database fill:#e1ffe1
    style DevOps fill:#ffe1e1
    style Testing fill:#ffe1f0
    style Tools fill:#f0f0f0
```

### Component Technology Mapping

```mermaid
flowchart LR
    subgraph UI["User Interface"]
        Browser["Web Browser"]
        Mobile["Mobile Browser"]
    end
    
    subgraph FE["Frontend Technologies"]
        Next["Next.js 16<br/>• App Router<br/>• Server Components<br/>• API Routes"]
        React["React 19<br/>• Hooks<br/>• Context API<br/>• Suspense"]
        TW["Tailwind CSS 4<br/>• Utility Classes<br/>• Responsive Design<br/>• Dark Mode"]
        TS1["TypeScript<br/>• Type Safety<br/>• Interfaces<br/>• Generics"]
    end
    
    subgraph BE["Backend Technologies"]
        Express["Express.js 5<br/>• REST API<br/>• Middleware<br/>• Error Handling"]
        Zod["Zod<br/>• Schema Validation<br/>• Type Inference<br/>• Error Messages"]
        Swagger["Swagger<br/>• API Docs<br/>• Interactive UI<br/>• OpenAPI Spec"]
        TS2["TypeScript<br/>• Type Safety<br/>• Async/Await<br/>• Decorators"]
    end
    
    subgraph BC["Blockchain Technologies"]
        Stellar["Stellar Network<br/>• 5s Finality<br/>• Low Fees<br/>• Asset Issuance"]
        Soroban["Soroban<br/>• Smart Contracts<br/>• WASM Runtime<br/>• State Storage"]
        Rust["Rust<br/>• Memory Safety<br/>• Zero-cost Abstractions<br/>• Cargo Build"]
        SDK["Stellar SDK<br/>• Transaction Building<br/>• Account Management<br/>• Contract Calls"]
    end
    
    Browser --> Next
    Mobile --> Next
    Next --> React
    Next --> TW
    Next --> TS1
    Next --> Express
    Express --> Zod
    Express --> Swagger
    Express --> TS2
    Next --> SDK
    SDK --> Stellar
    Stellar --> Soroban
    Soroban --> Rust
    
    style Next fill:#000000,color:#ffffff
    style React fill:#61DAFB,color:#000000
    style TW fill:#06B6D4,color:#ffffff
    style Express fill:#000000,color:#ffffff
    style Stellar fill:#7B3FE4,color:#ffffff
    style Rust fill:#CE422B,color:#ffffff
```

### Development Workflow

```mermaid
flowchart TD
    Start([Developer Starts Work]) --> Branch[Create Feature Branch]
    Branch --> Code[Write Code]
    
    Code --> Local{Local Tests}
    Local -->|Pass| Lint[Run Linters]
    Local -->|Fail| Fix1[Fix Issues]
    Fix1 --> Code
    
    Lint -->|Pass| Commit[Commit Changes]
    Lint -->|Fail| Fix2[Fix Linting]
    Fix2 --> Code
    
    Commit --> Push[Push to GitHub]
    Push --> PR[Create Pull Request]
    
    PR --> CI{CI/CD Pipeline}
    CI -->|Build| Build[Build All Components]
    CI -->|Test| Test[Run Test Suites]
    CI -->|Lint| LintCI[Check Code Quality]
    
    Build -->|Fail| Fix3[Fix Build Issues]
    Test -->|Fail| Fix3
    LintCI -->|Fail| Fix3
    Fix3 --> Code
    
    Build -->|Pass| Review{Code Review}
    Test -->|Pass| Review
    LintCI -->|Pass| Review
    
    Review -->|Changes Requested| Fix4[Address Feedback]
    Fix4 --> Code
    
    Review -->|Approved| Merge[Merge to Main]
    Merge --> Deploy{Deploy}
    
    Deploy --> Staging[Deploy to Staging]
    Staging --> StagingTest{Staging Tests}
    StagingTest -->|Fail| Rollback1[Rollback]
    StagingTest -->|Pass| Prod[Deploy to Production]
    
    Prod --> Monitor[Monitor Metrics]
    Monitor --> ProdTest{Health Check}
    ProdTest -->|Fail| Rollback2[Rollback]
    ProdTest -->|Pass| Done([Deployment Complete])
    
    Rollback1 --> Fix5[Fix Issues]
    Rollback2 --> Fix5
    Fix5 --> Code
    
    style Start fill:#90EE90
    style Done fill:#90EE90
    style Rollback1 fill:#FF6B6B
    style Rollback2 fill:#FF6B6B
    style Merge fill:#FFD700
    style Prod fill:#87CEEB
```

### Frontend
- **Framework**: Next.js 16 (React 19)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Wallet Integration**: Stellar Wallet Kit
- **State Management**: React hooks (Context API planned)

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express.js 5
- **Language**: TypeScript
- **Validation**: Zod
- **Documentation**: Swagger/OpenAPI
- **Testing**: Jest, Supertest

### Smart Contracts
- **Platform**: Stellar Soroban
- **Language**: Rust
- **Build Tool**: Cargo
- **Testing**: Rust test framework
- **Deployment**: Soroban CLI

### Infrastructure
- **Containerization**: Docker, Docker Compose
- **Blockchain**: Stellar Testnet (Mainnet planned)
- **Version Control**: Git, GitHub

### Development Tools
- **Linting**: ESLint (TypeScript), Clippy (Rust)
- **Formatting**: Prettier (TypeScript), rustfmt (Rust)
- **CI/CD**: GitHub Actions (planned)

## Deployment Architecture

### Network Architecture

```mermaid
graph TB
    subgraph Internet["🌐 Internet"]
        Users["👥 End Users<br/>(Browsers/Mobile)"]
    end
    
    subgraph CDN["📡 CDN Layer"]
        Vercel["Vercel Edge Network<br/>• Static Assets<br/>• Edge Functions<br/>• Global Distribution"]
    end
    
    subgraph AppLayer["🖥️ Application Layer"]
        FE["Frontend<br/>Next.js App<br/>Port: 3000"]
        API["Backend API<br/>Express Server<br/>Port: 3001"]
    end
    
    subgraph DataLayer["💾 Data Layer"]
        PG["PostgreSQL<br/>(Planned)<br/>• User Profiles<br/>• Metadata"]
        Redis["Redis<br/>(Planned)<br/>• Session Cache<br/>• Rate Limiting"]
        IPFS["IPFS<br/>(Planned)<br/>• NFT Metadata<br/>• Documents"]
    end
    
    subgraph Blockchain["⛓️ Stellar Network"]
        Horizon["Horizon API<br/>• Account Info<br/>• Transactions"]
        Soroban["Soroban RPC<br/>• Contract Calls<br/>• Events"]
        Contracts["Smart Contracts<br/>• NFT<br/>• Loan Manager<br/>• Lending Pool"]
    end
    
    subgraph Monitoring["📊 Monitoring"]
        Logs["Logging<br/>• Application Logs<br/>• Error Tracking"]
        Metrics["Metrics<br/>• Performance<br/>• Usage Stats"]
    end
    
    Users --> Vercel
    Vercel --> FE
    FE --> API
    API --> PG
    API --> Redis
    API --> IPFS
    FE --> Horizon
    FE --> Soroban
    Soroban --> Contracts
    API --> Logs
    API --> Metrics
    FE --> Logs
    
    style Contracts fill:#e1f5ff,stroke:#0066cc,stroke-width:3px
    style FE fill:#fff4e1,stroke:#ff9900,stroke-width:2px
    style API fill:#f0e1ff,stroke:#9900cc,stroke-width:2px
```

### Data Entity Relationships

```mermaid
erDiagram
    USER ||--o{ NFT : owns
    USER ||--o{ LOAN : borrows
    USER ||--o{ DEPOSIT : provides
    NFT ||--|| LOAN : collateralizes
    LOAN }o--|| LENDING_POOL : funded_by
    DEPOSIT }o--|| LENDING_POOL : contributes_to
    
    USER {
        string address PK
        string wallet_type
        timestamp created_at
        int total_nfts
        int active_loans
    }
    
    NFT {
        uint64 id PK
        string owner FK
        uint32 score
        bytes32 history_hash
        bool locked
        timestamp minted_at
        timestamp updated_at
    }
    
    LOAN {
        uint64 id PK
        string borrower FK
        uint64 nft_id FK
        int128 amount
        int128 outstanding
        uint32 interest_rate
        string status
        timestamp created_at
        timestamp due_date
    }
    
    LENDING_POOL {
        int128 total_deposits
        int128 available_liquidity
        int128 total_loaned
        int128 total_shares
        timestamp last_updated
    }
    
    DEPOSIT {
        string lender FK
        int128 amount
        int128 shares
        timestamp deposited_at
        int128 yield_earned
    }
```

### Infrastructure Components

```mermaid
graph TB
    subgraph Production["🚀 Production Environment"]
        subgraph Frontend["Frontend Hosting"]
            V1["Vercel Instance 1<br/>Region: US-East"]
            V2["Vercel Instance 2<br/>Region: EU-West"]
            V3["Vercel Instance 3<br/>Region: Asia-Pacific"]
        end
        
        subgraph Backend["Backend Hosting"]
            LB["Load Balancer<br/>NGINX/AWS ALB"]
            B1["API Server 1<br/>Docker Container"]
            B2["API Server 2<br/>Docker Container"]
            B3["API Server 3<br/>Docker Container"]
        end
        
        subgraph Database["Database Cluster"]
            DBM["PostgreSQL Primary<br/>Read/Write"]
            DBR1["PostgreSQL Replica 1<br/>Read Only"]
            DBR2["PostgreSQL Replica 2<br/>Read Only"]
        end
        
        subgraph Cache["Cache Layer"]
            RC["Redis Cluster<br/>• Session Store<br/>• Rate Limiting<br/>• Query Cache"]
        end
    end
    
    subgraph Stellar["Stellar Network"]
        SN["Stellar Mainnet<br/>• Soroban Contracts<br/>• Transaction History"]
    end
    
    V1 --> LB
    V2 --> LB
    V3 --> LB
    LB --> B1
    LB --> B2
    LB --> B3
    B1 --> DBM
    B2 --> DBM
    B3 --> DBM
    B1 --> DBR1
    B2 --> DBR2
    B3 --> DBR1
    B1 --> RC
    B2 --> RC
    B3 --> RC
    DBM -.Replication.-> DBR1
    DBM -.Replication.-> DBR2
    B1 --> SN
    B2 --> SN
    B3 --> SN
    V1 --> SN
    V2 --> SN
    V3 --> SN
    
    style SN fill:#e1f5ff,stroke:#0066cc,stroke-width:3px
    style LB fill:#ffe1e1,stroke:#cc0000,stroke-width:2px
    style DBM fill:#90EE90,stroke:#006400,stroke-width:2px
```

```mermaid
graph TB
    subgraph "Production Environment"
        subgraph "Frontend Hosting"
            FE[Next.js App<br/>Vercel/Netlify]
        end
        
        subgraph "Backend Hosting"
            API[Express API<br/>Docker Container]
            DB[(Metadata DB<br/>PostgreSQL)]
        end
        
        subgraph "Blockchain"
            ST[Stellar Mainnet]
            NFT_C[NFT Contract]
            LM_C[Loan Manager]
            LP_C[Lending Pool]
        end
    end
    
    subgraph "External Services"
        IPFS[IPFS<br/>NFT Metadata]
        RA[Remittance APIs<br/>Wise, Western Union]
    end
    
    FE <--> API
    FE <--> ST
    API <--> DB
    API <--> IPFS
    API <--> RA
    ST --- NFT_C
    ST --- LM_C
    ST --- LP_C
```

## Future Enhancements

### Phase 2: Enhanced Features
- Real remittance API integration (Wise, Western Union)
- IPFS for NFT metadata storage
- Multi-currency support (USDC, EURC)
- Mobile application (React Native)

### Phase 3: Advanced Functionality
- Automated loan approval based on risk models
- Dynamic interest rates based on market conditions
- Loan refinancing and consolidation
- Credit score improvement tracking

### Phase 4: Governance & Scaling
- DAO governance token
- Community-driven protocol parameters
- Cross-chain bridges
- Institutional lender integration

## Performance Considerations

- **Transaction Speed**: Stellar's 5-second confirmation time
- **Scalability**: Stellar handles 1000+ operations per ledger
- **Cost**: Minimal transaction fees (~0.00001 XLM)
- **Frontend**: Static generation and edge caching with Next.js
- **Backend**: Horizontal scaling with containerization

## Monitoring & Observability

**Planned Monitoring**:
- Smart contract event logging
- API performance metrics
- Transaction success/failure rates
- Pool liquidity levels
- Default rate tracking
- User activity analytics

---

For implementation details, see the code in respective directories. For contribution guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).
