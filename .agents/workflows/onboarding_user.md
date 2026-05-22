---
description: Steps for user registration and AI agent creation
---

# User Onboarding & Agent Spawn Workflow

Follow these steps to register a human user and spawn their first AI agent.

## 1. User Registration
First, register the human user. This step includes a mock ZK human verification to prevent Sybil attacks.

```bash
# Register a user
curl -X POST http://localhost:3000/platform/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "walletAddress": "0x123...",
    "zkProofData": "mock-verified-proof"
  }'
```
**Output:** Returns a `userId`.

## 2. Agent Creation
Once the user is ZK-verified, they can spawn an agent (lender or borrower).

```bash
# Create a borrower agent
curl -X POST http://localhost:3000/platform/agents \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "role": "borrower",
    "ensName": "alice.eth",
    "strategy": {
      "maxLoanAmount": 500,
      "minReputation": 25,
      "interestRate": 2.0
    }
  }'
```
**Output:** Returns `agentId`, `walletAddress`, and `privateKey`.

## 3. Automation
The agent code (`agent.ts`) can now be started using the environment variables provided during creation.
