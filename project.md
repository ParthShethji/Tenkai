# AgentFi — Complete Build Summary
> Handoff document for continued development

---

## What We Are Building

A **multi-agent P2P lending marketplace** where AI agents autonomously borrow capital, deploy it via quantitative trading strategies (HeyElsa), and repay with profit. The platform acts as the market maker. Users define strategy signals; agents execute them. Reputation is earned through repayment discipline, not alpha generation.

---

## Core Concepts in One Line Each

| Concept | One Line |
|---|---|
| Agent identity | Each agent = user-owned ENS name, ZK-verified to a unique human |
| Wallet model | 2-of-2 multisig hot wallet, no MetaMask connection |
| Transaction gate | Auto-sign ≤500 USDC rolling/hr; user approval above |
| Reputation | 0–50 scale, repayment-only signals, continuous collateral curve |
| Loan type | Collateral % = `max(0, (35 − rep) × 2.86)%` — no binary cliff |
| Strategy | User defines quant signals → Elsa constructs portfolio |
| Matching | Platform orderbook (market maker), lenders post offers, borrowers request |
| Anti-exploit | userId isolation: same-user agents can never match each other |

---

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React SPA | Dashboard, create agent, history, signal editor |
| API | Express (Node.js) | REST + agent HTTP bus |
| Database | PostgreSQL | users, agents, event_log, reputation_snapshots |
| Cache | Redis | Agent live state, rolling tx volume window |
| Wallet | BitGo SDK | USDC vault, multisig wallet generation |
| Trading | HeyElsa API | Portfolio construction, swap execution |
| Identity | ENS (Base Sepolia) | Any valid ENS name the user owns, verified via wallet + ZK |
| Strategy storage | Fileverse | Encrypted per-agent risk/signal doc |
| On-chain rep | PeosFi contracts | Reputation score, loan, repay — Base Sepolia |
| ZK bootstrap | Reclaim Protocol | Mandatory one-time human verification per ENS (anti-sybil) |
| Key security | AWS KMS / HSM | Platform co-signer key, never in app memory |

---

## Identity Model

Users bring their own ENS name (e.g. `alice.eth`, `vault.base.eth`). Anti-sybil is enforced via mandatory ZK human verification through Reclaim Protocol.

```
alice.eth       → ZK-verified human #1 → agent wallet (multisig)
bob.eth         → ZK-verified human #2 → agent wallet (multisig)
yield-gamma.eth → ZK-verified human #3 → agent wallet (multisig)
```

**Why ZK verification replaces platform-owned subdomains:** Each ENS name is mapped to a unique human via ZK proof. The `human_id` (derived from the ZK proof) is stored with a UNIQUE constraint in the DB. The same human cannot register a second ENS name, preventing sybil attacks and self-matching. The on-chain `ensNameToWallet` mapping prevents the same ENS from being registered twice.

### Unified Agent Record (agentId is the spine)

Every external reference maps back to one UUID:

```
agentId (UUID, primary key)
  ├── userId (FK → users table, with unique human_id from ZK proof)
  ├── ensName          → alice.eth (user-owned ENS name)
  ├── walletAddress    → multisig 2-of-2 address
  ├── fileverseDocId   → encrypted strategy doc
  ├── bitgoWalletId    → USDC vault reference
  ├── reputationScore  → live, from on-chain contract
  └── event_log rows   → append-only history
```

---

## Wallet Architecture — 2-of-2 Multisig

No user MetaMask. Platform creates a fresh multisig per agent at registration.

```
Agent key (generated at spawn, held by agent.js process)
  +
Platform co-signer key (AWS KMS / HSM, rotated per agent batch)
  =
2-of-2 signature required to broadcast any tx
```

### Transaction Gate Logic

```
Rolling 60-minute cumulative volume per agent (Redis)

IF cumulative_volume_1hr ≤ 500 USDC:
    platform auto-signs → broadcast immediately

IF cumulative_volume_1hr > 500 USDC:
    push notification to user → wait for approval
    30-min time delay for loans > 1000 USDC (detection window)
    on approval → platform co-signs → broadcast
```

**Attack prevented:** Transaction splitting — 3×333 USDC in 10 minutes still triggers the gate because the rolling window catches cumulative volume, not per-tx amount.

---

## Reputation System — Finalized Constants

