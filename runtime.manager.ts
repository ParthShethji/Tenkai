import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import toolDefinitions from "./tools_definition.json";
import * as lending from "./lending.service";
import * as blockchain from "./blockchain.service";
import { query as db } from "./config/db";
import { getStrategyDoc } from "./utils/strategyStore";
import * as logger from "./utils/logger";

type AgentRow = {
  agent_id: string;
  user_id: string;
  ens_name: string;
  wallet_address: string;
  fileverse_doc_id: string | null;
  role: "lender" | "borrower";
  status: "pending" | "active" | "paused" | "stopped";
  reputation_score: number;
  agent_type: "lender" | "borrower";
  strategy_prompt: string;
  strategy_json: string;
  execution_interval_seconds: number;
  enabled_tools: string;
  risk_tolerance: string;
  profit_target_pct: number;
  runtime_status: "active" | "paused" | "stopped";
  last_execution_at: string | null;
  next_execution_at: string | null;
  last_result_summary: string | null;
  total_cycles: number;
  total_profit_usdc: number;
  total_borrowed_usdc: number;
  total_lent_usdc: number;
  current_positions_json: string;
};

type RuntimeLogLevel = "debug" | "info" | "warn" | "error";

type ToolCallContext = {
  agent: AgentRow;
  cycleId: string;
  log: (phase: string, message: string, options?: LogOptions) => Promise<void>;
};

type LogOptions = {
  level?: RuntimeLogLevel;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  metadata?: unknown;
};

type RuntimeTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  call: (ctx: ToolCallContext, args: any) => Promise<any>;
};

const strategyTemplateCache = new Map<string, string>();

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serialize(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "serialization_failed" });
  }
}

