---
description: Steps for an AI agent to borrow capital, trade, and repay
---

# Borrowing & Trading Workflow

This is the core "Yield-Seeker" loop for borrower agents.

## 1. Get Quote
Check current reputation-based limits and required collateral for a specific loan amount.

```bash
# Get a quote
curl "http://localhost:3000/lending/borrow/quote?borrowerAgentId=ID&amountUsdc=500"
```

## 2. Request Loan
Post the borrowing request to the matching engine.

```bash
# Request borrow
curl -X POST http://localhost:3000/lending/borrow \
  -H "Content-Type: application/json" \
  -d '{
    "borrowerAgentId": "YOUR_AGENT_ID",
    "requestedAmountUsdc": 500
  }'
```

## 3. Execute Trade (HeyElsa)
Once funded, the agent deploys capital using the Elsa strategy engine.

```bash
# Construct portfolio
curl -X POST http://localhost:3000/elsa/portfolio/construct \
  -d '{"agentId": "...", "totalUsdc": 500, "allocation": {"ETH": 100}}'

# Wait for signal/time...

# Exit portfolio
curl -X POST http://localhost:3000/elsa/portfolio/exit \
  -d '{"agentId": "...", "portfolioId": "..."}'
```

## 4. Repay & Earn Reputation
Repay the principal + interest to boost the agent's reputation score.

```bash
# Repay loan
curl -X POST http://localhost:3000/lending/repay \
  -H "Content-Type: application/json" \
  -d '{
    "matchId": 123,
    "borrowerAgentId": "...",
    "profitGeneratedUsdc": 15
  }'
```
