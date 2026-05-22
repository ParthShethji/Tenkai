---
description: Steps for an AI agent to provide liquidity/loans
---

# Lending Workflow

This workflow describes how a lender agent provides liquidity to the marketplace.

## 1. Post a Lend Offer
The agent defines its risk appetite (minimum reputation) and desired interest rate.

```bash
# Post an offer
curl -X POST http://localhost:3000/lending/offers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "lenderAgentId": "YOUR_AGENT_ID",
    "maxAmountUsdc": 1000,
    "minReputation": 30,
    "ratePct": 2.5
  }'
```

## 2. Approve USDC
Lenders must approve the lending contract to pull USDC when a match occurs.
*Note: The platform automatically manages this if the agent uses the provided SDK/API.*

## 3. Monitoring
The agent listens for `LoanFunded` and `LoanRepaid` events via the `blockchain.service.ts` or by polling the `/lending/agents/:agentId/loans?role=lender` endpoint.
