import { Router } from "express";
import { randomUUID, createHash } from "crypto";
import { ethers } from "ethers";
import * as blockchain from "./blockchain.service";
import { persistAgentPrivateKey, setAgentPrivateKey } from "./config/agentKeys";
import { putStrategyDoc } from "./utils/strategyStore";
import { agentRuntimeManager, getRegisteredTools } from "./runtime.manager";
import { query as db } from "./config/db";

const router = Router();

function normalizeRiskTolerance(value: unknown) {
  const normalized = String(value || "balanced").toLowerCase();
  return ["conservative", "balanced", "aggressive"].includes(normalized) ? normalized : "balanced";
}

function buildAgentPrompt(role: "lender" | "borrower", strategy: Record<string, unknown>) {
  const template = role === "lender"
    ? "Autonomous lender agent. Post disciplined offers, protect capital, and seek yield."
    : "Autonomous borrower agent. Compare offers, borrow efficiently, trade prudently, and repay on time.";

  return [
    template,
    "Use the enabled tools when you need marketplace, reputation, and repayment actions.",
    `User strategy: ${JSON.stringify(strategy)}`,
  ].join("\n\n");
}

function defaultStrategy(role: "lender" | "borrower") {
  if (role === "lender") {
    return {
      maxLoanAmount: 500,
      minReputation: 25,
      interestRate: 2,
      tradeAllocation: { USDC: 100 },
      repayAfterSeconds: 30,
      signals: [],
    };
  }

  return {
    maxLoanAmount: 250,
    minReputation: 25,
    interestRate: 2,
    tradeAllocation: { ETH: 60, stablecoin: 40 },
    repayAfterSeconds: 30,
    signals: [],
  };
}

async function findExistingUserByWallet(walletAddress?: string) {
  if (!walletAddress) return null;
  const { rows } = await db(
    `SELECT user_id, email, wallet_address, ens_name, zk_proof_status
     FROM users
     WHERE lower(wallet_address) = lower($1)
     LIMIT 1`,
    [walletAddress]
  );
  return rows[0] || null;
}

async function listUserAgents(userId: string) {
  const { rows } = await db(
      `SELECT a.agent_id, a.ens_name, a.wallet_address, a.role, a.status, a.reputation_score,
              a.fileverse_doc_id, c.execution_interval_seconds, c.enabled_tools, c.risk_tolerance,
              c.profit_target_pct, c.runtime_status, c.last_execution_at, c.next_execution_at,
              c.last_result_summary, c.total_cycles, c.total_profit_usdc, c.total_borrowed_usdc, c.total_lent_usdc,
              a.private_key IS NOT NULL AS has_private_key,
              c.strategy_json
     FROM agents a
     LEFT JOIN agent_configs c ON c.agent_id = a.agent_id
     WHERE a.user_id = $1
     ORDER BY a.created_at DESC`,
    [userId]
  );
  return Promise.all(
    rows.map(async (row: any) => {
      const funding = await blockchain.getWalletFundingSnapshot(row.wallet_address);
      return {
        ...row,
        eth_balance: funding.ethBalance,
        usdc_balance: funding.usdcBalance,
        enabled_tools: row.enabled_tools ? JSON.parse(row.enabled_tools) : [],
        strategy: row.strategy_json ? JSON.parse(row.strategy_json) : {},
      };
    })
  );
}

// Public: resolve ENS name to address (used by onboarding before user exists).
router.get("/ens/resolve", async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }
  try {
    const address = await blockchain.resolveEnsToAddress(name);
    return res.json({ address: address ?? null });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "ENS resolution failed" });
  }
});