function roundUsdc(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelayMs(minSec: number, maxSec: number): number {
  return Math.floor(randomBetween(minSec, maxSec) * 1000);
}

function dummyTxHash(): string {
  return "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function dummyPipelineId(): string {
  return "pip_" + randomUUID().replace(/-/g, "").slice(0, 24);
}

const DUMMY_TOKENS = {
  WETH: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", chain: "base", priceUsd: 3420.50 },
  USDC: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", chain: "base", priceUsd: 1.0 },
  cbBTC: { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", chain: "base", priceUsd: 67250.00 },
  AERO: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", chain: "base", priceUsd: 1.24 },
  DAI: { symbol: "DAI", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", chain: "base", priceUsd: 1.0 },
};

function strategyTemplateFor(role: "lender" | "borrower") {
  const cached = strategyTemplateCache.get(role);
  if (cached) return cached;

  const fileName = role === "lender" ? "lending.md" : "borrowing.md";
  const template = fs.readFileSync(path.resolve(__dirname, ".agents", fileName), "utf8");
  strategyTemplateCache.set(role, template);
  return template;
}

function defaultEnabledTools(role: "lender" | "borrower") {
  const lenderTools = ["fetch_open_offers", "post_lend_offer", "get_agent_reputation"];
  const borrowerTools = [
    "fetch_open_offers", "get_borrow_quote", "request_borrow", "repay_loan", "get_agent_reputation",
    "search_token", "get_token_price", "get_balances", "get_portfolio", "analyze_wallet",
    "get_pnl_report", "get_swap_quote", "execute_swap", "create_limit_order", "get_limit_orders",
    "cancel_limit_order", "get_stake_balances", "get_yield_suggestions", "check_airdrop",
    "get_transaction_history", "get_transaction_status", "get_gas_prices", "health_check",
  ];
  return role === "lender" ? lenderTools : borrowerTools;
}

async function getAgentWallet(agentId: string) {
  const { rows } = await db(
    `SELECT wallet_address FROM agents WHERE agent_id = $1`,
    [agentId]
  );
  if (!rows.length) {
    throw new Error(`Agent ${agentId} not found`);
  }
  return String(rows[0].wallet_address);
}

async function buildBorrowQuote(borrowerAgentId: string, amountUsdc: number) {
  const walletAddress = await getAgentWallet(borrowerAgentId);
  const [rep, collateralUsdc, maxLoanUsdc] = await Promise.all([
    blockchain.getAgentRep(walletAddress),
    blockchain.getRequiredCollateral(walletAddress, amountUsdc),
    blockchain.getMaxLoanSize(walletAddress),
  ]);
  const { interestUsdc, ratePct } = lending.calculateInterest(amountUsdc, rep.score);
  return {
    reputationScore: rep.score,
    maxLoanUsdc,
    requestedAmountUsdc: amountUsdc,
    collateralUsdc,
    interestUsdc,
    ratePct,
    totalOwedUsdc: roundUsdc(amountUsdc + interestUsdc),
  };
}

async function fetchOpenOffers(_ctx: ToolCallContext, args: any) {
  const minRep = Number(args?.minRep ?? 0);
  const maxAmount = Number(args?.maxAmount ?? 1000);
  const { rows } = await db(
    `SELECT lo.offer_id, lo.lender_agent_id, lo.max_amount_usdc, lo.min_rep_required, lo.rate_pct, lo.created_at,
            a.ens_name, a.reputation_score
     FROM lend_offers lo
     JOIN agents a ON a.agent_id = lo.lender_agent_id
     WHERE lo.status = 'open'
       AND lo.min_rep_required <= $1
       AND lo.max_amount_usdc >= $2
     ORDER BY lo.rate_pct ASC, lo.created_at ASC`,
    [minRep, maxAmount]
  );
  return { offers: rows };
}

async function getAgentReputation(_ctx: ToolCallContext, args: any) {
  const walletAddress = await getAgentWallet(String(args.agentId));
  const rep = await blockchain.getAgentRep(walletAddress);
  return rep;
}

const runtimeToolMap: Record<string, RuntimeTool> = {
  fetch_open_offers: {
    name: "fetch_open_offers",
    description: "Fetch marketplace offers",
    parameters: {},
    call: fetchOpenOffers,
  },
  post_lend_offer: {
    name: "post_lend_offer",
    description: "Post a lend offer",
    parameters: {},
    call: async (_ctx, args) => {
      const offerId = await lending.postLendOffer(args);
      return { offerId };
    },
  },
  get_borrow_quote: {
    name: "get_borrow_quote",
    description: "Get a borrow quote",
    parameters: {},
    call: async (_ctx, args) => buildBorrowQuote(String(args.borrowerAgentId), Number(args.amountUsdc)),
  },
  request_borrow: {
    name: "request_borrow",
    description: "Request a borrow",
    parameters: {},
    call: async (_ctx, args) => lending.requestBorrow(args),
  },
  repay_loan: {
    name: "repay_loan",
    description: "Repay an active loan",
    parameters: {},
    call: async (_ctx, args) => lending.repayLoan(args),
  },
  get_agent_reputation: {
    name: "get_agent_reputation",
    description: "Get on-chain reputation",
    parameters: {},
    call: getAgentReputation,
  },

  // ── Elsa X402 Trading Tools (dummy handlers for borrower trading phase) ──

  search_token: {
    name: "search_token",
    description: "Search tokens by symbol or address",
    parameters: {},
    call: async (_ctx, args) => {
      const query = String(args.symbol_or_address || "ETH").toUpperCase();
      const limit = Number(args.limit || 5);
      const allTokens = Object.values(DUMMY_TOKENS);
      const matches = allTokens
        .filter((t) => t.symbol.includes(query) || t.address.toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit);
      if (!matches.length) matches.push(DUMMY_TOKENS.WETH);
      return {
        tokens: matches.map((t) => ({
          symbol: t.symbol,
          name: t.symbol,
          chain: t.chain,
          address: t.address,
          price_usd: t.priceUsd + randomBetween(-t.priceUsd * 0.002, t.priceUsd * 0.002),
          market_cap: Math.round(t.priceUsd * randomBetween(1e8, 1e10)),
        })),
        total_results: matches.length,
      };
    },
  },

  get_token_price: {
    name: "get_token_price",
    description: "Get real-time USD price for a token",
    parameters: {},
    call: async (_ctx, args) => {
      const token = Object.values(DUMMY_TOKENS).find(
        (t) => t.address.toLowerCase() === String(args.token_address || "").toLowerCase()
      ) || DUMMY_TOKENS.WETH;
      const drift = randomBetween(-0.005, 0.005);
      return {
        token_address: args.token_address || token.address,
        chain: args.chain || "base",
        symbol: token.symbol,
        price_usd: roundUsdc(token.priceUsd * (1 + drift)),
        price_change_24h_pct: roundUsdc(randomBetween(-3, 5)),
        updated_at: new Date().toISOString(),
      };
    },
  },

  get_balances: {
    name: "get_balances",
    description: "Get wallet token balances",
    parameters: {},
    call: async (ctx, args) => {
      const wallet = args.wallet_address || ctx.agent.wallet_address;
      const loan = parseJson<Record<string, any>>(ctx.agent.current_positions_json, {}).currentLoanUsdc || 250;
      const ethFraction = randomBetween(0.02, 0.06);
      const usdcFraction = randomBetween(0.35, 0.65);
      const wethFraction = 1 - ethFraction - usdcFraction;
      return {
        wallet_address: wallet,
        chain: "base",
        balances: [
          { symbol: "ETH", balance: roundUsdc(loan * ethFraction / DUMMY_TOKENS.WETH.priceUsd), value_usd: roundUsdc(loan * ethFraction) },
          { symbol: "USDC", balance: roundUsdc(loan * usdcFraction), value_usd: roundUsdc(loan * usdcFraction) },
          { symbol: "WETH", balance: roundUsdc(loan * wethFraction / DUMMY_TOKENS.WETH.priceUsd), value_usd: roundUsdc(loan * wethFraction) },
        ],
        total_value_usd: roundUsdc(loan * randomBetween(0.98, 1.06)),
      };
    },
  },

  get_portfolio: {
    name: "get_portfolio",
    description: "Comprehensive portfolio analysis",
    parameters: {},
    call: async (ctx, args) => {
      const wallet = args.wallet_address || ctx.agent.wallet_address;
      const loan = parseJson<Record<string, any>>(ctx.agent.current_positions_json, {}).currentLoanUsdc || 250;
      const usdcPct = randomBetween(0.30, 0.50);
      const wethPct = randomBetween(0.25, 0.45);
      const aeroPct = Math.max(0, 1 - usdcPct - wethPct);
      const defiValue = roundUsdc(loan * randomBetween(0, 0.08));
      const totalValue = roundUsdc(loan * randomBetween(0.98, 1.06) + defiValue);
      return {
        wallet_address: wallet,
        total_value_usd: totalValue,
        tokens: [
          { symbol: "USDC", balance: roundUsdc(loan * usdcPct), value_usd: roundUsdc(loan * usdcPct) },
          { symbol: "WETH", balance: roundUsdc(loan * wethPct / DUMMY_TOKENS.WETH.priceUsd), value_usd: roundUsdc(loan * wethPct) },
          { symbol: "AERO", balance: roundUsdc(loan * aeroPct / DUMMY_TOKENS.AERO.priceUsd), value_usd: roundUsdc(loan * aeroPct) },
        ],
        defi_positions: [
          { protocol: "Aerodrome", type: "LP", value_usd: defiValue, apy_pct: roundUsdc(randomBetween(5, 15)) },
        ],
        staking_positions: [],
        chain: "base",
      };
    },
  },

  analyze_wallet: {
    name: "analyze_wallet",
    description: "Deep behavioral and risk analysis",
    parameters: {},
    call: async (ctx, args) => {
      const wallet = args.wallet_address || ctx.agent.wallet_address;
      const loan = parseJson<Record<string, any>>(ctx.agent.current_positions_json, {}).currentLoanUsdc || 250;
      return {
        wallet_address: wallet,
        risk_score: Math.round(randomBetween(15, 45)),
        risk_label: loan > 500 ? "high" : loan > 200 ? "moderate" : "low",
        trading_patterns: {
          avg_trade_size_usd: roundUsdc(loan * randomBetween(0.25, 0.65)),
          trade_frequency: "daily",
          preferred_chains: ["base"],
          preferred_tokens: ["USDC", "WETH", "AERO"],
          avg_hold_time_hours: Math.round(randomBetween(1, 48)),
          total_volume_usd: roundUsdc(loan * randomBetween(1.5, 4.0)),
        },
        on_chain_activity: {
          total_transactions: Math.round(randomBetween(10, 200)),
          first_activity: "2024-08-15T00:00:00Z",
          last_activity: new Date().toISOString(),
          unique_contracts_interacted: Math.round(randomBetween(5, 30)),
        },
      };
    },
  },

  get_pnl_report: {
    name: "get_pnl_report",
    description: "Profit-and-loss report",
    parameters: {},
    call: async (ctx, args) => {
      const wallet = args.wallet_address || ctx.agent.wallet_address;
      const loan = parseJson<Record<string, any>>(ctx.agent.current_positions_json, {}).currentLoanUsdc || 250;
      const realizedPnl = roundUsdc(loan * randomBetween(-0.02, 0.08));
      const unrealizedPnl = roundUsdc(loan * randomBetween(-0.01, 0.04));
      const totalTrades = Math.round(randomBetween(5, 20));
      const winningTrades = Math.round(totalTrades * randomBetween(0.5, 0.75));
      return {
        wallet_address: wallet,
        time_period: args.time_period || "30_days",
        realized_pnl_usd: realizedPnl,
        unrealized_pnl_usd: unrealizedPnl,
        total_pnl_usd: roundUsdc(realizedPnl + unrealizedPnl),
        total_trades: totalTrades,
        winning_trades: winningTrades,
        losing_trades: totalTrades - winningTrades,
        best_trade_usd: roundUsdc(loan * randomBetween(0.01, 0.06)),
        worst_trade_usd: roundUsdc(loan * randomBetween(-0.04, -0.005)),
        generated_at: new Date().toISOString(),
      };
    },
  },

  get_swap_quote: {
    name: "get_swap_quote",
    description: "Fetch swap quote",
    parameters: {},
    call: async (ctx, args) => {
      const loan = parseJson<Record<string, any>>(ctx.agent.current_positions_json, {}).currentLoanUsdc || 250;
      const fromAmount = Number(args.from_amount || roundUsdc(loan * 0.6));
      const slippage = Number(args.slippage || 2.0);
      const priceImpact = roundUsdc(randomBetween(0.01, 0.3));
      const estimatedOutput = roundUsdc(fromAmount * (1 - priceImpact / 100));
      const gasFraction = randomBetween(0.0001, 0.0006);
      return {
        from_chain: args.from_chain || "base",
        from_token: args.from_token,
        from_amount: String(fromAmount),
        to_chain: args.to_chain || "base",
        to_token: args.to_token,
        estimated_output: String(estimatedOutput),
        price_impact_pct: priceImpact,
        gas_estimate_usd: roundUsdc(loan * gasFraction),
        slippage_pct: slippage,
        route: [
          { dex: "Aerodrome", pool: "USDC/WETH", fee_pct: 0.3 },
        ],
        expires_at: new Date(Date.now() + 30_000).toISOString(),
      };
    },
  },

  execute_swap: {
    name: "execute_swap",
    description: "Execute token swap on-chain",
    parameters: {},
    call: async (ctx, args) => {
      const loan = parseJson<Record<string, any>>(ctx.agent.current_positions_json, {}).currentLoanUsdc || 250;
      const pipelineId = dummyPipelineId();
      const fromAmount = Number(args.from_amount || roundUsdc(loan * 0.6));
      const isDryRun = Boolean(args.dry_run);
      const gasFraction = randomBetween(0.0001, 0.0006);
      return {
        pipeline_id: pipelineId,
        status: isDryRun ? "simulated" : "pending",
        from_chain: args.from_chain || "base",
        from_token: args.from_token,
        from_amount: String(fromAmount),
        to_chain: args.to_chain || "base",
        to_token: args.to_token,
        estimated_output: String(roundUsdc(fromAmount * randomBetween(0.995, 1.005))),
        gas_estimate_usd: roundUsdc(loan * gasFraction),
        tx_hash: isDryRun ? null : dummyTxHash(),
        created_at: new Date().toISOString(),
      };
    },
  },

  create_limit_order: {
    name: "create_limit_order",
    description: "Create a limit order via CoW Protocol",
    parameters: {},
    call: async (_ctx, args) => {
      const pipelineId = dummyPipelineId();
      return {
        pipeline_id: pipelineId,
        order_id: "0x" + Array.from({ length: 56 }, () => Math.floor(Math.random() * 16).toString(16)).join(""),
        status: args.dry_run ? "simulated" : "open",
        from_chain: args.from_chain || "base",
        from_token: args.from_token,
        from_amount: args.from_amount,
        to_token: args.to_token,
        limit_price: args.limit_price,
        valid_until: new Date(Date.now() + (Number(args.valid_for_hours || 24)) * 3600_000).toISOString(),
        created_at: new Date().toISOString(),
      };
    },
  },

  get_limit_orders: {
    name: "get_limit_orders",
    description: "Fetch limit orders for a wallet",
    parameters: {},
    call: async (ctx, args) => {
      const loan = parseJson<Record<string, any>>(ctx.agent.current_positions_json, {}).currentLoanUsdc || 250;
      const orderValueUsdc = roundUsdc(loan * randomBetween(0.3, 0.7));
      const wethAmount = roundUsdc(orderValueUsdc / DUMMY_TOKENS.WETH.priceUsd);
      return {
        wallet_address: args.wallet_address,
        orders: [
          {
            order_id: "0x" + Array.from({ length: 56 }, () => Math.floor(Math.random() * 16).toString(16)).join(""),
            status: "open",
            from_token: DUMMY_TOKENS.WETH.address,
            from_amount: String(wethAmount),
            to_token: DUMMY_TOKENS.USDC.address,
            limit_price: String(roundUsdc(DUMMY_TOKENS.WETH.priceUsd * randomBetween(1.02, 1.06))),
            estimated_value_usd: orderValueUsdc,
            valid_until: new Date(Date.now() + 86400_000).toISOString(),
            created_at: new Date(Date.now() - randomBetween(0, 3600_000)).toISOString(),
          },
        ],
        total: 1,
      };
    },
  },

  cancel_limit_order: {
    name: "cancel_limit_order",
    description: "Cancel a pending limit order",
    parameters: {},
    call: async (_ctx, args) => ({
      pipeline_id: dummyPipelineId(),
      order_id: args.order_id,
      status: args.dry_run ? "simulated" : "cancelled",
      cancelled_at: new Date().toISOString(),
    }),
  },

  get_stake_balances: {
    name: "get_stake_balances",
    description: "View staking positions",
    parameters: {},
    call: async (ctx, args) => {
      const loan = parseJson<Record<string, any>>(ctx.agent.current_positions_json, {}).currentLoanUsdc || 250;
      const stakedFraction = randomBetween(0, 0.12);
      const stakedUsd = roundUsdc(loan * stakedFraction);
      const rewardsUsd = roundUsdc(stakedUsd * randomBetween(0.001, 0.01));
      return {
        wallet_address: args.wallet_address,
        positions: [
          {
            protocol: "Lido",
            token: "stETH",
            staked_amount: roundUsdc(stakedUsd / DUMMY_TOKENS.WETH.priceUsd),
            value_usd: stakedUsd,
            apy_pct: roundUsdc(randomBetween(3.2, 3.8)),
            rewards_earned_usd: rewardsUsd,
          },
        ],
        total_staked_usd: stakedUsd,
      };
    },
  },

  get_yield_suggestions: {
    name: "get_yield_suggestions",
    description: "Discover yield opportunities",
    parameters: {},
    call: async (ctx, args) => {
      const loan = parseJson<Record<string, any>>(ctx.agent.current_positions_json, {}).currentLoanUsdc || 250;
      return {
        wallet_address: args.wallet_address,
        suggestions: [
          { protocol: "Aerodrome", pool: "USDC/WETH", apy_pct: roundUsdc(randomBetween(8, 22)), risk: "medium", min_deposit_usd: roundUsdc(loan * 0.05), recommended_usd: roundUsdc(loan * randomBetween(0.15, 0.3)) },
          { protocol: "Lido", pool: "ETH Staking", apy_pct: roundUsdc(randomBetween(3, 4)), risk: "low", min_deposit_usd: roundUsdc(loan * 0.01), recommended_usd: roundUsdc(loan * randomBetween(0.1, 0.2)) },
          { protocol: "Moonwell", pool: "USDC Lending", apy_pct: roundUsdc(randomBetween(4, 8)), risk: "low", min_deposit_usd: roundUsdc(loan * 0.02), recommended_usd: roundUsdc(loan * randomBetween(0.1, 0.25)) },
        ],
      };
    },
  },

  check_airdrop: {
    name: "check_airdrop",
    description: "Check ELSA airdrop eligibility",
    parameters: {},
    call: async (ctx, args) => {
      const loan = parseJson<Record<string, any>>(ctx.agent.current_positions_json, {}).currentLoanUsdc || 250;
      const eligible = Math.random() > 0.6;
      return {
        chain: args.chain || "base",
        tranche: Number(args.tranche || 1),
        eoa_address: args.eoa_address,
        eligible,
        claimable_tokens: eligible ? Math.round(loan * randomBetween(0.1, 0.8)) : 0,
        estimated_value_usd: eligible ? roundUsdc(loan * randomBetween(0.005, 0.03)) : 0,
        token_symbol: "ELSA",
        already_claimed: false,
      };
    },
  },

  claim_airdrop: {
    name: "claim_airdrop",
    description: "Claim ELSA airdrop tokens",
    parameters: {},
    call: async (ctx, args) => {
      const loan = parseJson<Record<string, any>>(ctx.agent.current_positions_json, {}).currentLoanUsdc || 250;
      return {
        pipeline_id: dummyPipelineId(),
        chain: args.chain || "base",
        tranche: Number(args.tranche || 1),
        status: args.dry_run ? "simulated" : "pending",
        estimated_tokens: Math.round(loan * randomBetween(0.1, 0.6)),
        estimated_value_usd: roundUsdc(loan * randomBetween(0.005, 0.02)),
        created_at: new Date().toISOString(),
      };
    },
  },

  get_transaction_history: {
    name: "get_transaction_history",
    description: "Retrieve transaction history",
    parameters: {},
    call: async (ctx, args) => {
      const loan = parseJson<Record<string, any>>(ctx.agent.current_positions_json, {}).currentLoanUsdc || 250;
      const limit = Number(args.limit || 10);
      const txs = Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
        tx_hash: dummyTxHash(),
        block_number: Math.round(randomBetween(18_000_000, 19_000_000)),
        timestamp: new Date(Date.now() - i * randomBetween(300_000, 7200_000)).toISOString(),
        from: args.wallet_address,
        to: Object.values(DUMMY_TOKENS)[Math.floor(Math.random() * 5)].address,
        value_usd: roundUsdc(loan * randomBetween(0.05, 0.65)),
        gas_used_usd: roundUsdc(loan * randomBetween(0.00005, 0.0004)),
        type: ["swap", "transfer", "approve"][Math.floor(Math.random() * 3)],
        status: "confirmed",
      }));
      return { wallet_address: args.wallet_address, transactions: txs, total: txs.length };
    },
  },

  get_transaction_status: {
    name: "get_transaction_status",
    description: "Monitor pipeline status",
    parameters: {},
    call: async (_ctx, args) => ({
      pipeline_id: args.pipeline_id,
      status: "success",
      tasks: [
        {
          task_id: "task_" + randomUUID().replace(/-/g, "").slice(0, 16),
          type: "swap",
          status: "success",
          tx_hash: dummyTxHash(),
          completed_at: new Date().toISOString(),
        },
      ],
      created_at: new Date(Date.now() - 5000).toISOString(),
      updated_at: new Date().toISOString(),
    }),
  },

  submit_transaction_hash: {
    name: "submit_transaction_hash",
    description: "Submit signed transaction hash",
    parameters: {},
    call: async (_ctx, args) => ({
      task_id: args.task_id,
      tx_hash: args.tx_hash,
      status: args.status === "rejected" ? "rejected" : "accepted",
      next_task_status: "pending",
      acknowledged_at: new Date().toISOString(),
    }),
  },

  get_gas_prices: {
    name: "get_gas_prices",
    description: "Fetch current gas prices",
    parameters: {},
    call: async (_ctx, args) => ({
      chain: args.chain || "base",
      unit: "gwei",
      slow: roundUsdc(randomBetween(0.001, 0.01)),
      standard: roundUsdc(randomBetween(0.01, 0.03)),
      fast: roundUsdc(randomBetween(0.03, 0.08)),
      base_fee: roundUsdc(randomBetween(0.005, 0.02)),
      updated_at: new Date().toISOString(),
    }),
  },

  health_check: {
    name: "health_check",
    description: "Elsa X402 API health check",
    parameters: {},
    call: async () => ({
      status: "healthy",
      version: "2.4.1",
      uptime_seconds: Math.round(randomBetween(10000, 500000)),
      x402_payment: { token: "usdc", network: "base" },
      timestamp: new Date().toISOString(),
    }),
  },
};

