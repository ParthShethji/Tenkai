/**
 * blockchain.service.ts
 *
 * All on-chain reads and writes go through here.
 * Nothing else in the codebase touches ethers.js directly.
 */

import { ethers, Contract, JsonRpcProvider, Wallet } from "ethers";
import { getAgentPrivateKey, loadAgentPrivateKey } from "./config/agentKeys";

function loadAbi() {
  if (process.env.NODE_ENV === "test") {
    return [];
  }

  const path = require("path");
  const candidates = [
    path.resolve(__dirname, "./contracts/AgentFiLending.abi.json"),
    path.resolve(__dirname, "./artifacts/contracts/AgentFiLending.sol/AgentFiLending.json"),
  ];

  for (const candidate of candidates) {
    try {
      const abiJson = require(candidate);
      const abi = Array.isArray(abiJson) ? abiJson : abiJson.abi || [];
      console.log(`[blockchain] ABI loaded from: ${candidate} (${abi.length} entries)`);
      return abi;
    } catch {
      console.warn(`[blockchain] ABI not found at: ${candidate}`);
      continue;
    }
  }

  console.error("[blockchain] CRITICAL: No ABI file found — all contract calls will fail with 'no matching fragment'.");
  return [];
}

const ABI = loadAbi();
const logger = process.env.NODE_ENV === "test" ? console : require("./utils/logger");

// ─── Provider + Signer setup ──────────────────────────────────────────────────

// Arc Network — lending contract, USDC, gas funding
const provider = new JsonRpcProvider(process.env.ARC_TESTNET_RPC_URL || process.env.RPC_URL || "");

// Ethereum Sepolia (L1) — ENS only. ENS names live on L1, not on Arc.
// Falls back to provider if L1_SEPOLIA_RPC_URL is not set (local dev).
const l1Provider = process.env.L1_SEPOLIA_RPC_URL
  ? new JsonRpcProvider(process.env.L1_SEPOLIA_RPC_URL)
  : provider;

const platformWallet = new Wallet(process.env.PLATFORM_PRIVATE_KEY || "0x0123456789012345678901234567890123456789012345678901234567890123", provider);

// Deployer wallet (account #0) — owns MockERC20 and can mint
const deployerWallet = new Wallet(process.env.DEPLOYER_PRIVATE_KEY || process.env.PLATFORM_PRIVATE_KEY || "0x0123456789012345678901234567890123456789012345678901234567890123", provider);

const contract = new Contract(
  process.env.CONTRACT_ADDRESS || ethers.ZeroAddress,
  ABI,
  platformWallet
);

// USDC contract (MockERC20 with mint for demo)
const USDC_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
];
// Connect to deployerWallet so mint() (onlyOwner) works
const usdc = new Contract(process.env.USDC_ADDRESS || ethers.ZeroAddress, USDC_ABI, deployerWallet);

const USDC_DECIMALS = 6n;

// ─── Sequential Queues for Nonce Safety ──────────────────────────────────────

type WalletType = "platform" | "deployer";

// Map to hold the last transaction promise for each critical shared account.
// This prevents multiple transactions from fetching the same nonce in parallel.
const queues: Record<WalletType, Promise<any>> = {
  platform: Promise.resolve(),
  deployer: Promise.resolve(),
};

/**
 * Enqueues a transaction action to be executed sequentially for a given wallet type.
 */
async function enqueue<T>(type: WalletType, action: () => Promise<T>): Promise<T> {
  const previous = queues[type];
  const next = (async () => {
    try {
      await previous;
    } catch (err) {
      // Don't let previous failures block the queue indefinitely, 
      // but log them if they were non-deterministic.
    }
    return action();
  })();
  queues[type] = next;
  return next;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function toUsdc(amount: number | string): bigint {
  return ethers.parseUnits(String(amount), Number(USDC_DECIMALS));
}

export function fromUsdc(bigintVal: bigint): number {
  return Number(ethers.formatUnits(bigintVal, Number(USDC_DECIMALS)));
}

async function waitForTx(txPromise: Promise<any>, label: string) {
  const tx = await txPromise;
  logger.info(`[blockchain] ${label} tx sent: ${tx.hash}`);
  const receipt = await tx.wait(1); 
  if (receipt.status !== 1) throw new Error(`[blockchain] ${label} tx reverted: ${tx.hash}`);
  logger.info(`[blockchain] ${label} confirmed in block ${receipt.blockNumber}`);
  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    receipt,
  };
}

