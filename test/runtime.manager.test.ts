import { agentRuntimeManager } from "../runtime.manager";
import * as db from "../config/db";
import * as blockchain from "../blockchain.service";
import * as lending from "../lending.service";

jest.mock("../config/db", () => ({
  query: jest.fn(),
}));

jest.mock("../blockchain.service", () => ({
  getWalletFundingSnapshot: jest.fn(),
  getAgentRep: jest.fn(),
  getRequiredCollateral: jest.fn(),
  getMaxLoanSize: jest.fn(),
}));

jest.mock("../lending.service", () => ({
  calculateInterest: jest.fn(),
  requestBorrow: jest.fn(),
  repayLoan: jest.fn(),
}));

jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe("Agent runtime manager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    (blockchain.getAgentRep as jest.Mock).mockResolvedValue({ score: 30 });
    (blockchain.getRequiredCollateral as jest.Mock).mockResolvedValue(10);
    (blockchain.getMaxLoanSize as jest.Mock).mockResolvedValue(1000);
    (lending.calculateInterest as jest.Mock).mockReturnValue({ interestUsdc: 2, ratePct: 1.7 });
    (lending.requestBorrow as jest.Mock).mockRejectedValue(new Error("simulated borrower failure"));

    (db.query as jest.Mock).mockImplementation(async (text: string) => {
      if (text.includes("FROM agents a") && text.includes("JOIN agent_configs c")) {
        return {
          rows: [{
            agent_id: "agent-1",
            user_id: "user-1",
            ens_name: "borrower.one.eth",
            wallet_address: "0xabc",
            fileverse_doc_id: null,
            role: "borrower",
            status: "active",
            reputation_score: 25,
            agent_type: "borrower",
            strategy_prompt: "prompt",
            strategy_json: JSON.stringify({ maxLoanAmount: 250, minReputation: 0 }),
            execution_interval_seconds: 60,
            enabled_tools: JSON.stringify(["fetch_open_offers", "get_borrow_quote", "request_borrow"]),
            risk_tolerance: "balanced",
            profit_target_pct: 4,
            runtime_status: "active",
            last_execution_at: null,
            next_execution_at: null,
            last_result_summary: null,
            total_cycles: 0,
            total_profit_usdc: 0,
            total_borrowed_usdc: 0,
            total_lent_usdc: 0,
            current_positions_json: "{}",
          }],
        };
      }

      if (text.includes("INSERT INTO agent_execution_logs")) {
        return { rows: [] };
      }

      if (text.includes("FROM lend_offers lo")) {
        return {
          rows: [{
            offer_id: 1,
            lender_agent_id: "lender-1",
            max_amount_usdc: 500,
            min_rep_required: 0,
            rate_pct: 1.2,
            created_at: new Date().toISOString(),
            ens_name: "lender.one.eth",
            reputation_score: 35,
          }],
        };
      }

      if (text.includes("SELECT wallet_address FROM agents WHERE agent_id = $1")) {
        return { rows: [{ wallet_address: "0xabc" }] };
      }

      if (text.startsWith("UPDATE agent_configs SET")) {
        return { rows: [] };
      }

      return { rows: [] };
    });
  });

  afterEach(() => {
    const timers: Map<string, ReturnType<typeof setTimeout>> = (agentRuntimeManager as any).timers;
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("increments total cycles and records failure details when a cycle throws", async () => {
    await agentRuntimeManager.runAgentNow("agent-1", "test");

    const updateCalls = (db.query as jest.Mock).mock.calls.filter(([text]) =>
      String(text).startsWith("UPDATE agent_configs SET")
    );

    const failureUpdate = updateCalls.find(([, params]) =>
      Array.isArray(params) &&
      params[0] === "agent-1" &&
      params.some((value: unknown) => String(value).includes("Cycle failed: simulated borrower failure"))
    );

    expect(failureUpdate).toBeDefined();
    expect(failureUpdate?.[1]).toEqual(
      expect.arrayContaining([
        "agent-1",
        expect.any(Date),
        "Cycle failed: simulated borrower failure",
        1,
      ])
    );
  });
});