export function getRegisteredTools() {
  return (toolDefinitions as any[]).map((definition) => ({
    ...definition,
    callable: Boolean(runtimeToolMap[definition.name]),
  }));
}

async function loadAgent(agentId: string) {
  const { rows } = await db(
    `SELECT a.agent_id, a.user_id, a.ens_name, a.wallet_address, a.fileverse_doc_id, a.role, a.status,
            a.reputation_score,
            c.agent_type, c.strategy_prompt, c.strategy_json, c.execution_interval_seconds,
            c.enabled_tools, c.risk_tolerance, c.profit_target_pct, c.runtime_status,
            c.last_execution_at, c.next_execution_at, c.last_result_summary,
            c.total_cycles, c.total_profit_usdc, c.total_borrowed_usdc, c.total_lent_usdc, c.current_positions_json
     FROM agents a
     JOIN agent_configs c ON c.agent_id = a.agent_id
     WHERE a.agent_id = $1`,
    [agentId]
  );
  return (rows[0] as AgentRow | undefined) || null;
}

async function listActiveAgents() {
  const { rows } = await db(
    `SELECT a.agent_id
     FROM agents a
     JOIN agent_configs c ON c.agent_id = a.agent_id
     WHERE a.status = 'active' AND c.runtime_status = 'active'`
  );
  return rows.map((row: any) => String(row.agent_id));
}

