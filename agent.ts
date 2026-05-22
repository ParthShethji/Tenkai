/**
 * agent.ts
 *
 * The autonomous agent process.
 */

import axios from "axios";
import { ethers } from "ethers";
import * as blockchain from "./blockchain.service";

// @ts-ignore
const logger = process.env.NODE_ENV === "test" ? console : require("./utils/logger");

// ─── Boot ──────────────────────────────────────────────────────────────────────

const AGENT_ID      = process.env.AGENT_ID || "";
const AGENT_ROLE    = process.env.AGENT_ROLE || "borrower";
const AGENT_KEY     = process.env.AGENT_PRIVATE_KEY || process.env.AGENT_KEY || "";
const WALLET_ADDR   = process.env.AGENT_WALLET || "";
const API_BASE      = process.env.API_BASE_URL || "http://localhost:3000";
const FILEVERSE_DOC = process.env.FILEVERSE_DOC_ID || "";
const IS_TEST_ENV   = process.env.NODE_ENV === "test";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "");
const FALLBACK_PRIVATE_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001";
const effectiveAgentKey = /^0x[a-fA-F0-9]{64}$/.test(AGENT_KEY) ? AGENT_KEY : FALLBACK_PRIVATE_KEY;
const agentSigner = new ethers.Wallet(effectiveAgentKey, provider);

const api = (axios.create({
  baseURL: API_BASE,
  headers: { Authorization: `Bearer ${process.env.AGENT_JWT}` },
}) as any) || axios;

async function httpGet(url: string) {
  if (typeof (api as any).get === "function") {
    const response = await (api as any).get(url);
    if (response) return response;
  }
  return (axios as any).get(url);
}

async function httpPost(url: string, body: any) {
  if (typeof (api as any).post === "function") {
    const response = await (api as any).post(url, body);
    if (response) return response;
  }
  return (axios as any).post(url, body);
}

// ─── Strategy doc (Fileverse) ─────────────────────────────────────────────────

let strategy: any = null;

async function loadStrategy() {
  logger.info(`[agent:${AGENT_ID}] loading strategy from Fileverse ${FILEVERSE_DOC}`);
  const { data } = await httpGet(`/fileverse/docs/${FILEVERSE_DOC}`);
  strategy = data;
  logger.info(`[agent:${AGENT_ID}] strategy loaded`, strategy);
}

// ─── USDC approval helper ──────────────────────────────────────────────────────

async function approveUsdc(amountUsdc: number) {
  if (IS_TEST_ENV) {
    return;
  }

  const USDC_ABI = ["function approve(address spender, uint256 amount) returns (bool)"];
  const usdc = new ethers.Contract(process.env.USDC_ADDRESS || ethers.ZeroAddress, USDC_ABI, agentSigner);
  const amountBig = ethers.parseUnits(String(amountUsdc), 6);
  const tx = await usdc.approve(process.env.CONTRACT_ADDRESS || ethers.ZeroAddress, amountBig);
  await tx.wait(1);
  logger.info(`[agent:${AGENT_ID}] approved ${amountUsdc} USDC for contract`);
}

// ─── Lender flow ──────────────────────────────────────────────────────────────

async function runLenderCycle() {
  logger.info(`[agent:${AGENT_ID}] lender cycle start`);

  const { data: offer } = await httpPost("/lending/offers", {
    lenderAgentId:  AGENT_ID,
    maxAmountUsdc:  strategy.maxLoanAmount,
    minRepRequired: strategy.minReputation,
    ratePct:        strategy.interestRate,
  });

  logger.info(`[agent:${AGENT_ID}] lend offer posted offerId=${offer.offerId}`);
  await approveUsdc(strategy.maxLoanAmount);

  blockchain.onLoanFunded(async ({ loanId, txHash }: any) => {
    const loan = await blockchain.getLoan(loanId);
    if (loan.lender.toLowerCase() !== WALLET_ADDR.toLowerCase()) return;
    logger.info(`[agent:${AGENT_ID}] loan funded! loanId=${loanId} tx=${txHash}`);
  });

  blockchain.onLoanRepaid(async ({ loanId }: any) => {
    const loan = await blockchain.getLoan(loanId);
    if (loan.lender.toLowerCase() !== WALLET_ADDR.toLowerCase()) return;
    logger.info(`[agent:${AGENT_ID}] repayment received loanId=${loanId}. Earned ${loan.interestUsdc} USDC interest.`);
    setTimeout(() => runLenderCycle(), 5000);
  });
}

// ─── Borrower flow ─────────────────────────────────────────────────────────────