function isNonceError(error: any) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("nonce too low") ||
    msg.includes("replacement transaction underpriced") ||
    msg.includes("already known")
  );
}

async function assertBytecodePresent(address: string, label: string) {
  if (process.env.NODE_ENV === "test") return;
  const code = await provider.getCode(address);
  if (!code || code === "0x") {
    const rpc = process.env.RPC_URL || "(missing RPC_URL)";
    throw new Error(
      `[chain-config] ${label} has no bytecode at ${address} on ${rpc}. ` +
      `If you restarted local Hardhat node, run 'npm run deploy:localhost' and restart backend.`
    );
  }
}

async function waitForTxWithRetry(
  createTx: () => Promise<any>,
  label: string,
  retries: number = 2
) {
  let attempt = 0;
  while (true) {
    try {
      return await waitForTx(createTx(), label);
    } catch (error) {
      if (attempt < retries && isNonceError(error)) {
        attempt += 1;
        logger.warn(`[blockchain] ${label} nonce conflict, retry attempt=${attempt}`);
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      throw error;
    }
  }
}

// ─── Registration ──────────────────────────────────────────────────────────────

export async function registerAgent(agentWallet: string, initialScore: number, ensName: string) {
  const ensNameHash = ethers.keccak256(ethers.toUtf8Bytes(ensName));
  logger.info(`[blockchain] registering agent ${agentWallet} score=${initialScore} ensName=${ensName}`);
  return enqueue("platform", () =>
    waitForTxWithRetry(
      () => contract.registerAgent(agentWallet, initialScore, ensNameHash),
      `registerAgent(${agentWallet})`
    )
  );
}

export async function ensureAgentRegistered(agentWallet: string, ensName: string, initialScore: number = 25) {
  const rep = await getAgentRep(agentWallet);
  if (rep.lastActivityAt > 0) {
    return { alreadyRegistered: true, score: rep.score };
  }

  const safeScore = Math.max(0, Math.floor(initialScore || 25));
  await registerAgent(agentWallet, safeScore, ensName);
  return { alreadyRegistered: false, score: safeScore };
}

// ─── Reputation reads ─────────────────────────────────────────────────────────

export async function issueCreditScoreVC(borrowerWallet: string, score: number) {
  const messageHash = ethers.solidityPackedKeccak256(
    ["address", "uint8"],
    [borrowerWallet, score]
  );
  const signature = await platformWallet.signMessage(ethers.getBytes(messageHash));
  return { score, signature };
}

export async function getRequiredCollateral(vcScore: number, principalUsdc: number) {
  await assertBytecodePresent(process.env.CONTRACT_ADDRESS || ethers.ZeroAddress, "AgentFiLending");
  const collateral = await contract.requiredCollateral(
    vcScore,
    toUsdc(principalUsdc)
  );
  return fromUsdc(collateral);
}

export async function getMaxLoanSize(vcScore: number) {
  await assertBytecodePresent(process.env.CONTRACT_ADDRESS || ethers.ZeroAddress, "AgentFiLending");
  const max = await contract.maxLoanSize(vcScore);
  return fromUsdc(max);
}

export async function checkAllowance(ownerWallet: string) {
  await assertBytecodePresent(process.env.USDC_ADDRESS || ethers.ZeroAddress, "MockUSDC");
  const spender = process.env.CONTRACT_ADDRESS || ethers.ZeroAddress;
  const allowance = await usdc.allowance(ownerWallet, spender);
  return fromUsdc(allowance);
}

export async function checkBalance(walletAddress: string) {
  await assertBytecodePresent(process.env.USDC_ADDRESS || ethers.ZeroAddress, "MockUSDC");
  const balance = await usdc.balanceOf(walletAddress);
  return fromUsdc(balance);
}

export async function getNativeGasBalance(walletAddress: string) {
  const balance = await provider.getBalance(walletAddress);
  return Number(ethers.formatEther(balance));
}

export async function getWalletFundingSnapshot(walletAddress: string) {
  const [ethBalance, usdcBalance] = await Promise.all([
    getNativeGasBalance(walletAddress),
    checkBalance(walletAddress),
  ]);

  return {
    ethBalance,
    usdcBalance,
    usdcAddress: process.env.USDC_ADDRESS || null,
    contractAddress: process.env.CONTRACT_ADDRESS || null,
  };
}

/**
 * Mint MockERC20 USDC to a wallet address.
 * Only works when platformWallet is the MockERC20 owner (deployer account).
 * For demo/hackathon use only.
 */
export async function mintUsdc(toAddress: string, amountUsdc: number) {
  return enqueue("deployer", async () => {
    const amount = toUsdc(amountUsdc);
    const result = await waitForTxWithRetry(
      () => usdc.mint(toAddress, amount),
      `mintUsdc(${toAddress}, ${amountUsdc})`
    );
    logger.info(`[blockchain] minted ${amountUsdc} USDC to ${toAddress}`);
    return result;
  });
}

/**
 * Approve the lending contract to spend USDC from a given wallet.
 * Requires the wallet's private key.
 */
export async function approveUsdc(walletPrivateKey: string, amountUsdc: number) {
  const wallet = new Wallet(walletPrivateKey, provider);
  const usdcAsWallet = new Contract(process.env.USDC_ADDRESS || ethers.ZeroAddress, USDC_ABI, wallet);
  // Approve MaxUint256 to avoid precision mismatch when requestLoan re-reads collateral requirement.
  // This is the standard ERC20 "unlimited approval" pattern used by most DeFi protocols.
  const amount = ethers.MaxUint256;
  const tx = await usdcAsWallet.approve(process.env.CONTRACT_ADDRESS || ethers.ZeroAddress, amount);
  await tx.wait(1);
  logger.info(`[blockchain] approved ${amountUsdc} USDC (MaxUint256) from ${wallet.address}`);
}

/**
 * Send Native Gas from the deployer wallet to an agent wallet for gas.
 * For demo/hackathon use only.
 */
export async function fundNativeGas(toAddress: string, amountGas: string = "1.0") {
  return enqueue("deployer", async () => {
    const result = await waitForTxWithRetry(
      () =>
        deployerWallet.sendTransaction({
          to: toAddress,
          value: ethers.parseEther(amountGas),
        }),
      `fundNativeGas(${toAddress}, ${amountGas})`
    );
    logger.info(`[blockchain] funded ${amountGas} Native Gas to ${toAddress}`);
    return result;
  });
}

// ─── Loan lifecycle ───────────────────────────────────────────────────────────

export async function requestLoan({
  borrowerWallet,
  lenderWallet,
  principalUsdc,
  interestUsdc,
  borrowerEns,
  lenderEns,
  vcScore,
}: {
  borrowerWallet: string;
  lenderWallet: string;
  principalUsdc: number;
  interestUsdc: number;
  borrowerEns: string;
  lenderEns: string;
  vcScore: number;
}) {
  const principalBig = toUsdc(principalUsdc);
  const interestBig  = toUsdc(interestUsdc);
  const borrowerEnsHash = ethers.keccak256(ethers.toUtf8Bytes(borrowerEns));
  const lenderEnsHash   = ethers.keccak256(ethers.toUtf8Bytes(lenderEns));
  const requestLoanFn: any = contract.requestLoan;

  const { signature: vcSignature } = await issueCreditScoreVC(borrowerWallet, vcScore);

  const collateralNeeded = await getRequiredCollateral(vcScore, principalUsdc);
  if (collateralNeeded > 0) {
    const allowance = await checkAllowance(borrowerWallet);
    if (allowance < collateralNeeded) {
      throw new Error(
        `Borrower collateral allowance insufficient. Required: ${collateralNeeded} USDC, Approved: ${allowance} USDC`
      );
    }
    const balance = await checkBalance(borrowerWallet);
    if (balance < collateralNeeded) {
      throw new Error(
        `Borrower USDC balance too low for collateral. Required: ${collateralNeeded} USDC, Balance: ${balance} USDC`
      );
    }
  }

  const lenderAllowance = await checkAllowance(lenderWallet);
  if (lenderAllowance < principalUsdc) {
    throw new Error(
      `Lender allowance insufficient. Required: ${principalUsdc} USDC, Approved: ${lenderAllowance} USDC`
    );
  }

  logger.info(`[blockchain] requestLoan borrower=${borrowerWallet} lender=${lenderWallet}`);

  // ── Fallback 1: Read nextLoanId BEFORE the tx so we know the expected id ──
  let preNextLoanId: number | null = null;
  try {
    preNextLoanId = Number(await contract.nextLoanId());
    logger.info(`[blockchain] requestLoan pre-tx nextLoanId=${preNextLoanId}`);
  } catch (err: any) {
    logger.warn(`[blockchain] requestLoan could not read nextLoanId pre-tx: ${err.message}`);
  }

  // ── Fallback 2: staticCall to simulate and get return value ──
  let expectedLoanId: number | null = null;
  if (typeof requestLoanFn?.staticCall === "function") {
    try {
      expectedLoanId = Number(
        await requestLoanFn.staticCall(
          borrowerWallet,
          lenderWallet,
          principalBig,
          interestBig,
          borrowerEnsHash,
          lenderEnsHash,
          vcScore,
          vcSignature
        )
      );
      logger.info(`[blockchain] requestLoan staticCall expectedLoanId=${expectedLoanId}`);
    } catch (err: any) {
      logger.warn(`[blockchain] requestLoan staticCall failed (non-fatal): ${err.message}`);
    }
  }

  const result = await enqueue("platform", () =>
    waitForTxWithRetry(
      () =>
        requestLoanFn(
          borrowerWallet,
          lenderWallet,
          principalBig,
          interestBig,
          borrowerEnsHash,
          lenderEnsHash,
          vcScore,
          vcSignature
        ),
      "requestLoan"
    )
  );

  const receipt = result.receipt || await provider.getTransactionReceipt(result.txHash);
  if (!receipt) throw new Error("Tx Receipt not found");

  const candidateLoanIds = new Set<number>();

  // ── Source 1: staticCall result ──
  if (expectedLoanId && expectedLoanId > 0) {
    candidateLoanIds.add(expectedLoanId);
    logger.info(`[blockchain] requestLoan candidate from staticCall: ${expectedLoanId}`);
  }

  // ── Source 2: pre-tx nextLoanId (the created loan should be this value) ──
  if (preNextLoanId && preNextLoanId > 0) {
    candidateLoanIds.add(preNextLoanId);
    logger.info(`[blockchain] requestLoan candidate from preNextLoanId: ${preNextLoanId}`);
  }

  // ── Source 3: Parse LoanRequested event from receipt logs ──
  const contractAddress = String(contract.target || "").toLowerCase();
  logger.info(`[blockchain] requestLoan parsing ${receipt.logs.length} logs, contractAddress=${contractAddress}`);

  for (const log of receipt.logs) {
    const logAddress = String(log.address || "").toLowerCase();
    if (contractAddress && logAddress !== contractAddress) {
      continue;
    }

    try {
      const parsed = contract.interface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "LoanRequested") {
        const parsedLoanId = Number(parsed.args?.[0] ?? parsed.args?.loanId ?? 0);
        logger.info(`[blockchain] requestLoan candidate from LoanRequested event: ${parsedLoanId}`);
        if (parsedLoanId > 0) {
          candidateLoanIds.add(parsedLoanId);
        }
      }
    } catch (parseErr: any) {
      logger.warn(`[blockchain] requestLoan log parse failed for topic ${log.topics?.[0]}: ${parseErr.message}`);
      continue;
    }
  }

  // ── Source 4: Post-tx nextLoanId fallback ──
  if (candidateLoanIds.size === 0) {
    try {
      const postNextLoanId = Number(await contract.nextLoanId());
      if (postNextLoanId > 1) {
        candidateLoanIds.add(postNextLoanId - 1);
        logger.info(`[blockchain] requestLoan candidate from post-tx nextLoanId: ${postNextLoanId - 1}`);
      }
    } catch (err: any) {
      logger.warn(`[blockchain] requestLoan could not read nextLoanId post-tx: ${err.message}`);
    }
  }

  logger.info(`[blockchain] requestLoan total candidates: [${[...candidateLoanIds].join(", ")}]`);

  let loanId = 0;
  const MAX_VERIFY_ATTEMPTS = 3;
  for (const candidate of candidateLoanIds) {
    for (let attempt = 0; attempt < MAX_VERIFY_ATTEMPTS; attempt++) {
      try {
        if (attempt > 0) {
          logger.info(`[blockchain] requestLoan getLoan retry attempt=${attempt} for candidate=${candidate}`);
          await new Promise((r) => setTimeout(r, 1000)); // wait for RPC consistency
        }
        const loan = await contract.getLoan(candidate);
        const onChainLoanId = Number(loan.loanId);
        const onChainStatus = Number(loan.status);
        logger.info(`[blockchain] requestLoan verifying candidate=${candidate} onChainLoanId=${onChainLoanId} status=${onChainStatus} attempt=${attempt}`);
        if (onChainLoanId === candidate && onChainStatus !== 0) {
          loanId = candidate;
          break;
        }
      } catch (err: any) {
        logger.warn(`[blockchain] requestLoan getLoan(${candidate}) failed: ${err.message}`);
      }
    }
    if (loanId > 0) break;
  }

  // Fallback: if getLoan reads still return stale data but multiple independent
  // sources (staticCall, preNextLoanId, LoanRequested event) all agree, trust them.
  if (loanId <= 0 && candidateLoanIds.size === 1) {
    const agreed = [...candidateLoanIds][0];
    const sources: string[] = [];
    if (expectedLoanId === agreed) sources.push("staticCall");
    if (preNextLoanId === agreed) sources.push("preNextLoanId");
    // LoanRequested event is always a source if it was added to candidates
    sources.push("event/fallback");
    if (sources.length >= 2) {
      logger.warn(`[blockchain] requestLoan trusting corroborated loanId=${agreed} from [${sources.join(", ")}] despite stale getLoan read`);
      loanId = agreed;
    }
  }

  if (loanId <= 0) {
    throw new Error(`[blockchain] requestLoan could not resolve created loanId from tx ${result.txHash}`);
  }

  logger.info(`[blockchain] requestLoan resolved loanId=${loanId}`);
  return { ...result, loanId, collateralLocked: collateralNeeded };
}