### Scale: 0–50

| Parameter | Value | Derivation |
|---|---|---|
| **Zero-collateral crossover C₀** | **rep 35** | Crossover where cumulative platform interest ≥ expected loss on default (8% base default rate, DeFi unsecured benchmark) |
| **New agent baseline** | **rep 25** | 5 clean cycles to reach C₀ — the apprenticeship period |
| **Sibling bootstrap max** | **rep 33** | baseline + 8, never reaches C₀ automatically |
| **ZK vouching (one-time)** | **+8 capped** | Cold-start max = 33, still 2 cycles short of C₀ |

### Continuous Collateral Curve (no binary cliff)

```
collateral_required % = max(0, (35 − rep) × 2.86)

rep 0  → 100% collateral
rep 25 → 28.6% collateral  (new agent baseline)
rep 35 → 0% collateral     (zero-collateral crossover)
rep 50 → 0% collateral     (max rep, best rates)
```

### Loan Terms (continuous, not tiered)

```
max_loan_USDC   = rep × 20
interest_floor  = max(0.5%,  3.5% − rep × 0.06%)
```

| Rep | Max Loan | Collateral | Interest Floor |
|---|---|---|---|
| 25 (new agent) | 500 USDC | 28.6% | ~2.0% |
| 30 | 600 USDC | 14.3% | ~1.7% |
| 35 (crossover) | 700 USDC | 0% | ~1.4% |
| 45 | 900 USDC | 0% | ~0.8% |
| 50 (max) | 1000 USDC | 0% | ~0.5% |

### Score Delta Table (repayment discipline only — alpha excluded)

| Event | Delta | Source |
|---|---|---|
| Repay on time, profit generated | +2 | Repayment |
| Repay on time, no profit (covered interest) | +1 | Repayment |
| Late repayment (>10% past due) | −2 | Risk event |
| Partial repayment (<80% of owed) | −4 | Risk event |
| Default (0 repayment) | −10 | Risk event |
| ZK human vouching (non-repeatable) | +8 capped | Bootstrap |
| Inactivity decay (>60 days dormant) | −0.5/30d | Decay |
| ~~Signal alpha outperforms~~ | ~~+2~~ | **Removed** |
| ~~Signal underperforms~~ | ~~−1~~ | **Removed** |

**Why alpha is excluded from reputation:** High-alpha agents tend to be high-volatility. Rewarding them with easier capital compounds tail risk — if multiple high-rep agents default in the same volatile cycle, cascading lender losses follow. Signal quality affects the *interest rate a lender offers*, not the reputation score.

### Sibling Bootstrap Formula (revised)

```python
# Only cross-user repayment volume counts (self-loans excluded)
S_siblings = Σ(rep_i × crossUserVolume_i) / Σ(crossUserVolume_i)
siblingBonus = min(8, S_siblings - 25)
initialScore = 25 + siblingBonus   # max 33
```

---

## Quant + Strategy Layer

User defines signal rules (stored encrypted in Fileverse). These feed Elsa's portfolio construction engine when the agent is live.

```
User signal doc (Fileverse, encrypted):
  - model type: momentum / mean-reversion / arb / custom
  - entry/exit triggers
  - allocation weights
  - risk parameters (max drawdown, stop-loss)

→ Elsa reads signals on each cycle
→ Constructs portfolio allocation (e.g. 60% ETH, 40% stablecoin yield)
→ Executes via HeyElsa swap API
→ Alpha generated feeds lender's interest rate pricing (not rep score)
```

Signal quality is surfaced to lenders via the orderbook — a sophisticated lender agent can optionally read the borrower's Fileverse doc and price their interest rate offer accordingly. Incentive survives, score corruption does not.

---

## P2P Matching Engine

Platform is the **market maker**, not a simple router.

### Orderbook Structure

```
Lend orderbook:
  { lenderAgentId, minRepRequired, maxAmount, interestRate, expiresAt }
  Sorted by: lowest rate first

Borrow orderbook:
  { borrowerAgentId, requestedAmount, currentRep }
  Sorted by: highest rep first
```

### Match Algorithm

```python
for borrow_request in borrow_orderbook:
    eligible_offers = [
        o for o in lend_orderbook
        if o.minRepRequired <= borrow_request.currentRep
        and o.maxAmount >= borrow_request.requestedAmount
    ]
    best_match = min(eligible_offers, key=lambda o: o.interestRate)
    if best_match:
        create_match(borrow_request, best_match)
```

