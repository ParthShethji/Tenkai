/**
 * Shared request/response types for platform and lending API.
 * Aligned with backend routes (platform.routes.ts, lending.routes.ts).
 */

// ─── Platform ───────────────────────────────────────────────────────────────

export interface CreateUserPayload {
  email: string;
  walletAddress?: string;
  zkProofData?: string;
  signature?: string;
  message?: string;
  ensName?: string;
}

export interface CreateUserResponse {
  userId: string;
  email: string;
  walletAddress: string;
  zkVerified: boolean;
  ensName?: string | null;
  existing?: boolean;
}

export interface SessionResponse {
  user: {
    userId: string;
    email: string;
    walletAddress: string;
    ensName?: string | null;
    zkVerified: boolean;
  } | null;
  agents: UserAgent[];
}

export interface CreateAgentPayload {
  userId: string;
  role: "lender" | "borrower";
  username?: string;
  ensName: string;
  initialScore?: number;
  strategy?: Record<string, unknown>;
  executionIntervalSeconds?: number;
  riskTolerance?: "conservative" | "balanced" | "aggressive";
  profitTargetPct?: number;
  enabledTools?: string[];
}

export interface CreateAgentResponse {
  agentId: string;
  ensName: string;
  walletAddress: string;
  privateKey?: string;
  role: string;
  fileverseDocId: string;
  registerTxHash: string;
  initialScore: number;
  executionIntervalSeconds?: number;
  enabledTools?: string[];
  riskTolerance?: string;
  profitTargetPct?: number;
  strategyPrompt?: string;
  runtimeStatus?: string;
}

export interface UserAgent {
  agent_id: string;
  ens_name: string;
  wallet_address: string;
  role: "lender" | "borrower";
  status: string;
  reputation_score: number;
  fileverse_doc_id?: string | null;
  has_private_key?: boolean;
  execution_interval_seconds?: number;
  enabled_tools?: string[];
  risk_tolerance?: string;
  profit_target_pct?: number;
  runtime_status?: string;
  last_execution_at?: string | null;
  next_execution_at?: string | null;
  last_result_summary?: string | null;
  total_cycles?: number;
  total_profit_usdc?: number;
  total_borrowed_usdc?: number;
  total_lent_usdc?: number;
  eth_balance?: number;
  usdc_balance?: number;
  strategy?: Record<string, unknown>;
}

export interface FundAgentPayload {
  ethAmount?: string;
  usdcAmount?: number;
}

export interface RuntimeLog {
  log_id: number;
  cycle_id: string;
  phase: string;
  level: string;
  message: string;
  tool_name?: string | null;
  tool_input?: unknown;
  tool_output?: unknown;
  metadata?: unknown;
  created_at: string;
}

export interface AgentRuntimeResponse {
  agent: UserAgent;
  strategy: Record<string, unknown>;
  enabledTools: string[];
  walletFunding: {
    ethBalance: number;
    usdcBalance: number;
    usdcAddress?: string | null;
    contractAddress?: string | null;
  };
  logs: RuntimeLog[];
}

export interface AdminOverviewResponse {
  tools: Array<Record<string, unknown>>;
  agents: UserAgent[];
  recentLogs: Array<{
    log_id: number;
    agent_id: string;
    ens_name: string;
    role: string;
    phase: string;
    level: string;
    message: string;
    tool_name?: string | null;
    created_at: string;
  }>;
  activity: Array<{
    type: string;
    total_amount: number | string;
    total_events: number | string;
  }>;
}

// ─── Lending - Offers ────────────────────────────────────────────────────────

export interface Offer {
  offer_id: number;
  lender_agent_id: string;
  ens_name: string;
  max_amount_usdc: number;
  min_rep_required: number;
  rate_pct: number;
  created_at: string;
}

export interface GetOffersResponse {
  offers: Offer[];
}

export interface PostOfferPayload {
  lenderAgentId: string;
  maxAmountUsdc: number;
  minRepRequired: number;
  ratePct: number;
}

export interface PostOfferResponse {
  offerId: number;
}

// ─── Lending - Borrow ────────────────────────────────────────────────────────

export interface GetBorrowQuoteResponse {
  reputationScore: number;
  maxLoanUsdc: number;
  requestedAmountUsdc: number;
  collateralUsdc: number;
  interestUsdc: number;
  ratePct: number;
  totalOwedUsdc: number;
}

export interface RequestBorrowPayload {
  borrowerAgentId: string;
  requestedAmountUsdc: number;
}

export type RequestBorrowResponse =
  | { status: "pending_user_approval"; approvalId: number }
  | { status: "queued"; message: string }
  | {
      status: "funded";
      matchId: number;
      loanId: number;
      principalUsdc: number;
      interestUsdc: number;
      ratePct: number;
      collateralLockedUsdc: number;
      fundTxHash: string;
      requestTxHash: string;
    };

// ─── Lending - Repay ────────────────────────────────────────────────────────

export interface RepayPayload {
  matchId: number;
  borrowerAgentId: string;
  profitGeneratedUsdc: number;
}

// ─── Lending - Loans ────────────────────────────────────────────────────────

export interface Loan {
  loanId: number;
  borrower: string;
  lender: string;
  principalUsdc: number;
  collateralUsdc: number;
  interestUsdc: number;
  dueAt: string;
  repaidAt: string | null;
  status: string;
}

export interface GetAgentLoansResponse {
  loans: Loan[];
}

// ─── Lending - Agent Rep ─────────────────────────────────────────────────────

export interface AgentRep {
  score: number;
  lastActivityAt: number;
  totalLoans: number;
  cleanRepayments: number;
  defaults: number;
  collateralPctFor100Usdc?: number;
  maxLoanUsdc?: number;
}

// ─── Admin Transactions ──────────────────────────────────────────────────────

export interface LoanTransaction {
  event_id: number;
  agent_id: string;
  type: string;
  amount: number;
  counterparty_agent_id: string | null;
  tx_hash: string | null;
  rep_delta: number;
  timestamp: string;
  agent_ens: string;
  agent_role: string;
  counterparty_ens: string | null;
  match_id: number | null;
  principal_usdc: number | null;
  interest_usdc: number | null;
  collateral_usdc: number | null;
  rate_pct: number | null;
  match_status: string | null;
  loan_id_onchain: number | null;
  funded_at: string | null;
  repaid_at: string | null;
}

export interface TransactionAggregates {
  totalLoans: number;
  activeLoans: number;
  repaidLoans: number;
  defaultedLoans: number;
  totalPrincipal: number;
  totalInterest: number;
  totalCollateral: number;
  repaidPrincipal: number;
  repaidInterest: number;
}

export interface AdminTransactionsResponse {
  transactions: LoanTransaction[];
  aggregates: TransactionAggregates;
}
