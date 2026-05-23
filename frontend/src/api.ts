import type {
  CreateUserPayload,
  CreateUserResponse,
  CreateAgentPayload,
  CreateAgentResponse,
  SessionResponse,
  UserAgent,
  FundAgentPayload,
  AgentRuntimeResponse,
  AdminOverviewResponse,
  GetOffersResponse,
  PostOfferPayload,
  PostOfferResponse,
  GetBorrowQuoteResponse,
  RequestBorrowPayload,
  RequestBorrowResponse,
  RepayPayload,
  Loan,
  GetAgentLoansResponse,
  AgentRep,
  AdminTransactionsResponse,
} from "./types/api";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiClient = {
  createUser(payload: CreateUserPayload): Promise<CreateUserResponse>;
  getSession(walletAddress: string): Promise<SessionResponse>;
  createAgent(payload: CreateAgentPayload): Promise<CreateAgentResponse>;
  updateAgentStrategy(agentId: string, strategy: Record<string, unknown>): Promise<unknown>;
  getUserAgents(userId: string): Promise<{ agents: UserAgent[] }>;
  getAgentRuntime(agentId: string): Promise<AgentRuntimeResponse>;
  runAgent(agentId: string): Promise<{ agentId: string; triggered: boolean; message?: string }>;
  updateAgentStatus(agentId: string, runtimeStatus: "active" | "paused" | "stopped"): Promise<{ agentId: string; runtimeStatus: string }>;
  fundAgent(agentId: string, payload: FundAgentPayload): Promise<{ agentId: string; funded: boolean }>;
  getAdminOverview(userId?: string): Promise<AdminOverviewResponse>;
  getTools(): Promise<{ tools: Array<Record<string, unknown>> }>;
  getOffers(minRep: number, maxAmount: number): Promise<GetOffersResponse>;
  postOffer(payload: PostOfferPayload): Promise<PostOfferResponse>;
  deleteOffer(offerId: number, lenderAgentId: string): Promise<{ message: string }>;
  getBorrowQuote(borrowerAgentId: string, amountUsdc: number): Promise<GetBorrowQuoteResponse>;
  requestBorrow(payload: RequestBorrowPayload): Promise<RequestBorrowResponse>;
  approveBorrow(approvalId: number): Promise<RequestBorrowResponse>;
  repay(payload: RepayPayload): Promise<unknown>;
  getLoan(loanId: number): Promise<Loan>;
  getAgentLoans(agentId: string, role?: "lender" | "borrower"): Promise<GetAgentLoansResponse>;
  getAgentRep(agentId: string): Promise<AgentRep>;
  getAdminTransactions(limit?: number, offset?: number, type?: string): Promise<AdminTransactionsResponse>;
};

function buildHeaders(token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

async function callApi<T>(
  baseUrl: string,
  token: string,
  method: HttpMethod,
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: buildHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (payload as { error?: string }).error || "Request failed";
    throw new Error(message);
  }
  return payload as T;
}