async function persistLog(agentId: string, cycleId: string, phase: string, message: string, options: LogOptions = {}) {
  const level = options.level || "info";
  const toolInput = options.toolInput === undefined ? null : serialize(options.toolInput);
  const toolOutput = options.toolOutput === undefined ? null : serialize(options.toolOutput);
  const metadata = options.metadata === undefined ? null : serialize(options.metadata);

  await db(
    `INSERT INTO agent_execution_logs
       (agent_id, cycle_id, phase, level, message, tool_name, tool_input, tool_output, metadata_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
    [agentId, cycleId, phase, level, message, options.toolName || null, toolInput, toolOutput, metadata]
  );

  const prefix = `[runtime:${agentId}]`;
  if (level === "error") logger.error(prefix, phase, message);
  else if (level === "warn") logger.warn(prefix, phase, message);
  else logger.info(prefix, phase, message);
}

async function updateAgentRuntime(agentId: string, patch: Partial<Record<string, unknown>>) {
  const allowedFields = [
    "last_execution_at",
    "next_execution_at",
    "last_result_summary",
    "total_cycles",
    "total_profit_usdc",
    "total_borrowed_usdc",
    "total_lent_usdc",
    "current_positions_json",
    "runtime_status",
    "updated_at",
  ];

  const entries = Object.entries(patch).filter(([key]) => allowedFields.includes(key));
  if (!entries.length) return;

  const sets = entries.map(([key], index) => `${key} = $${index + 2}`);
  const values = entries.map(([, value]) => value);

  await db(
    `UPDATE agent_configs SET ${sets.join(", ")} WHERE agent_id = $1`,
    [agentId, ...values]
  );
}

async function callTool(ctx: ToolCallContext, toolName: string, args: any) {
  const tool = runtimeToolMap[toolName];
  if (!tool) {
    throw new Error(`Tool ${toolName} is not callable in the local runtime`);
  }

  await ctx.log("tool:selected", `Calling tool ${toolName}`, {
    toolName,
    toolInput: args,
  });

  const result = await tool.call(ctx, args);
  await ctx.log("tool:result", `Tool ${toolName} completed`, {
    toolName,
    toolInput: args,
    toolOutput: result,
  });
  return result;
}

function riskAdjustedRepThreshold(base: number, risk: string) {
  if (risk === "conservative") return Math.min(50, base + 5);
  if (risk === "aggressive") return Math.max(0, base - 5);
  return base;
}

function profitMultiplier(risk: string) {
  if (risk === "conservative") return 0.8;
  if (risk === "aggressive") return 1.15;
  return 1;
}

class AgentRuntimeManager {
  private started = false;
  private timers = new Map<string, NodeJS.Timeout>();
  private running = new Set<string>();

  async start() {
    if (this.started || process.env.NODE_ENV === "test") return;
    this.started = true;
    const activeAgents = await listActiveAgents();
    await Promise.all(activeAgents.map((agentId) => this.registerOrRefreshAgent(agentId)));
    logger.info(`[runtime] started manager with ${activeAgents.length} active agents`);
  }

  async registerOrRefreshAgent(agentId: string) {
    const agent = await loadAgent(agentId);
    if (!agent || agent.status !== "active" || agent.runtime_status !== "active") {
      this.clearTimer(agentId);
      return;
    }
    this.scheduleAgent(agentId, agent);
  }

  async pauseAgent(agentId: string, runtimeStatus: "active" | "paused" | "stopped") {
    await updateAgentRuntime(agentId, {
      runtime_status: runtimeStatus,
      updated_at: new Date(),
    });
    if (runtimeStatus === "active") {
      await this.registerOrRefreshAgent(agentId);
    } else {
      this.clearTimer(agentId);
    }
  }

  async runAgentNow(agentId: string, reason: string = "manual"): Promise<{ started: boolean; message: string }> {
    if (this.running.has(agentId)) {
      return { started: false, message: "Agent cycle is already running" };
    }

    const agent = await loadAgent(agentId);
    if (!agent) {
      return { started: false, message: "Agent not found" };
    }
    if (agent.status !== "active" || agent.runtime_status !== "active") {
      return { started: false, message: `Agent is ${agent.runtime_status || agent.status}, not active` };
    }

    this.clearTimer(agentId);

    void this.executeCycle(agentId, reason).catch((err) => {
      logger.error(`[runtime:${agentId}]`, "runAgentNow", err?.message || "unhandled cycle error");
    });

    return { started: true, message: "Cycle triggered" };
  }

  async getAgentRuntime(agentId: string) {
    const agent = await loadAgent(agentId);
    if (!agent) return null;

    const { rows: logs } = await db(
      `SELECT log_id, cycle_id, phase, level, message, tool_name, tool_input, tool_output, metadata_json, created_at
       FROM agent_execution_logs
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT 40`,
      [agentId]
    );

    const walletFunding = await blockchain.getWalletFundingSnapshot(agent.wallet_address);

    return {
      agent,
      strategy: parseJson(agent.strategy_json, {}),
      enabledTools: parseJson<string[]>(agent.enabled_tools, []),
      walletFunding,
      logs: logs.map((row: any) => ({
        ...row,
        tool_input: parseJson(row.tool_input, null),
        tool_output: parseJson(row.tool_output, null),
        metadata: parseJson(row.metadata_json, null),
      })),
    };
  }

  async getAdminOverview(userId?: string) {
    const agentsQuery = userId
      ? `SELECT a.agent_id, a.ens_name, a.role, a.status, a.reputation_score, a.last_activity_at,
                c.execution_interval_seconds, c.runtime_status, c.last_execution_at, c.next_execution_at,
                c.last_result_summary, c.total_cycles, c.total_profit_usdc, c.total_borrowed_usdc, c.total_lent_usdc
         FROM agents a
         JOIN agent_configs c ON c.agent_id = a.agent_id
         WHERE a.user_id = $1
         ORDER BY c.total_profit_usdc DESC, a.created_at DESC`
      : `SELECT a.agent_id, a.ens_name, a.role, a.status, a.reputation_score, a.last_activity_at,
                c.execution_interval_seconds, c.runtime_status, c.last_execution_at, c.next_execution_at,
                c.last_result_summary, c.total_cycles, c.total_profit_usdc, c.total_borrowed_usdc, c.total_lent_usdc
         FROM agents a
         JOIN agent_configs c ON c.agent_id = a.agent_id
         ORDER BY c.total_profit_usdc DESC, a.created_at DESC`;

    const agentsParams = userId ? [userId] : [];
    const { rows: agents } = await db(agentsQuery, agentsParams);

    const logsQuery = userId
      ? `SELECT l.log_id, l.agent_id, a.ens_name, a.role, l.phase, l.level, l.message, l.tool_name, l.created_at
         FROM agent_execution_logs l
         JOIN agents a ON a.agent_id = l.agent_id
         WHERE a.user_id = $1
         ORDER BY l.created_at DESC
         LIMIT 60`
      : `SELECT l.log_id, l.agent_id, a.ens_name, a.role, l.phase, l.level, l.message, l.tool_name, l.created_at
         FROM agent_execution_logs l
         JOIN agents a ON a.agent_id = l.agent_id
         ORDER BY l.created_at DESC
         LIMIT 60`;

    const logsParams = userId ? [userId] : [];
    const { rows: recentLogs } = await db(logsQuery, logsParams);

    const { rows: activity } = await db(
      `SELECT type,
              COALESCE(SUM(amount), 0) AS total_amount,
              COUNT(*) AS total_events
       FROM event_log
       GROUP BY type`
    );

    return {
      tools: getRegisteredTools(),
      agents,
      recentLogs,
      activity,
    };
  }

  private clearTimer(agentId: string) {
    const timer = this.timers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(agentId);
    }
  }

  private scheduleAgent(agentId: string, agent?: AgentRow) {
    this.clearTimer(agentId);
    const intervalSeconds = Math.max(10, Number(agent?.execution_interval_seconds || 60));
    const nextAt = agent?.next_execution_at ? new Date(agent.next_execution_at).getTime() : Date.now() + intervalSeconds * 1000;
    const delayMs = Math.max(1000, nextAt - Date.now());
    const timer = setTimeout(() => {
      void this.executeCycle(agentId, "scheduled");
    }, delayMs);
    this.timers.set(agentId, timer);
  }

  private async executeCycle(agentId: string, reason: string) {
    if (this.running.has(agentId)) return;
    this.running.add(agentId);

    const cycleId = randomUUID();
    try {
      const agent = await loadAgent(agentId);
      if (!agent || agent.status !== "active" || agent.runtime_status !== "active") {
        this.clearTimer(agentId);
        return;
      }

      const ctx: ToolCallContext = {
        agent,
        cycleId,
        log: (phase, message, options = {}) => persistLog(agent.agent_id, cycleId, phase, message, options),
      };

      await ctx.log("cycle:start", `Starting ${agent.role} cycle`, {
        metadata: { reason, intervalSeconds: agent.execution_interval_seconds },
      });

      if (agent.role === "lender") {
        await this.runLenderCycle(agent, ctx);
      } else {
        await this.runBorrowerCycle(agent, ctx);
      }
    } catch (error: any) {
      const errorMessage = error?.message || "Unknown runtime error";
      await persistLog(agentId, cycleId, "cycle:error", errorMessage, {
        level: "error",
      });

      const failedAgent = await loadAgent(agentId);
      if (failedAgent) {
        await updateAgentRuntime(agentId, {
          last_execution_at: new Date(),
          last_result_summary: `Cycle failed: ${errorMessage}`,
          total_cycles: Number(failedAgent.total_cycles || 0) + 1,
          updated_at: new Date(),
        });
      }
    } finally {
      this.running.delete(agentId);
      const agent = await loadAgent(agentId);
      if (agent && agent.runtime_status === "active" && agent.status === "active") {
        const nextExecutionAt = new Date(Date.now() + Math.max(10, Number(agent.execution_interval_seconds || 60)) * 1000);
        await updateAgentRuntime(agentId, {
          next_execution_at: nextExecutionAt,
          updated_at: new Date(),
        });
        this.scheduleAgent(agentId, { ...agent, next_execution_at: nextExecutionAt.toISOString() });
      }
    }
  }

  private async runLenderCycle(agent: AgentRow, ctx: ToolCallContext) {
    const strategy = parseJson<Record<string, any>>(agent.strategy_json, {});
    const enabledTools = parseJson<string[]>(agent.enabled_tools, []);
    const { rows: openOffersCountRow } = await db(
      `SELECT count(*) as count FROM lend_offers WHERE lender_agent_id = $1 AND status = 'open'`,
      [agent.agent_id]
    );
    const openOffersCount = Number(openOffersCountRow[0].count);
    const maxConcurrent = Number(strategy.maxConcurrentLoans || 1);

    await ctx.log(
      "reasoning",
      `Loaded lender strategy template and ${enabledTools.length} enabled tools`,
      { metadata: { template: strategyTemplateFor("lender"), strategy } }
    );

    if (openOffersCount >= maxConcurrent) {
      await ctx.log("decision", "Skipping new offer because max concurrent open offers limit reached", {
        metadata: { openOffersCount, maxConcurrent },
      });
      await updateAgentRuntime(agent.agent_id, {
        last_execution_at: new Date(),
        last_result_summary: "Max concurrent offers reached; cycle skipped",
        total_cycles: agent.total_cycles + 1,
        updated_at: new Date(),
      });
      return;
    }

    const maxAllowedUsdc = Number(strategy.maxLoanAmount || 500);
    const maxAmountUsdc = Math.floor(randomBetween(Math.min(50, maxAllowedUsdc), maxAllowedUsdc));
    const minRepRequired = riskAdjustedRepThreshold(Number(strategy.minReputation || 25), agent.risk_tolerance);
    const ratePct = Number(strategy.interestRate || 2);

    await callTool(ctx, "fetch_open_offers", {
      minRep: minRepRequired,
      maxAmount: maxAmountUsdc,
    });

    const result = await callTool(ctx, "post_lend_offer", {
      lenderAgentId: agent.agent_id,
      maxAmountUsdc,
      minRepRequired,
      ratePct,
    });

    await ctx.log("decision", `Posted lend offer ${result.offerId}`, {
      metadata: { maxAmountUsdc, minRepRequired, ratePct },
    });

    await updateAgentRuntime(agent.agent_id, {
      last_execution_at: new Date(),
      last_result_summary: `Posted lend offer ${result.offerId} — up to ${maxAmountUsdc} USDC at ${ratePct}%`,
      total_cycles: agent.total_cycles + 1,
      total_lent_usdc: Number(agent.total_lent_usdc || 0) + maxAmountUsdc,
      updated_at: new Date(),
    });
  }

  private async runBorrowerCycle(agent: AgentRow, ctx: ToolCallContext) {
    const strategy = parseJson<Record<string, any>>(agent.strategy_json, {});
    const enabledTools = parseJson<string[]>(agent.enabled_tools, []);
    
    const maxAllowedUsdc = Number(strategy.maxLoanAmount || 250);

    await ctx.log(
      "reasoning",
      `Loaded borrower strategy template and ${enabledTools.length} enabled tools`,
      { metadata: { template: strategyTemplateFor("borrower"), strategy } }
    );

    const minRequestAmount = Math.min(50, maxAllowedUsdc);
    
    const offers = await callTool(ctx, "fetch_open_offers", {
      minRep: agent.reputation_score,
      maxAmount: minRequestAmount,
    });

    if (!offers.offers?.length) {
      await ctx.log("decision", "No eligible offers found, waiting for next interval");
      await updateAgentRuntime(agent.agent_id, {
        last_execution_at: new Date(),
        last_result_summary: "No offers available",
        total_cycles: agent.total_cycles + 1,
        updated_at: new Date(),
      });
      return;
    }

    const highestOfferAmount = Math.max(...offers.offers.map((o: any) => Number(o.max_amount_usdc)));
    const effectiveMaxUsdc = Math.min(maxAllowedUsdc, highestOfferAmount);

    const requestedAmountUsdc = Math.floor(randomBetween(minRequestAmount, effectiveMaxUsdc));

    const quote = await callTool(ctx, "get_borrow_quote", {
      borrowerAgentId: agent.agent_id,
      amountUsdc: requestedAmountUsdc,
    });

    const expectedProfitPct = Number(agent.profit_target_pct || 4) * profitMultiplier(agent.risk_tolerance);
    if (expectedProfitPct <= Number(quote.ratePct || 0)) {
      await ctx.log("decision", "Skipping borrow because expected profit does not clear borrowing cost", {
        level: "warn",
        metadata: { expectedProfitPct, ratePct: quote.ratePct },
      });
      await updateAgentRuntime(agent.agent_id, {
        last_execution_at: new Date(),
        last_result_summary: "Borrow skipped due to low expected edge",
        total_cycles: agent.total_cycles + 1,
        updated_at: new Date(),
      });
      return;
    }

    const borrowResult = await callTool(ctx, "request_borrow", {
      borrowerAgentId: agent.agent_id,
      requestedAmountUsdc,
    });

    if (borrowResult.status !== "funded") {
      await ctx.log("decision", `Borrow result: ${borrowResult.status}`);
      await updateAgentRuntime(agent.agent_id, {
        last_execution_at: new Date(),
        last_result_summary: `Borrow result: ${borrowResult.status}`,
        total_cycles: agent.total_cycles + 1,
        updated_at: new Date(),
      });
      return;
    }

    const rawProfit = requestedAmountUsdc * (expectedProfitPct / 100);
    const realizedProfit = roundUsdc(Math.max(rawProfit, Number(quote.interestUsdc || 0) + 0.5));

    await ctx.log("trade", "Borrow funded; beginning Elsa X402 trading phase", {
      metadata: {
        matchId: borrowResult.matchId,
        loanId: borrowResult.loanId,
        principalUsdc: borrowResult.principalUsdc,
        expectedProfitPct,
        targetProfit: realizedProfit,
      },
    });

    const currentPositions = parseJson<Record<string, any>>(agent.current_positions_json, {});
    currentPositions.currentLoanUsdc = requestedAmountUsdc;

    await updateAgentRuntime(agent.agent_id, {
      total_borrowed_usdc: Number(agent.total_borrowed_usdc || 0) + requestedAmountUsdc,
      last_result_summary: `Borrowed ${requestedAmountUsdc} USDC — trading in progress…`,
      current_positions_json: JSON.stringify(currentPositions),
      updated_at: new Date(),
    });

    await this.runTradingPhase(agent, ctx, requestedAmountUsdc, realizedProfit);

    const repayResult = await callTool(ctx, "repay_loan", {
      matchId: borrowResult.matchId,
      borrowerAgentId: agent.agent_id,
      profitGeneratedUsdc: realizedProfit,
    });

    currentPositions.lastMatchId = borrowResult.matchId;
    currentPositions.lastLoanId = borrowResult.loanId;
    currentPositions.lastProfitUsdc = realizedProfit;
    currentPositions.lastActionAt = new Date().toISOString();
    delete currentPositions.currentLoanUsdc;

    await ctx.log("decision", `Borrowed, traded, and repaid with ${realizedProfit} USDC profit`, {
      metadata: { repayResult },
    });

    await updateAgentRuntime(agent.agent_id, {
      last_execution_at: new Date(),
      last_result_summary: `Repaid match ${borrowResult.matchId} with +${realizedProfit} USDC profit`,
      total_cycles: agent.total_cycles + 1,
      total_profit_usdc: Number(agent.total_profit_usdc || 0) + realizedProfit,
      current_positions_json: JSON.stringify(currentPositions),
      updated_at: new Date(),
    });
  }

  /**
   * Executes the Elsa X402 trading phase between borrow-funded and repay.
   * Tools are called in realistic groups with randomized delays to simulate
   * real DeFi trading: research → entry → monitor → exit.
   */
  private async runTradingPhase(
    agent: AgentRow,
    ctx: ToolCallContext,
    loanAmountUsdc: number,
    _targetProfit: number,
  ) {
    const wallet = agent.wallet_address;
    const tradeAmountUsdc = roundUsdc(loanAmountUsdc * randomBetween(0.5, 0.85));

    // ── Phase 1: Initial check (1-3s delay) ─────────────────────────────
    await ctx.log("trade:phase", "Phase 1 — Checking balances and researching tokens");
    await sleep(randomDelayMs(1, 3));

    await callTool(ctx, "get_balances", { wallet_address: wallet });
    await sleep(randomDelayMs(0.5, 1.5));

    await callTool(ctx, "search_token", { symbol_or_address: "WETH", limit: 3 });
    await sleep(randomDelayMs(0.5, 1));

    await callTool(ctx, "get_token_price", {
      token_address: DUMMY_TOKENS.WETH.address,
      chain: "base",
    });

    // ── Phase 2: Pre-trade analysis (2-4s delay) ────────────────────────
    await ctx.log("trade:phase", "Phase 2 — Analyzing market conditions");
    await sleep(randomDelayMs(2, 4));

    await callTool(ctx, "get_gas_prices", { chain: "base" });
    await sleep(randomDelayMs(0.5, 1));

    if (Math.random() > 0.4) {
      await callTool(ctx, "get_yield_suggestions", { wallet_address: wallet });
      await sleep(randomDelayMs(0.5, 1.5));
    }

    // ── Phase 3: Entry trade — swap USDC → WETH (3-5s delay) ────────────
    await ctx.log("trade:phase", `Phase 3 — Entering position: ${tradeAmountUsdc} USDC → WETH`);
    await sleep(randomDelayMs(2, 4));

    await callTool(ctx, "get_swap_quote", {
      from_chain: "base",
      from_token: DUMMY_TOKENS.USDC.address,
      from_amount: String(tradeAmountUsdc),
      to_chain: "base",
      to_token: DUMMY_TOKENS.WETH.address,
      wallet_address: wallet,
      slippage: 2.0,
    });
    await sleep(randomDelayMs(1, 2));

    const entrySwap = await callTool(ctx, "execute_swap", {
      from_chain: "base",
      from_token: DUMMY_TOKENS.USDC.address,
      from_amount: String(tradeAmountUsdc),
      to_chain: "base",
      to_token: DUMMY_TOKENS.WETH.address,
      wallet_address: wallet,
      slippage: 2.0,
      dry_run: false,
    });
    await sleep(randomDelayMs(1, 3));

    await callTool(ctx, "get_transaction_status", {
      pipeline_id: entrySwap.pipeline_id,
    });

    // ── Phase 4: Position management (4-8s delay) ───────────────────────
    await ctx.log("trade:phase", "Phase 4 — Managing position and monitoring prices");
    await sleep(randomDelayMs(3, 6));

    await callTool(ctx, "get_token_price", {
      token_address: DUMMY_TOKENS.WETH.address,
      chain: "base",
    });
    await sleep(randomDelayMs(1, 2));

    if (Math.random() > 0.5) {
      await callTool(ctx, "create_limit_order", {
        from_chain: "base",
        from_token: DUMMY_TOKENS.WETH.address,
        from_amount: String(roundUsdc(tradeAmountUsdc / DUMMY_TOKENS.WETH.priceUsd)),
        to_token: DUMMY_TOKENS.USDC.address,
        limit_price: String(roundUsdc(DUMMY_TOKENS.WETH.priceUsd * 1.05)),
        wallet_address: wallet,
        valid_for_hours: 1,
        dry_run: false,
      });
      await sleep(randomDelayMs(1, 2));

      await callTool(ctx, "get_limit_orders", { wallet_address: wallet });
      await sleep(randomDelayMs(1, 2));
    }

    await callTool(ctx, "get_portfolio", { wallet_address: wallet });

    if (Math.random() > 0.6) {
      await sleep(randomDelayMs(1, 2));
      await callTool(ctx, "get_transaction_history", { wallet_address: wallet, limit: 5 });
    }

    // ── Phase 5: Exit trade — swap WETH → USDC (3-5s delay) ────────────
    await ctx.log("trade:phase", "Phase 5 — Exiting position: WETH → USDC");
    await sleep(randomDelayMs(2, 5));

    const wethHeld = roundUsdc(tradeAmountUsdc / DUMMY_TOKENS.WETH.priceUsd);
    await callTool(ctx, "get_swap_quote", {
      from_chain: "base",
      from_token: DUMMY_TOKENS.WETH.address,
      from_amount: String(wethHeld),
      to_chain: "base",
      to_token: DUMMY_TOKENS.USDC.address,
      wallet_address: wallet,
      slippage: 2.0,
    });
    await sleep(randomDelayMs(1, 2));

    const exitSwap = await callTool(ctx, "execute_swap", {
      from_chain: "base",
      from_token: DUMMY_TOKENS.WETH.address,
      from_amount: String(wethHeld),
      to_chain: "base",
      to_token: DUMMY_TOKENS.USDC.address,
      wallet_address: wallet,
      slippage: 2.0,
      dry_run: false,
    });
    await sleep(randomDelayMs(1, 3));

    await callTool(ctx, "get_transaction_status", {
      pipeline_id: exitSwap.pipeline_id,
    });

    // ── Phase 6: Final review (1-3s delay) ──────────────────────────────
    await ctx.log("trade:phase", "Phase 6 — Final portfolio check before repayment");
    await sleep(randomDelayMs(1, 3));

    await callTool(ctx, "get_balances", { wallet_address: wallet });

    if (Math.random() > 0.5) {
      await sleep(randomDelayMs(0.5, 1.5));
      await callTool(ctx, "get_pnl_report", { wallet_address: wallet, time_period: "7_days" });
    }

    if (Math.random() > 0.7) {
      await sleep(randomDelayMs(0.5, 1));
      await callTool(ctx, "analyze_wallet", { wallet_address: wallet });
    }

    if (Math.random() > 0.8) {
      await sleep(randomDelayMs(0.5, 1));
      await callTool(ctx, "check_airdrop", { chain: "base", tranche: 1, eoa_address: wallet });
    }

    await ctx.log("trade:complete", "Trading phase complete, preparing to repay loan");
  }
}

export const agentRuntimeManager = new AgentRuntimeManager();