export async function fundLoan(loanId: number) {
  logger.info(`[blockchain] fundLoan loanId=${loanId}`);
  return enqueue("platform", () => 
    waitForTxWithRetry(() => contract.fundLoan(loanId), `fundLoan(${loanId})`)
  );
}

export async function repayLoan(loanId: number, borrowerWallet: string, profitGeneratedUsdc: number) {
  const loan = await getLoan(loanId);
  const totalOwed = loan.principalUsdc + loan.interestUsdc;

  const allowance = await checkAllowance(borrowerWallet);
  if (allowance < totalOwed) {
    throw new Error(`Borrower repayment allowance insufficient.`);
  }

  const profitBig = toUsdc(profitGeneratedUsdc || 0);
  const privateKey =
    process.env[`AGENT_KEY_${borrowerWallet.toLowerCase()}`] ||
    process.env.AGENT_PRIVATE_KEY ||
    getAgentPrivateKey(borrowerWallet) ||
    await loadAgentPrivateKey(borrowerWallet);

  if (!privateKey) {
    throw new Error(`Borrower private key not found for wallet ${borrowerWallet}`);
  }

  const borrowerContract = contract.connect(
    new Wallet(privateKey, provider)
  ) as Contract;

  return waitForTx(
    borrowerContract.repayLoan?.(loanId, profitBig) as Promise<any>,
    `repayLoan(${loanId})`
  );
}