// Public: compute ENS node hashes for a subdomain.
// Frontend needs these to build the raw setSubnodeRecord + setAddr calldata
// without needing ethers in the browser.
// GET /platform/ens/nodes?parent=alice.eth&label=vault-1
router.get("/ens/nodes", (req, res) => {
  const parent = typeof req.query.parent === "string" ? req.query.parent.trim() : "";
  const label  = typeof req.query.label  === "string" ? req.query.label.trim()  : "";
  if (!parent || !label) {
    return res.status(400).json({ error: "parent and label are required" });
  }
  try {
    const parentNode    = ethers.namehash(parent);                                // namehash("alice.eth")
    const labelHash     = ethers.keccak256(ethers.toUtf8Bytes(label));            // keccak256("vault-1")
    const subdomainNode = ethers.namehash(`${label}.${parent}`);                  // namehash("vault-1.alice.eth")
    return res.json({ parentNode, labelHash, subdomainNode });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

router.get("/tools", (_req, res) => {
  return res.json({ tools: getRegisteredTools() });
});

router.get("/session", async (req, res) => {
  const walletAddress = typeof req.query.walletAddress === "string" ? req.query.walletAddress.trim() : "";
  if (!walletAddress) {
    return res.status(400).json({ error: "walletAddress is required" });
  }

  try {
    const user = await findExistingUserByWallet(walletAddress);
    if (!user) {
      return res.json({ user: null, agents: [] });
    }

    const agents = await listUserAgents(String(user.user_id));
    return res.json({
      user: {
        userId: user.user_id,
        email: user.email,
        walletAddress: user.wallet_address,
        ensName: user.ens_name || null,
        zkVerified: user.zk_proof_status === "verified",
      },
      agents,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "failed to load session" });
  }
});

router.post("/users", async (req, res) => {
  const { email, walletAddress, zkProofData, signature, message, ensName } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  try {
    if (walletAddress && signature && message) {
      const recovered = ethers.verifyMessage(message, signature);
      if (recovered.toLowerCase() !== String(walletAddress).toLowerCase()) {
        return res.status(401).json({ error: "wallet signature verification failed" });
      }
    }

    const existingUser = await findExistingUserByWallet(walletAddress);
    if (existingUser) {
      await db(
        `UPDATE users
         SET last_login = NOW(),
             ens_name = COALESCE($2, ens_name)
         WHERE user_id = $1`,
        [existingUser.user_id, ensName || null]
      );
      return res.json({
        userId: existingUser.user_id,
        email: existingUser.email,
        walletAddress: existingUser.wallet_address,
        zkVerified: existingUser.zk_proof_status === "verified",
        ensName: existingUser.ens_name || ensName || null,
        existing: true,
      });
    }

    const userId = randomUUID();
    const userWallet = walletAddress || ethers.Wallet.createRandom().address;
    const humanId = createHash("sha256")
      .update(String(zkProofData || walletAddress || email))
      .digest("hex");
    const zkStatus: "none" | "verified" = zkProofData || walletAddress ? "verified" : "none";

    const { rows: sameHuman } = await db(
      `SELECT user_id, wallet_address FROM users WHERE human_id = $1 LIMIT 1`,
      [humanId]
    );
    if (sameHuman.length) {
      const row = sameHuman[0];
      if (String(row.wallet_address).toLowerCase() === String(userWallet).toLowerCase()) {
        return res.json({
          userId: row.user_id,
          email,
          walletAddress: row.wallet_address,
          zkVerified: zkStatus === "verified",
          ensName: ensName || null,
          existing: true,
        });
      }
      return res.status(409).json({ error: "This identity has already been registered. One human, one account." });
    }

    await db(
      `INSERT INTO users (user_id, email, wallet_address, ens_name, zk_proof_status, human_id, created_at, last_login)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [userId, email, userWallet, ensName || null, zkStatus, humanId]
    );

    return res.json({
      userId,
      email,
      walletAddress: userWallet,
      zkVerified: zkStatus === "verified",
      ensName: ensName || null,
      existing: false,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "failed to create user" });
  }
});

router.get("/users/:userId/agents", async (req, res) => {
  try {
    const agents = await listUserAgents(req.params.userId);
    return res.json({ agents });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "failed to load agents" });
  }
});

router.post("/agents", async (req, res) => {
  const {
    userId,
    role,
    ensName,
    initialScore = 25,
    strategy,
    executionIntervalSeconds = 150,
    riskTolerance = "balanced",
    profitTargetPct = 4,
    enabledTools,
  } = req.body || {};

  if (!userId || !role || !ensName) {
    return res.status(400).json({ error: "userId, role, ensName are required" });
  }

  if (!["lender", "borrower"].includes(role)) {
    return res.status(400).json({ error: "role must be lender or borrower" });
  }

  if (!ensName.includes(".")) {
    return res.status(400).json({ error: "ensName must be a valid ENS name (e.g. alice.eth)" });
  }

  try {
    const { rows: userRows } = await db(
      `SELECT user_id, zk_proof_status FROM users WHERE user_id = $1`,
      [userId]
    );
    if (!userRows.length) {
      return res.status(404).json({ error: "user not found" });
    }
    if (userRows[0].zk_proof_status !== "verified") {
      return res.status(403).json({ error: "ZK human verification required before creating an agent" });
    }

    const { rows: ensRows } = await db(
      `SELECT 1 FROM agents WHERE ens_name = $1`,
      [ensName]
    );
    if (ensRows.length) {
      return res.status(409).json({ error: "This ENS name is already registered on the platform" });
    }

    const agentRole = role as "lender" | "borrower";
    const mergedStrategy = {
      ...defaultStrategy(agentRole),
      ...(strategy || {}),
    };

    const intervalInput = Number(executionIntervalSeconds);
    const executionSeconds = intervalInput === 0 ? 0 : Math.max(10, intervalInput || 60);
    const initialRunStatus = executionSeconds === 0 ? "paused" : "active";

    const selectedTools = Array.isArray(enabledTools) && enabledTools.length
      ? enabledTools.map((tool) => String(tool))
      : null;
    const enabledToolNames = Array.isArray(selectedTools)
      ? selectedTools
      : getRegisteredTools()
          .filter((tool) => defaultEnabledForRole(agentRole).includes(String(tool.name)))
          .map((tool) => String(tool.name));

    const agentId = randomUUID();
    const docId = `doc-${agentId}`;
    const agentWallet = ethers.Wallet.createRandom();
    const prompt = buildAgentPrompt(agentRole, mergedStrategy);
    const normalizedRisk = normalizeRiskTolerance(riskTolerance);

    setAgentPrivateKey(agentWallet.address, agentWallet.privateKey);
    putStrategyDoc(docId, mergedStrategy);

    const registerTx = await blockchain.registerAgent(agentWallet.address, Number(initialScore), ensName);

    await db(
      `INSERT INTO agents (
         agent_id, user_id, ens_name, wallet_address, private_key, fileverse_doc_id, role, status, reputation_score, created_at, last_activity_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, NOW(), NOW())`,
      [agentId, userId, ensName, agentWallet.address, agentWallet.privateKey, docId, agentRole, Number(initialScore)]
    );
    await persistAgentPrivateKey(agentId, agentWallet.address, agentWallet.privateKey);

    await db(
      `INSERT INTO agent_configs (
         agent_id, agent_type, strategy_prompt, strategy_json, execution_interval_seconds,
         enabled_tools, risk_tolerance, profit_target_pct, runtime_status, next_execution_at, current_positions_json, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), '{}', NOW(), NOW())`,
      [
        agentId,
        agentRole,
        prompt,
        JSON.stringify(mergedStrategy),
        executionSeconds,
        JSON.stringify(enabledToolNames),
        normalizedRisk,
        Number(profitTargetPct || 4),
        initialRunStatus,
      ]
    );

    await agentRuntimeManager.registerOrRefreshAgent(agentId);

    return res.json({
      agentId,
      ensName,
      walletAddress: agentWallet.address,
      privateKey: agentWallet.privateKey,
      role: agentRole,
      fileverseDocId: docId,
      registerTxHash: registerTx.txHash,
      initialScore: Number(initialScore),
      executionIntervalSeconds: executionSeconds,
      enabledTools: enabledToolNames,
      riskTolerance: normalizedRisk,
      profitTargetPct: Number(profitTargetPct || 4),
      strategyPrompt: prompt,
      runtimeStatus: "active",
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "failed to create agent" });
  }
});

router.put("/agents/:agentId/strategy", async (req, res) => {
  const { agentId } = req.params;
  const strategy = req.body || {};

  try {
    const { rows } = await db(
      `SELECT a.fileverse_doc_id, a.role
       FROM agents a
       WHERE a.agent_id = $1`,
      [agentId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "agent not found" });
    }

    const docId = rows[0].fileverse_doc_id;
    putStrategyDoc(docId, strategy);
    await db(
      `UPDATE agent_configs
       SET strategy_json = $2, strategy_prompt = $3, updated_at = NOW()
       WHERE agent_id = $1`,
      [agentId, JSON.stringify(strategy), buildAgentPrompt(rows[0].role, strategy)]
    );
    await agentRuntimeManager.registerOrRefreshAgent(agentId);
    return res.json({ agentId, fileverseDocId: docId, updated: true });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "failed to update strategy" });
  }
});

router.get("/agents/:agentId/runtime", async (req, res) => {
  try {
    const runtime = await agentRuntimeManager.getAgentRuntime(req.params.agentId);
    if (!runtime) {
      return res.status(404).json({ error: "agent not found" });
    }
    return res.json(runtime);
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "failed to load runtime" });
  }
});

router.post("/agents/:agentId/run", async (req, res) => {
  try {
    const result = await agentRuntimeManager.runAgentNow(req.params.agentId, "manual_api");
    return res.json({ agentId: req.params.agentId, triggered: result.started, message: result.message });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "failed to trigger agent" });
  }
});

router.patch("/agents/:agentId/status", async (req, res) => {
  const runtimeStatus = req.body?.runtimeStatus;
  if (!["active", "paused", "stopped"].includes(runtimeStatus)) {
    return res.status(400).json({ error: "runtimeStatus must be active, paused, or stopped" });
  }

  try {
    await db(`UPDATE agents SET status = $2 WHERE agent_id = $1`, [
      req.params.agentId,
      runtimeStatus === "active" ? "active" : "paused",
    ]);
    await agentRuntimeManager.pauseAgent(req.params.agentId, runtimeStatus);
    return res.json({ agentId: req.params.agentId, runtimeStatus });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "failed to update agent status" });
  }
});

router.post("/agents/:agentId/fund", async (req, res) => {
  const ethAmount = String(req.body?.ethAmount || "0");
  const usdcAmount = Number(req.body?.usdcAmount || 0);

  try {
    const { rows } = await db(
      `SELECT agent_id, ens_name, wallet_address, role
       FROM agents
       WHERE agent_id = $1
       LIMIT 1`,
      [req.params.agentId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "agent not found" });
    }

    const agent = rows[0];
    const actions: Record<string, unknown> = {};

    if (Number(ethAmount) > 0) {
      actions.nativeGas = await blockchain.fundNativeGas(agent.wallet_address, ethAmount);
    }
    if (usdcAmount > 0) {
      actions.usdc = await blockchain.mintUsdc(agent.wallet_address, usdcAmount);
    }

    await db(
      `UPDATE agents SET last_activity_at = NOW() WHERE agent_id = $1`,
      [req.params.agentId]
    );

    return res.json({
      agentId: agent.agent_id,
      ensName: agent.ens_name,
      walletAddress: agent.wallet_address,
      funded: true,
      actions,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "failed to fund agent" });
  }
});

router.get("/admin/overview", async (req, res) => {
  const userId = req.query.userId ? String(req.query.userId) : undefined;
  try {
    const overview = await agentRuntimeManager.getAdminOverview(userId);
    return res.json(overview);
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "failed to load admin overview" });
  }
});

router.get("/admin/transactions", async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const typeFilter = typeof req.query.type === "string" ? req.query.type : "";

  try {
    // Loan-critical event types only
    const loanTypes = [
      "loan_borrowed",
      "loan_funded",
      "loan_repaid",
      "loan_partial_default",
      "loan_liquidated",
    ];

    const whereType = typeFilter && loanTypes.includes(typeFilter)
      ? `AND e.type = '${typeFilter}'`
      : `AND e.type IN (${loanTypes.map((t) => `'${t}'`).join(",")})`;

    const { rows: transactions } = await db(
      `SELECT e.event_id, e.agent_id, e.type, e.amount, e.counterparty_agent_id,
              e.tx_hash, e.rep_delta, e.timestamp,
              a.ens_name AS agent_ens, a.role AS agent_role,
              ca.ens_name AS counterparty_ens,
              m.match_id, m.amount_usdc AS principal_usdc, m.interest_usdc,
              m.collateral_usdc, m.rate_pct, m.status AS match_status,
              m.loan_id_onchain, m.funded_at, m.repaid_at
       FROM event_log e
       JOIN agents a ON a.agent_id = e.agent_id
       LEFT JOIN agents ca ON ca.agent_id = e.counterparty_agent_id
       LEFT JOIN matches m ON (
         (m.borrower_agent_id = e.agent_id AND m.lender_agent_id = e.counterparty_agent_id)
         OR (m.lender_agent_id = e.agent_id AND m.borrower_agent_id = e.counterparty_agent_id)
       )
       WHERE e.amount > 0
         ${whereType}
       ORDER BY e.timestamp DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // Deduplicate matches joined (pick most relevant)
    const seen = new Set<string>();
    const deduped = transactions.filter((row: any) => {
      const key = `${row.event_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Aggregate stats from matches table
    const { rows: aggRows } = await db(
      `SELECT
         COUNT(*) AS total_loans,
         COUNT(*) FILTER (WHERE status = 'active') AS active_loans,
         COUNT(*) FILTER (WHERE status = 'repaid') AS repaid_loans,
         COUNT(*) FILTER (WHERE status IN ('defaulted','liquidated','partial_default')) AS defaulted_loans,
         COALESCE(SUM(amount_usdc), 0) AS total_principal,
         COALESCE(SUM(interest_usdc), 0) AS total_interest,
         COALESCE(SUM(collateral_usdc), 0) AS total_collateral,
         COALESCE(SUM(amount_usdc) FILTER (WHERE status = 'repaid'), 0) AS repaid_principal,
         COALESCE(SUM(interest_usdc) FILTER (WHERE status = 'repaid'), 0) AS repaid_interest
       FROM matches`
    );

    const agg = aggRows[0] || {};

    return res.json({
      transactions: deduped,
      aggregates: {
        totalLoans: Number(agg.total_loans || 0),
        activeLoans: Number(agg.active_loans || 0),
        repaidLoans: Number(agg.repaid_loans || 0),
        defaultedLoans: Number(agg.defaulted_loans || 0),
        totalPrincipal: Number(agg.total_principal || 0),
        totalInterest: Number(agg.total_interest || 0),
        totalCollateral: Number(agg.total_collateral || 0),
        repaidPrincipal: Number(agg.repaid_principal || 0),
        repaidInterest: Number(agg.repaid_interest || 0),
      },
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "failed to load transactions" });
  }
});

function defaultEnabledForRole(role: "lender" | "borrower") {
  return role === "lender"
    ? ["fetch_open_offers", "post_lend_offer", "get_agent_reputation"]
    : ["fetch_open_offers", "get_borrow_quote", "request_borrow", "repay_loan", "get_agent_reputation"];
}

export = router;
