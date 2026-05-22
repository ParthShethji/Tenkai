/**
 * lending.service.ts
 *
 * Orchestration layer between the REST API and the blockchain service.
 */

import * as blockchain from "./blockchain.service";
import { ethers } from "ethers";
// @ts-ignore
const db = require("./config/db");
// @ts-ignore
const redis = require("./config/redis");
// @ts-ignore
const logger = require("./utils/logger");

// ─── Constants ────────────────────────────────────────────────────────────────

const REP_ZERO_COLLATERAL = 35;   // C₀ — matches contract constant
const BASE_RATE_PCT = 3.5;        // 3.5% max interest rate
const FLOOR_RATE_PCT = 0.5;       // 0.5% minimum
const RATE_PER_REP = 0.06;        // each rep point reduces rate by 0.06%
const MAX_LOAN_USDC = 1000;
const ROLLING_WINDOW_SECS = 3600; // 1 hour volume window for tx gate
const TX_GATE_USDC = 500;         // auto-sign threshold
const DECAY_ONSET_DAYS = 60;
const DECAY_RATE = 0.5;           // rep points per 30 days inactive

function roundUsdc(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

async function loadWalletPrivateKey(walletAddress: string) {
  const { getAgentPrivateKey, loadAgentPrivateKey } = require("./config/agentKeys");
  return getAgentPrivateKey(walletAddress) || await loadAgentPrivateKey(walletAddress);
}

async function ensureUsdcAllowance(
  walletAddress: string,
  requiredAmountUsdc: number,
  ownerLabel: string
) {
  if (requiredAmountUsdc <= 0) return;

  const allowance = await blockchain.checkAllowance(walletAddress);
  if (allowance >= requiredAmountUsdc) return;

  const privateKey = await loadWalletPrivateKey(walletAddress);
  if (!privateKey) {
    throw new Error(
      `${ownerLabel} must approve ${roundUsdc(requiredAmountUsdc)} USDC before proceeding. No private key available for auto-approve.`
    );
  }

  await blockchain.approveUsdc(privateKey, roundUsdc(requiredAmountUsdc));
}

// ─── Interest calculation ─────────────────────────────────────────────────────

export function calculateInterest(principalUsdc: number, borrowerRep: number) {
  const rate = Math.max(FLOOR_RATE_PCT, BASE_RATE_PCT - borrowerRep * RATE_PER_REP);
  const interest = (principalUsdc * rate) / 100;
  return {
    interestUsdc: Math.round(interest * 1e6) / 1e6,
    ratePct: rate,
  };
}

// ─── Anti-sybil userId check ──────────────────────────────────────────────────

export async function assertDifferentOwners(borrowerAgentId: string, lenderAgentId: string) {
  const { rows } = await db.query(
    `SELECT agent_id::text AS agent_id, user_id::text AS user_id
     FROM agents
     WHERE agent_id = $1 OR agent_id = $2`,
    [borrowerAgentId, lenderAgentId]
  );

  if (rows.length < 2) throw new Error("One or both agents not found");

  const borrowerId = borrowerAgentId.toLowerCase();
  const lenderId = lenderAgentId.toLowerCase();
  const borrowerRow = rows.find((r: any) => String(r.agent_id).toLowerCase() === borrowerId);
  const lenderRow   = rows.find((r: any) => String(r.agent_id).toLowerCase() === lenderId);

  if (!borrowerRow || !lenderRow) throw new Error("One or both agents not found");

  if (borrowerRow.user_id === lenderRow.user_id) {
    throw new Error(
      `SYBIL_BLOCK: Borrower and lender belong to same userId ${borrowerRow.user_id}. Self-matching is not allowed.`
    );
  }
}

// ─── Rolling volume gate (Redis) ──────────────────────────────────────────────

export async function checkVolumeGate(agentId: string, amountUsdc: number) {
  const key = `agent:${agentId}:vol_1hr`;
  const currentStr = await redis.get(key);
  const current = currentStr ? parseFloat(currentStr) : 0;
  const projected = current + amountUsdc;

  return {
    allowed: true,
    requiresApproval: projected > TX_GATE_USDC,
    currentVolume: current,
    projectedVolume: projected,
  };
}

async function incrementVolumeGate(agentId: string, amountUsdc: number) {
  const key = `agent:${agentId}:vol_1hr`;
  const current = parseFloat(await redis.get(key) || "0");
  const newVal = current + amountUsdc;
  await redis.setex(key, ROLLING_WINDOW_SECS, String(newVal));
  return newVal;
}

async function resetVolumeGate(agentId: string) {
  await redis.del(`agent:${agentId}:vol_1hr`);
}

// ─── Agent data helpers ───────────────────────────────────────────────────────

async function getAgentById(agentId: string) {
  const { rows } = await db.query(
    `SELECT agent_id, user_id, ens_name, wallet_address, role, status, reputation_score
     FROM agents WHERE agent_id = $1`,
    [agentId]
  );
  if (!rows.length) throw new Error(`Agent not found: ${agentId}`);
  return rows[0];
}

async function getAgentRepFromDb(walletAddress: string) {
  const { rows } = await db.query(
    `SELECT reputation_score FROM agents WHERE wallet_address = $1`,
    [walletAddress]
  );
  if (!rows.length) throw new Error("Agent not found in DB");
  return { score: rows[0].reputation_score };
}

async function updateAgentRepInDb(walletAddress: string, newScore: number) {
  await db.query(
    `UPDATE agents SET reputation_score = $1 WHERE wallet_address = $2`,
    [newScore, walletAddress]
  );
  const { rows } = await db.query(
    `SELECT agent_id FROM agents WHERE wallet_address = $1`,
    [walletAddress]
  );
  if (rows.length) {
    const state = JSON.parse(await redis.get(`agent:${rows[0].agent_id}:state`) || "{}");
    state.reputationScore = newScore;
    await redis.set(`agent:${rows[0].agent_id}:state`, JSON.stringify(state));
  }
}

// ─── Event log writer ─────────────────────────────────────────────────────────

async function logEvent({ agentId, type, amount, counterpartyAgentId, txHash, repDelta }: any) {
  await db.query(
    `INSERT INTO event_log
       (agent_id, type, amount, counterparty_agent_id, tx_hash, rep_delta, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [agentId, type, amount, counterpartyAgentId, txHash, repDelta]
  );
}

// ─── Lend offer orderbook ─────────────────────────────────────────────────────

export async function postLendOffer({ lenderAgentId, maxAmountUsdc, minRepRequired, ratePct }: any) {
  const lender = await getAgentById(lenderAgentId);
  if (lender.role !== "lender") throw new Error("Agent is not a lender");
  if (lender.status !== "active") throw new Error("Lender agent is not active");

  await blockchain.ensureAgentRegistered(lender.wallet_address, lender.ens_name, lender.reputation_score || 35);

  const usdcBalance = await blockchain.checkBalance(lender.wallet_address);
  if (usdcBalance < maxAmountUsdc) {
    throw new Error(
      `Lender agent wallet needs ${maxAmountUsdc} USDC before posting an offer. Current balance: ${usdcBalance} USDC. Fund the agent wallet from the connected user wallet first.`
    );
  }

  const allowance = await blockchain.checkAllowance(lender.wallet_address);
  if (allowance < maxAmountUsdc) {
    const privateKey = await loadWalletPrivateKey(lender.wallet_address);
    if (privateKey) {
      await blockchain.approveUsdc(privateKey, maxAmountUsdc * 10);
    } else {
      throw new Error(`Lender must approve contract before posting offer. No private key available for auto-approve.`);
    }
  }

  const { rows } = await db.query(
    `INSERT INTO lend_offers
       (lender_agent_id, max_amount_usdc, min_rep_required, rate_pct, status, created_at)
     VALUES ($1, $2, $3, $4, 'open', NOW())
     RETURNING offer_id`,
    [lenderAgentId, maxAmountUsdc, minRepRequired, ratePct]
  );

  logger.info(`[lending] lend offer posted offerId=${rows[0].offer_id}`);
  return rows[0].offer_id;
}

export async function cancelLendOffer(offerId: number, lenderAgentId: string) {
  const { rows } = await db.query(
    `UPDATE lend_offers SET status='cancelled'
     WHERE offer_id = $1 AND lender_agent_id = $2 AND status = 'open'
     RETURNING *`,
    [offerId, lenderAgentId]
  );
  if (!rows.length) throw new Error("Offer not found or already closed");

  const lender = await getAgentById(lenderAgentId);
  const currentRep = await getAgentRepFromDb(lender.wallet_address);
  const newScore = Math.max(0, currentRep.score - 1);

  await updateAgentRepInDb(lender.wallet_address, newScore);
  logger.info(`[lending] offer ${offerId} cancelled, rep penalty applied`);
}

// ─── Borrow request + matching ────────────────────────────────────────────────

export async function requestBorrow({ borrowerAgentId, requestedAmountUsdc }: any) {
  const borrower = await getAgentById(borrowerAgentId);
  if (borrower.role !== "borrower") throw new Error("Agent is not a borrower");
  if (borrower.status !== "active") throw new Error("Borrower agent is not active");

  await blockchain.ensureAgentRegistered(borrower.wallet_address, borrower.ens_name, borrower.reputation_score || 25);

  const repData = await getAgentRepFromDb(borrower.wallet_address);
  const maxLoan = await blockchain.getMaxLoanSize(repData.score);

  if (requestedAmountUsdc > maxLoan) {
    throw new Error(`Requested amount exceeds rep-based cap`);
  }

  const gate = await checkVolumeGate(borrowerAgentId, requestedAmountUsdc);
  if (gate.requiresApproval) {
    const { rows } = await db.query(
      `INSERT INTO pending_approvals
         (agent_id, type, amount_usdc, status, created_at)
       VALUES ($1, 'borrow_request', $2, 'pending_user', NOW())
       RETURNING approval_id`,
      [borrowerAgentId, requestedAmountUsdc]
    );
    logger.warn(`pending user approval approvalId=${rows[0].approval_id}`);
    return { status: "pending_user_approval", approvalId: rows[0].approval_id };
  }

  return _executeMatch({ borrower, repData, requestedAmountUsdc });
}

export async function approvePendingBorrow(approvalId: number, userId: string) {
  const { rows } = await db.query(
    `SELECT pa.*, a.user_id FROM pending_approvals pa
     JOIN agents a ON pa.agent_id = a.agent_id
     WHERE pa.approval_id = $1 AND a.user_id = $2 AND pa.status = 'pending_user'`,
    [approvalId, userId]
  );
  if (!rows.length) throw new Error("Pending approval not found");

  const pending = rows[0];
  await db.query(`UPDATE pending_approvals SET status='approved' WHERE approval_id = $1`, [approvalId]);

  const borrower = await getAgentById(pending.agent_id);
  const repData = await getAgentRepFromDb(borrower.wallet_address);

  return _executeMatch({ borrower, repData, requestedAmountUsdc: pending.amount_usdc });
}

async function _executeMatch({ borrower, repData, requestedAmountUsdc }: any) {
  const { rows: offers } = await db.query(
    `SELECT lo.*, a.wallet_address as lender_wallet, a.agent_id as lender_agent_id,
            a.ens_name as lender_ens, a.user_id as lender_user_id
     FROM lend_offers lo
     JOIN agents a ON lo.lender_agent_id = a.agent_id
     WHERE lo.status = 'open'
       AND lo.min_rep_required <= $1
       AND lo.max_amount_usdc >= $2
     ORDER BY lo.rate_pct ASC
     LIMIT 1`,
    [repData.score, requestedAmountUsdc]
  );

  if (!offers.length) {
    await db.query(
      `INSERT INTO borrow_queue (borrower_agent_id, requested_amount_usdc, rep_at_request, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [borrower.agent_id, requestedAmountUsdc, repData.score]
    );
    return { status: "queued", message: "No eligible lender found, added to queue" };
  }

  const offer = offers[0];
  await assertDifferentOwners(borrower.agent_id, offer.lender_agent_id);

  if (!ethers.isAddress(borrower.wallet_address)) {
    throw new Error(
      `Invalid borrower wallet_address for agent ${borrower.agent_id}: ${borrower.wallet_address}`
    );
  }
  if (!ethers.isAddress(offer.lender_wallet)) {
    throw new Error(
      `Invalid lender wallet_address for agent ${offer.lender_agent_id}: ${offer.lender_wallet}`
    );
  }

  await blockchain.ensureAgentRegistered(offer.lender_wallet, offer.lender_ens, 35);

  const { interestUsdc, ratePct } = calculateInterest(requestedAmountUsdc, repData.score);
  const collateralNeededUsdc = await blockchain.getRequiredCollateral(
    repData.score,
    requestedAmountUsdc
  );

  if (collateralNeededUsdc > 0) {
    await ensureUsdcAllowance(
      borrower.wallet_address,
      collateralNeededUsdc,
      "Borrower"
    );
  }

  const requestResult = await blockchain.requestLoan({
    borrowerWallet: borrower.wallet_address,
    lenderWallet:   offer.lender_wallet,
    principalUsdc:  requestedAmountUsdc,
    interestUsdc,
    borrowerEns:    borrower.ens_name,
    lenderEns:      offer.lender_ens,
    vcScore:        repData.score,
  });

  const fundResult = await blockchain.fundLoan(requestResult.loanId);

  await db.query(`UPDATE lend_offers SET status='filled' WHERE offer_id = $1`, [offer.offer_id]);

  const { rows: matchRows } = await db.query(
    `INSERT INTO matches (lender_agent_id, borrower_agent_id, amount_usdc, interest_usdc, rate_pct, collateral_usdc, borrower_rep_at_origination, loan_id_onchain, status, funded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', NOW())
     RETURNING match_id`,
    [
      offer.lender_agent_id,
      borrower.agent_id,
      requestedAmountUsdc,
      interestUsdc,
      ratePct,
      requestResult.collateralLocked,
      repData.score,
      requestResult.loanId,
    ]
  );
  const matchId = matchRows[0].match_id;

  await incrementVolumeGate(borrower.agent_id, requestedAmountUsdc);

  await logEvent({ agentId: borrower.agent_id, type: "loan_borrowed", amount: requestedAmountUsdc, counterpartyAgentId: offer.lender_agent_id, txHash: fundResult.txHash, repDelta: 0 });
  await logEvent({ agentId: offer.lender_agent_id, type: "loan_funded", amount: requestedAmountUsdc, counterpartyAgentId: borrower.agent_id, txHash: fundResult.txHash, repDelta: 0 });

  const borrowerState = JSON.parse(await redis.get(`agent:${borrower.agent_id}:state`) || "{}");
  borrowerState.activeLoanId = requestResult.loanId;
  borrowerState.activeLoanUsdc = requestedAmountUsdc;
  await redis.set(`agent:${borrower.agent_id}:state`, JSON.stringify(borrowerState));

  return { status: "funded", matchId, loanId: requestResult.loanId, principalUsdc: requestedAmountUsdc, interestUsdc, ratePct, collateralLockedUsdc: requestResult.collateralLocked, fundTxHash: fundResult.txHash, requestTxHash: requestResult.txHash };
}

// ─── Repayment ────────────────────────────────────────────────────────────────

export async function repayLoan({ matchId, borrowerAgentId, profitGeneratedUsdc }: any) {
  const { rows } = await db.query(
    `SELECT m.*, a.wallet_address as borrower_wallet FROM matches m
     JOIN agents a ON m.borrower_agent_id = a.agent_id
     WHERE m.match_id = $1 AND m.borrower_agent_id = $2 AND m.status = 'active'`,
    [matchId, borrowerAgentId]
  );
  if (!rows.length) throw new Error(`Active match not found for matchId=${matchId}`);
  const match = rows[0];
  const totalOwedUsdc = roundUsdc(Number(match.amount_usdc) + Number(match.interest_usdc));

  await ensureUsdcAllowance(match.borrower_wallet, totalOwedUsdc, "Borrower");

  const result = await blockchain.repayLoan(match.loan_id_onchain, match.borrower_wallet, profitGeneratedUsdc || 0);
  const currentRep = await getAgentRepFromDb(match.borrower_wallet);
  
  const withProfit = (profitGeneratedUsdc || 0) > 0;
  const newScore = Math.min(50, currentRep.score + (withProfit ? 2 : 1));
  const updatedRep = { score: newScore };

  await db.query(`UPDATE matches SET status='repaid', repaid_at=NOW(), repay_tx_hash=$1 WHERE match_id = $2`, [result.txHash, matchId]);
  await updateAgentRepInDb(match.borrower_wallet, updatedRep.score);

  const state = JSON.parse(await redis.get(`agent:${borrowerAgentId}:state`) || "{}");
  delete state.activeLoanId;
  delete state.activeLoanUsdc;
  state.reputationScore = updatedRep.score;
  await redis.set(`agent:${borrowerAgentId}:state`, JSON.stringify(state));

  await resetVolumeGate(borrowerAgentId);

  const repDelta = updatedRep.score - match.borrower_rep_at_origination;
  await logEvent({
    agentId: borrowerAgentId,
    type: "loan_repaid",
    amount: totalOwedUsdc,
    counterpartyAgentId: match.lender_agent_id,
    txHash: result.txHash,
    repDelta,
  });

  return { status: "repaid", txHash: result.txHash, newReputationScore: updatedRep.score, repDelta };
}

export async function repayPartial({ matchId, partialAmountUsdc }: any) {
  const { rows } = await db.query(
    `SELECT m.*, a.wallet_address as borrower_wallet FROM matches m JOIN agents a ON m.borrower_agent_id = a.agent_id WHERE m.match_id = $1 AND m.status = 'active'`,
    [matchId]
  );
  if (!rows.length) throw new Error("Active match not found");
  const match = rows[0];

  const result = await blockchain.repayPartial(match.loan_id_onchain, match.borrower_wallet, partialAmountUsdc);
  
  const currentRep = await getAgentRepFromDb(match.borrower_wallet);
  const totalOwedUsdc = Number(match.amount_usdc) + Number(match.interest_usdc);
  const penalty = (partialAmountUsdc * 100 / totalOwedUsdc) < 80 ? 4 : 2;
  const newScore = Math.max(0, currentRep.score - penalty);
  const updatedRep = { score: newScore };

  await db.query(`UPDATE matches SET status='partial_default', repaid_at=NOW(), repay_tx_hash=$1 WHERE match_id = $2`, [result.txHash, matchId]);
  await updateAgentRepInDb(match.borrower_wallet, updatedRep.score);
  
  await logEvent({ agentId: match.borrower_agent_id, type: "loan_partial_default", amount: partialAmountUsdc, counterpartyAgentId: match.lender_agent_id, txHash: result.txHash, repDelta: updatedRep.score - match.borrower_rep_at_origination });
  
  return { status: "partial_default", txHash: result.txHash, newRep: updatedRep.score };
}

// ─── Liquidation cron ─────────────────────────────────────────────────────────

export async function runLiquidationSweep() {
  const { rows: overdue } = await db.query(
    `SELECT m.*, a.wallet_address as borrower_wallet FROM matches m JOIN agents a ON m.borrower_agent_id = a.agent_id
     WHERE m.status = 'active' AND m.funded_at < NOW() - INTERVAL '8 days'`
  );

  for (const match of overdue) {
    try {
      const result = await blockchain.liquidateLoan(match.loan_id_onchain);
      
      const currentRep = await getAgentRepFromDb(match.borrower_wallet);
      const newScore = Math.max(0, currentRep.score - 10);
      const updatedRep = { score: newScore };

      await db.query(`UPDATE matches SET status='liquidated', repaid_at=NOW(), repay_tx_hash=$1 WHERE match_id = $2`, [result.txHash, match.match_id]);
      await updateAgentRepInDb(match.borrower_wallet, updatedRep.score);
      
      await logEvent({ agentId: match.borrower_agent_id, type: "loan_liquidated", amount: match.amount_usdc, counterpartyAgentId: match.lender_agent_id, txHash: result.txHash, repDelta: updatedRep.score - match.borrower_rep_at_origination });
    } catch (err: any) {
      logger.error(`liquidation failed: ${err.message}`);
    }
  }
}

export async function runRepDecaySweep() {
  const { rows: dormant } = await db.query(`SELECT a.agent_id, a.wallet_address, a.reputation_score FROM agents a WHERE a.status = 'active' AND a.last_activity_at < NOW() - INTERVAL '60 days'`);

  for (const agent of dormant) {
    try {
      const daysDormant = await db.query(`SELECT EXTRACT(EPOCH FROM (NOW() - last_activity_at))/86400 AS days FROM agents WHERE agent_id = $1`, [agent.agent_id]);
      const days = parseFloat(daysDormant.rows[0].days);
      const thirtyDayPeriods = Math.floor((days - 60) / 30);
      if (thirtyDayPeriods <= 0) continue;

      const decayAmount = thirtyDayPeriods * DECAY_RATE;
      const newScoreInt = Math.round(Math.max(0, agent.reputation_score - decayAmount));

      if (newScoreInt < agent.reputation_score) {
        await updateAgentRepInDb(agent.wallet_address, newScoreInt);
        // Off-chain decay applied seamlessly!
      }
    } catch (err: any) {
      logger.error(`decay failed: ${err.message}`);
    }
  }
}

// ─── On-chain event sync ──────────────────────────────────────────────────────

export function startEventSync() {
  blockchain.onReputationUpdated(async ({ agent, newScore, reason, txHash }: any) => {
    await updateAgentRepInDb(agent, newScore);
    await db.query(`INSERT INTO rep_snapshots (wallet_address, score, source, on_chain_tx_hash, timestamp) VALUES ($1, $2, $3, $4, NOW())`, [agent, newScore, reason, txHash]);
  });
  blockchain.onLoanFunded(async ({ loanId, txHash }: any) => { logger.info(`LoanFunded ${loanId}`); });
  blockchain.onLoanRepaid(async ({ loanId, withProfit, txHash }: any) => { logger.info(`LoanRepaid ${loanId}`); });
}