export async function repayPartial(loanId: number, borrowerWallet: string, partialAmountUsdc: number) {
  logger.info(`[blockchain] repayPartial loanId=${loanId} partial=${partialAmountUsdc}`);
  return enqueue("platform", () =>
    waitForTxWithRetry(
      () => contract.repayPartial(loanId, toUsdc(partialAmountUsdc)),
      `repayPartial(${loanId})`
    )
  );
}

export async function liquidateLoan(loanId: number) {
  return enqueue("platform", () =>
    waitForTxWithRetry(() => contract.liquidateLoan(loanId), `liquidateLoan(${loanId})`)
  );
}

  // Removed setReputation logic as it is now off-chain

export async function getLoan(loanId: number) {
  const loan = await contract.getLoan(loanId);
  return {
    loanId: Number(loan.loanId),
    borrower: loan.borrower,
    lender: loan.lender,
    principalUsdc: fromUsdc(loan.principal),
    collateralUsdc: fromUsdc(loan.collateral),
    interestUsdc: fromUsdc(loan.interestAmount),
    dueAt: new Date(Number(loan.dueAt) * 1000),
    repaidAt: loan.repaidAt > 0 ? new Date(Number(loan.repaidAt) * 1000) : null,
    status: ["None","Requested","Active","Repaid","Defaulted","Liquidated"][loan.status as number],
  };
}