export function createApiClient(baseUrl: string, token: string): ApiClient {
  return {
    createUser(payload) {
      return callApi<CreateUserResponse>(baseUrl, token, "POST", "/platform/users", payload);
    },
    getSession(walletAddress) {
      return callApi<SessionResponse>(
        baseUrl,
        token,
        "GET",
        `/platform/session?walletAddress=${encodeURIComponent(walletAddress)}`
      );
    },
    createAgent(payload) {
      return callApi<CreateAgentResponse>(baseUrl, token, "POST", "/platform/agents", payload);
    },
    updateAgentStrategy(agentId, strategy) {
      return callApi(baseUrl, token, "PUT", `/platform/agents/${encodeURIComponent(agentId)}/strategy`, strategy);
    },
    getUserAgents(userId) {
      return callApi<{ agents: UserAgent[] }>(baseUrl, token, "GET", `/platform/users/${encodeURIComponent(userId)}/agents`);
    },
    getAgentRuntime(agentId) {
      return callApi<AgentRuntimeResponse>(baseUrl, token, "GET", `/platform/agents/${encodeURIComponent(agentId)}/runtime`);
    },
    runAgent(agentId) {
      return callApi<{ agentId: string; triggered: boolean; message?: string }>(baseUrl, token, "POST", `/platform/agents/${encodeURIComponent(agentId)}/run`);
    },
    updateAgentStatus(agentId, runtimeStatus) {
      return callApi<{ agentId: string; runtimeStatus: string }>(
        baseUrl,
        token,
        "PATCH",
        `/platform/agents/${encodeURIComponent(agentId)}/status`,
        { runtimeStatus }
      );
    },
    fundAgent(agentId, payload) {
      return callApi<{ agentId: string; funded: boolean }>(
        baseUrl,
        token,
        "POST",
        `/platform/agents/${encodeURIComponent(agentId)}/fund`,
        payload
      );
    },
    getAdminOverview(userId?: string) {
      const url = userId ? `/platform/admin/overview?userId=${encodeURIComponent(userId)}` : "/platform/admin/overview";
      return callApi<AdminOverviewResponse>(baseUrl, token, "GET", url);
    },
    getTools() {
      return callApi<{ tools: Array<Record<string, unknown>> }>(baseUrl, token, "GET", "/platform/tools");
    },
    getOffers(minRep, maxAmount) {
      return callApi<GetOffersResponse>(baseUrl, token, "GET", `/lending/offers?minRep=${minRep}&maxAmount=${maxAmount}`);
    },
    postOffer(payload) {
      return callApi<PostOfferResponse>(baseUrl, token, "POST", "/lending/offers", payload);
    },
    deleteOffer(offerId, lenderAgentId) {
      return callApi<{ message: string }>(baseUrl, token, "DELETE", `/lending/offers/${offerId}`, { lenderAgentId });
    },
    getBorrowQuote(borrowerAgentId, amountUsdc) {
      return callApi<GetBorrowQuoteResponse>(
        baseUrl,
        token,
        "GET",
        `/lending/borrow/quote?borrowerAgentId=${encodeURIComponent(borrowerAgentId)}&amountUsdc=${amountUsdc}`
      );
    },
    requestBorrow(payload) {
      return callApi<RequestBorrowResponse>(baseUrl, token, "POST", "/lending/borrow", payload);
    },
    approveBorrow(approvalId) {
      return callApi<RequestBorrowResponse>(baseUrl, token, "POST", `/lending/borrow/approve/${approvalId}`);
    },
    repay(payload) {
      return callApi(baseUrl, token, "POST", "/lending/repay", payload);
    },
    getLoan(loanId) {
      return callApi<Loan>(baseUrl, token, "GET", `/lending/loans/${loanId}`);
    },
    getAgentLoans(agentId, role = "borrower") {
      return callApi<GetAgentLoansResponse>(
        baseUrl,
        token,
        "GET",
        `/lending/agents/${encodeURIComponent(agentId)}/loans?role=${role}`
      );
    },
    getAgentRep(agentId) {
      return callApi<AgentRep>(baseUrl, token, "GET", `/lending/agents/${encodeURIComponent(agentId)}/rep`);
    },
    getAdminTransactions(limit = 100, offset = 0, type = "") {
      const params = `limit=${limit}&offset=${offset}${type ? `&type=${encodeURIComponent(type)}` : ""}`;
      return callApi<AdminTransactionsResponse>(baseUrl, token, "GET", `/platform/admin/transactions?${params}`);
    },
  };
}

/** Public (no auth): resolve ENS name to address. Used by onboarding before user exists. */
export async function resolveEns(
  baseUrl: string,
  ensName: string
): Promise<{ address: string | null }> {
  const url = `${baseUrl.replace(/\/$/, "")}/platform/ens/resolve?name=${encodeURIComponent(ensName)}`;
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (payload as { error?: string }).error || "ENS resolution failed";
    throw new Error(message);
  }
  return payload as { address: string | null };
}

/** Public (no auth): compute ENS node hashes for a subdomain — saves adding ethers to the browser. */
export async function ensNodes(
  baseUrl: string,
  parent: string,
  label: string
): Promise<{ parentNode: string; labelHash: string; subdomainNode: string }> {
  const url = `${baseUrl.replace(/\/$/, "")}/platform/ens/nodes?parent=${encodeURIComponent(parent)}&label=${encodeURIComponent(label)}`;
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (payload as { error?: string }).error || "ENS node computation failed";
    throw new Error(message);
  }
  return payload as { parentNode: string; labelHash: string; subdomainNode: string };
}