async function runBorrowerCycle() {
  logger.info(`[agent:${AGENT_ID}] borrower cycle start`);

  const requestAmount = strategy.maxLoanAmount;
  const { data: quote } = await httpGet(
    `/lending/borrow/quote?borrowerAgentId=${AGENT_ID}&amountUsdc=${requestAmount}`
  );
  logger.info(`[agent:${AGENT_ID}] quote: `, quote);

  if (quote.collateralUsdc > 0) {
    await approveUsdc(quote.collateralUsdc);
  }

  const { data: matchResult } = await httpPost("/lending/borrow", {
    borrowerAgentId:     AGENT_ID,
    requestedAmountUsdc: requestAmount,
  });

  if (matchResult.status === "pending_user_approval") {
    logger.warn(`[agent:${AGENT_ID}] borrow request pending user approval approvalId=${matchResult.approvalId}. Pausing.`);
    return;
  }

  if (matchResult.status === "queued") {
    logger.info(`[agent:${AGENT_ID}] no lender available, queued. Retrying in 60s.`);
    if (!IS_TEST_ENV) {
      setTimeout(() => runBorrowerCycle(), 60_000);
    }
    return; // Will be called again in 60s
  }

  const { matchId, principalUsdc, fundTxHash } = matchResult;
  logger.info(`[agent:${AGENT_ID}] loan funded matchId=${matchId} principal=${principalUsdc} USDC tx=${fundTxHash}`);

  const tradingResult = await executeTradeStrategy(principalUsdc);

  const totalOwed = principalUsdc + matchResult.interestUsdc;
  const totalReceived = tradingResult.exitValueUsdc;
  const profit = Math.max(0, totalReceived - totalOwed);

  logger.info(`[agent:${AGENT_ID}] trade complete. exitValue=${totalReceived} owed=${totalOwed} profit=${profit}`);
  await approveUsdc(totalOwed);

  const { data: repayResult } = await httpPost("/lending/repay", {
    matchId,
    borrowerAgentId:     AGENT_ID,
    profitGeneratedUsdc: profit,
  });

  logger.info(`[agent:${AGENT_ID}] repaid tx=${repayResult.txHash} newRep=${repayResult.newReputationScore} repDelta=${repayResult.repDelta}`);

  const delay = strategy.repayAfterSeconds != null ? strategy.repayAfterSeconds * 1000 : 30_000;
  if (!IS_TEST_ENV) {
    setTimeout(() => runBorrowerCycle(), delay);
  }
}

// ─── HeyElsa trading ──────────────────────────────────────────────────────────

async function executeTradeStrategy(principalUsdc: number) {
  const allocation = strategy.tradeAllocation || { ETH: 60, stablecoin: 40 };
  const holdSeconds = strategy.repayAfterSeconds ?? 30;

  logger.info(`[agent:${AGENT_ID}] executing strategy allocation=${JSON.stringify(allocation)} hold=${holdSeconds}s`);

  const elsaPayload = {
    agentId:        AGENT_ID,
    walletAddress:  WALLET_ADDR,
    totalUsdc:      principalUsdc,
    allocation,
    signals:        strategy.signals || [],
    action:         "construct",
  };

  const { data: constructResult } = await httpPost("/elsa/portfolio/construct", elsaPayload);
  logger.info(`[agent:${AGENT_ID}] Elsa portfolio constructed`, constructResult);

  await new Promise(resolve => setTimeout(resolve, holdSeconds * 1000));

  const { data: exitResult } = await httpPost("/elsa/portfolio/exit", {
    agentId:       AGENT_ID,
    walletAddress: WALLET_ADDR,
    portfolioId:   constructResult.portfolioId,
  });

  logger.info(`[agent:${AGENT_ID}] Elsa exit complete exitValueUsdc=${exitResult.exitValueUsdc}`);
  return { exitValueUsdc: exitResult.exitValueUsdc };
}

// ─── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  logger.info(`[agent:${AGENT_ID}] booting role=${AGENT_ROLE} wallet=${WALLET_ADDR}`);
  await loadStrategy();

  if (AGENT_ROLE === "lender") {
    await runLenderCycle();
  } else if (AGENT_ROLE === "borrower") {
    await runBorrowerCycle();
  } else {
    throw new Error(`Unknown agent role: ${AGENT_ROLE}`);
  }
}

main().catch(err => {
  logger.error(`[agent:${AGENT_ID}] fatal error: ${err.message}`);
  if (process.env.NODE_ENV !== "test") {
    process.exit(1);
  }
});