export async function getBorrowerLoanIds(agentWallet: string) {
  const ids: bigint[] = await contract.getBorrowerLoans(agentWallet);
  return ids.map(Number);
}

export async function getLenderLoanIds(agentWallet: string) {
  const ids: bigint[] = await contract.getLenderLoans(agentWallet);
  return ids.map(Number);
}

export function onReputationUpdated(callback: (data: any) => void) {
  contract.on("ReputationUpdated", (agent: string, oldScore: bigint, newScore: bigint, reason: string, event: any) => {
    callback({
      agent,
      oldScore: Number(oldScore),
      newScore: Number(newScore),
      reason,
      txHash: event.log.transactionHash,
      blockNumber: event.log.blockNumber,
    });
  });
}

export function onLoanFunded(callback: (data: any) => void) {
  contract.on("LoanFunded", (loanId: bigint, fundedAt: bigint, event: any) => {
    callback({
      loanId: Number(loanId),
      fundedAt: new Date(Number(fundedAt) * 1000),
      txHash: event.log.transactionHash,
    });
  });
}

export function onLoanRepaid(callback: (data: any) => void) {
  contract.on("LoanRepaid", (loanId: bigint, repaidAt: bigint, withProfit: bigint, event: any) => {
    callback({
      loanId: Number(loanId),
      repaidAt: new Date(Number(repaidAt) * 1000),
      withProfit: Number(withProfit),
      txHash: event.log.transactionHash,
    });
  });
}