### Anti-Exploit Rule (enforced at match time)

```python
# Hard block — checked on every match attempt
if lender.userId == borrower.userId:
    REJECT  # same user cannot match their own agents
```

This check lives in the matcher service AND is logged on-chain in the loan record. Both layers must agree.

### Settlement Flow

```
1. Match record created  (lenderId, borrowerId, amount, rate, terms)
2. Lender funds verified in BitGo escrow  (locked at order-post time)
3. Multisig tx built  → platform checks rolling volume gate
4. If auto-sign: broadcast immediately
5. If user approval needed: push notification → wait → co-sign
6. Borrower wallet receives USDC
7. Elsa executes portfolio per signal rules
8. Repayment tx built at due time  → same multisig gate
9. USDC returns to lender + interest
10. PeosFi contract updates rep score on-chain
11. Rep score feeds next match priority in orderbook
```

---

## Database Schema (key tables)

```sql
users         (userId, email, walletAddress, zkProofStatus, humanId, createdAt)
agents        (agentId, userId, ensName, walletAddress, fileverseDocId,
               bitgoWalletId, role, status, reputationScore, createdAt)
event_log     (eventId, agentId, type, amount, counterpartyAgentId,
               txHash, repDelta, timestamp)  -- append-only
rep_snapshots (snapshotId, agentId, score, delta, source, onChainTxHash, timestamp)
matches       (matchId, lenderAgentId, borrowerAgentId, amount, rate,
               status, settledAt, txHash)
```

**Redis keys:**
```
agent:{agentId}:state          → { status, repScore, activeLoan }
agent:{agentId}:vol_1hr        → rolling USDC volume (TTL 3600s)
orderbook:lend                 → sorted set by rate
orderbook:borrow               → sorted set by rep
```

---

## Security Decisions Summary

| Attack | Mitigation |
|---|---|
| Sybil wash-trading ring | userId isolation at match time; intra-user loans excluded from rep calculation |
| Cliff farming | Continuous collateral curve — no cliff to exploit |
| Bootstrap amplification | Sibling formula uses cross-user volume only; capped at rep 33 |
| Transaction splitting | Rolling 60-min cumulative volume gate in Redis |
| Fake lend offer spoofing | Lender funds escrowed at order-post time; cancel = −1 rep |
| ENS sybil self-match bypass | ZK human verification: one human per ENS, `human_id` UNIQUE in DB, on-chain `ensNameToWallet` prevents duplicate ENS |
| Platform key compromise | Co-signer key in KMS/HSM; per-batch rotation; 30-min delay >1000 USDC |
| Signal oracle manipulation | Alpha excluded from rep; only affects lender's rate pricing |
| Score decay absence | −0.5/30d after 60 days inactivity |

---

## Calibration Note

The rep 35 crossover is derived from an **8% base default rate** (DeFi unsecured lending benchmark). Post-launch calibration:

```
Observed default rate < 6%  →  lower C₀ to 32
Observed default rate 6–10% →  keep C₀ at 35
Observed default rate > 10% →  raise C₀ to 38
```

The formula stays the same — only the empirical input changes.

---

## What Is Not Built Yet (cut for hackathon)

- Beautiful frontend UI (terminal logs + one status page is enough for demo)
- Multi-chain support (Base only)
- Telegram notifications
- X402 micropayments
- Full KMS integration (mock co-signer acceptable for demo)
- Real Elsa signal tuning (hardcode a simple 60/40 ETH/stablecoin split for demo)

---

## Demo Script (4-agent flow)

```
1. Show Fileverse docs — 4 agents, 4 encrypted strategies
2. Show ENS names registered by ZK-verified users
3. Start all 4 agents — terminal logs light up
4. agent4 (rep 25) tries to borrow → rejected by vault-alpha (minRep 35)
5. Human runs ZK proof → agent4 rep goes to 33
6. agent4 tries vault-beta (minRep 30) → approved
7. Loan hits BitGo → Elsa constructs portfolio → trade executes
8. Repayment → rep updates on-chain → dashboard reflects live state
```

---

*Last updated from architecture review session. Next: implement matcher service and multisig wallet generation.*
