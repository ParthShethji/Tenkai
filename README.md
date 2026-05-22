Hii
# AgentFi Lending Platform

AgentFi is a **multi-agent P2P lending marketplace** where AI agents autonomously borrow capital, deploy it via quantitative trading strategies, and repay with profit.

## Project Overview

- **Agent Identity**: Each agent registers with any valid ENS name they own. Anti-sybil is enforced via ZK human verification.
- **Wallet Model**: 2-of-2 multisig hot wallet (Agent key + Platform co-signer key).
- **Reputation System**: Rep-based loan terms and collateral requirements (0-50 scale).
- **Matching Engine**: Platform acts as a market maker, matching lender offers with borrower requests.

---

## 📂 Project Structure

- `contracts/`: Solidity smart contracts for reputation-aware lending.
- `scripts/`: Deployment and demo seeding scripts.
- `test/`: Hardhat contract tests and Jest backend tests.
- `frontend/`: React + Vite dashboard for managing agents and monitoring loans.
- `blockchain.service.ts`: Ethers.js integration for talking to the chain.
- `lending.service.ts`: Core business logic for matching and loan management.
- `server.ts`: Express API entry point.

---

## 🛠️ Getting Started

### Prerequisites

- **Node.js** (v18+)
- **npm**
- **Git**
- **PostgreSQL** & **Redis** (Optional: the backend uses `pg-mem` and in-memory mocks if credentials are missing).

### 1. Installation

Install root and frontend dependencies:

```bash
npm install
npm --prefix frontend install
```

### 2. Project Configuration

Copy the example environment files:

```bash
# Backend
cp .env.example .env

# Frontend
cp frontend/.env.example frontend/.env
```

### 3. Smart Contract Deployment (Local)

Start a local Hardhat node in a separate terminal:

```bash
npx hardhat node
```

Deploy the contracts to the local network (this updates your `.env` automatically):

```bash
npm run deploy:localhost
```

### 4. Seed Demo Data

Populate the database with initial agents and users:

```bash
npm run seed:demo
```

---

## 🚀 Running the Application

### Start the Backend

```bash
npm run dev:backend
```

- **Health Check**: `http://localhost:3000/health`

### Start the Frontend

```bash
npm run frontend:dev
```

- **Dashbaord**: `http://localhost:5173`

---

## 🧪 Testing

### Contract Tests

```bash
npm run test:contract
```

### Backend API Tests

```bash
npm run test:backend
```

---

## 🌐 Testnet Runbook (Base Sepolia)

1. Set `RPC_URL` and `PLATFORM_PRIVATE_KEY` in `.env`.
2. Deploy to Base Sepolia: `npm run deploy:base-sepolia`.
3. Fund the generated agent wallets with test USDC and ETH.
4. Use the frontend "Onboarding" section to register agents.

## 📜 Key Scripts

| Command | Description |
|---|---|
| `npm run dev:backend` | Starts the Express server with `ts-node`. |
| `npm run deploy:localhost` | Deploys contracts and updates `.env`. |
| `npm run seed:demo` | Seeds local DB with demo agents. |
| `npm run frontend:dev` | Starts the Vite dev server for React. |
| `npm run test:backend` | Runs the Jest test suite. |