// ─── ENS Identity Verification ──────────────────────────────────────────────

// Minimal ENS Public Resolver ABI — only the methods we use
const ENS_RESOLVER_ABI = [
  "function addr(bytes32 node) view returns (address)",
  "function text(bytes32 node, string key) view returns (string)",
  "function setText(bytes32 node, string key, string value)",
];

/**
 * Returns a namehash for an ENS domain using ethers built-in.
 * Example: namehash("alice.eth")
 */
function ensNamehash(name: string): string {
  return ethers.namehash(name);
}

/**
 * Resolves an ENS name to its address via the ENS Public Resolver.
 * Returns null if ENS_RESOLVER_ADDRESS is not configured (local dev mode).
 */
export async function resolveEnsToAddress(ensName: string): Promise<string | null> {
  const resolverAddress = process.env.ENS_RESOLVER_ADDRESS;
  if (!resolverAddress) {
    logger.warn(`[ens] ENS_RESOLVER_ADDRESS not set – skipping forward resolution for ${ensName}`);
    return null;
  }
  // Use l1Provider: ENS names from sepolia.primary.ens.domains live on Ethereum Sepolia, not Base Sepolia
  const resolver = new ethers.Contract(resolverAddress, ENS_RESOLVER_ABI, l1Provider);
  const node = ensNamehash(ensName);
  const addr = await resolver.addr(node);
  return addr as string;
}

/**
 * Performs a reverse lookup from a wallet address to its ENS name.
 * Uses the Base Sepolia reverse resolver (addr.reverse).
 * Returns null if ENS is not configured.
 */
export async function resolveAddressToEns(wallet: string): Promise<string | null> {
  const resolverAddress = process.env.ENS_RESOLVER_ADDRESS;
  if (!resolverAddress) {
    logger.warn(`[ens] ENS_RESOLVER_ADDRESS not set – skipping reverse resolution for ${wallet}`);
    return null;
  }
  try {
    // Use l1Provider: reverse ENS registry (addr.reverse) lives on Ethereum Sepolia
    const ensName = await l1Provider.lookupAddress(wallet);
    return ensName;
  } catch {
    return null;
  }
}

/**
 * Fetches an ENS Text Record for a given ENS name and key.
 * Returns null if ENS is not configured.
 */
export async function getEnsTextRecord(ensName: string, key: string): Promise<string | null> {
  const resolverAddress = process.env.ENS_RESOLVER_ADDRESS;
  if (!resolverAddress) {
    logger.warn(`[ens] ENS_RESOLVER_ADDRESS not set – skipping text record fetch for ${ensName}`);
    return null;
  }
  // Use l1Provider: text records are stored on the Ethereum Sepolia resolver
  const resolver = new ethers.Contract(resolverAddress, ENS_RESOLVER_ABI, l1Provider);
  const node = ensNamehash(ensName);
  const value = await resolver.text(node, key);
  return value as string;
}

/**
 * Verify agent ENS integrity.
 * Checks:
 *  1. On-chain contract binding: contract.verifyEns(ensNameHash, agentWallet) == true
 *  2. Forward ENS resolution: ENS name resolves to expected wallet (when resolver configured)
 *
 * Anti-sybil is enforced via ZK human verification at the application layer,
 * not via platform-owned ENS subdomains.
 */
export async function verifyAgentEnsIntegrity(
  agentWallet: string,
  ensName: string,
): Promise<void> {
  const ensNameHash = ethers.keccak256(ethers.toUtf8Bytes(ensName));
  const resolverConfigured = !!process.env.ENS_RESOLVER_ADDRESS;

  // ── Check 1: On-chain contract binding (always runs) ──
  try {
    const isValid: boolean = await contract.verifyEns(ensNameHash, agentWallet);
    if (!isValid) {
      throw new Error(
        `ENS_MISMATCH: On-chain contract binding failed. ` +
        `ENS "${ensName}" is not bound to wallet ${agentWallet} in lending contract.`
      );
    }
  } catch (err: any) {
    if (err.message.startsWith("ENS_MISMATCH")) throw err;
    logger.warn(`[ens] contract.verifyEns call failed (non-fatal in local dev): ${err.message}`);
  }

  if (!resolverConfigured) {
    return;
  }

  // ── Check 2: Forward ENS resolution ──
  const resolvedAddress = await resolveEnsToAddress(ensName);
  if (resolvedAddress && resolvedAddress.toLowerCase() !== agentWallet.toLowerCase()) {
    throw new Error(
      `ENS_MISMATCH: Forward resolution of "${ensName}" returned ${resolvedAddress}, ` +
      `expected ${agentWallet}.`
    );
  }

  logger.info(`[ens] integrity verified for ${ensName} → ${agentWallet}`);
}
