import * as lending from "../lending.service";
import * as blockchain from "../blockchain.service";
// @ts-ignore
import * as db from "../config/db";
// @ts-ignore
import * as redis from "../config/redis";
import * as agentKeys from "../config/agentKeys";

jest.mock("../config/db", () => {
  return {
    query: jest.fn(),
  };
});

jest.mock("../config/redis", () => {
  return {
    get: jest.fn(),
    setex: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };
});

jest.mock("../blockchain.service", () => ({
  ensureAgentRegistered: jest.fn(),
  verifyAgentEnsIntegrity: jest.fn(),
  checkAllowance: jest.fn(),
  checkBalance: jest.fn(),
  getAgentRep: jest.fn(),
  getMaxLoanSize: jest.fn(),
  getRequiredCollateral: jest.fn(),
  approveUsdc: jest.fn(),
  requestLoan: jest.fn(),
  fundLoan: jest.fn(),
  repayLoan: jest.fn(),
}));

jest.mock("../config/agentKeys", () => ({
  getAgentPrivateKey: jest.fn(),
  loadAgentPrivateKey: jest.fn(),
}));

describe("Lending Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (agentKeys.getAgentPrivateKey as jest.Mock).mockReturnValue(null);
    (agentKeys.loadAgentPrivateKey as jest.Mock).mockResolvedValue(null);
    (blockchain.getRequiredCollateral as jest.Mock).mockResolvedValue(0);
    (blockchain.checkAllowance as jest.Mock).mockResolvedValue(1000);
  });

  it("should calculate correct interest", () => {
    const { interestUsdc, ratePct } = (lending as any).calculateInterest(100, 25);
    expect(ratePct).toBe(2.0); // 3.5 - 25 * 0.06 = 2.0
    expect(interestUsdc).toBe(2); 
  });

  describe("Anti-sybil check", () => {
    it("should throw if userIds match", async () => {
      (db.query as jest.Mock).mockResolvedValueOnce({
        rows: [
          { agent_id: "agentA", user_id: "user1" },
          { agent_id: "agentB", user_id: "user1" }
        ]
      });

      await expect((lending as any).assertDifferentOwners("agentA", "agentB"))
        .rejects.toThrow(/SYBIL_BLOCK/);
    });

    it("should pass if userIds differ", async () => {
      (db.query as jest.Mock).mockResolvedValueOnce({
        rows: [
          { agent_id: "agentA", user_id: "user1" },
          { agent_id: "agentB", user_id: "user2" }
        ]
      });

      await expect((lending as any).assertDifferentOwners("agentA", "agentB"))
        .resolves.not.toThrow();
    });
  });

  describe("Volume Gate", () => {
    it("should require approval if volume > 500", async () => {
      (redis.get as jest.Mock).mockResolvedValueOnce("400"); // already borrowed 400
      const gate = await (lending as any).checkVolumeGate("agentA", 150); // total 550
      expect(gate.requiresApproval).toBe(true);
    });

    it("should not require approval if volume <= 500", async () => {
      (redis.get as jest.Mock).mockResolvedValueOnce("300");
      const gate = await (lending as any).checkVolumeGate("agentA", 200);
      expect(gate.requiresApproval).toBe(false);
    });
  });

  describe("Matching Logic", () => {
    it("should match requests when valid lenders exist", async () => {
      const dbMock = { rows: [] };
      (db.query as jest.Mock).mockImplementation((str: string) => {
        // Return valid lender
        if (str.includes("FROM lend_offers lo")) {
          return Promise.resolve({
            rows: [{
              offer_id: 1,
              lender_agent_id: "agentL1",
              lender_wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
              lender_ens: "lw.eth",
              user_id: "user1"
            }]
          });
        }
        // Assert different owners mock
        if (str.includes("FROM agents") && (str.includes("agent_id = ANY") || str.includes("agent_id = $1 OR agent_id = $2"))) {
          return Promise.resolve({
            rows: [{ agent_id: "agentB", user_id: "user2" }, { agent_id: "agentL1", user_id: "user1" }] // Diff owners
          });
        }
        // Insert Match record
        if (str.includes("INSERT INTO matches")) {
          return Promise.resolve({ rows: [{ match_id: 999 }] });
        }
        return Promise.resolve(dbMock);
      });

      (blockchain.requestLoan as jest.Mock).mockResolvedValueOnce({ loanId: 42, collateralLocked: 0, txHash: "0xR" });
      (blockchain.fundLoan as jest.Mock).mockResolvedValueOnce({ txHash: "0xF" });

      (redis.get as jest.Mock).mockResolvedValueOnce(null);

      // Call inner method or full request flow.
      (db.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          role: "borrower",
          status: "active",
          wallet_address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
          agent_id: "agentB"
        }]
      });
      (blockchain.getAgentRep as jest.Mock).mockResolvedValueOnce({ score: 35 });
      (blockchain.getMaxLoanSize as jest.Mock).mockResolvedValueOnce(1000);

      const result = await (lending as any).requestBorrow({ borrowerAgentId: "agentB", requestedAmountUsdc: 250 });
      
      expect(result.status).toBe("funded");
      expect(result.matchId).toBe(999);
      expect(result.loanId).toBe(42);
      expect(blockchain.requestLoan).toHaveBeenCalled();
      expect(blockchain.fundLoan).toHaveBeenCalledWith(42);
    });

    it("should auto-approve borrower collateral before requesting a loan", async () => {
      (db.query as jest.Mock).mockImplementation((str: string) => {
        if (str.includes("FROM agents WHERE agent_id = $1")) {
          return Promise.resolve({
            rows: [{
              role: "borrower",
              status: "active",
              wallet_address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
              ens_name: "borrower.eth",
              agent_id: "agentB"
            }]
          });
        }
        if (str.includes("FROM lend_offers lo")) {
          return Promise.resolve({
            rows: [{
              offer_id: 1,
              lender_agent_id: "agentL1",
              lender_wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
              lender_ens: "lender.eth",
            }]
          });
        }
        if (str.includes("agent_id = $1 OR agent_id = $2")) {
          return Promise.resolve({
            rows: [
              { agent_id: "agentB", user_id: "user2" },
              { agent_id: "agentL1", user_id: "user1" }
            ]
          });
        }
        if (str.includes("INSERT INTO matches")) {
          return Promise.resolve({ rows: [{ match_id: 999 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      (redis.get as jest.Mock).mockResolvedValueOnce(null);
      (blockchain.getAgentRep as jest.Mock).mockResolvedValueOnce({ score: 25 });
      (blockchain.getMaxLoanSize as jest.Mock).mockResolvedValueOnce(1000);
      (blockchain.getRequiredCollateral as jest.Mock).mockResolvedValueOnce(143);
      (blockchain.checkAllowance as jest.Mock).mockResolvedValueOnce(0);
      (agentKeys.loadAgentPrivateKey as jest.Mock).mockResolvedValueOnce("0xborrowerkey");
      (blockchain.requestLoan as jest.Mock).mockResolvedValueOnce({ loanId: 42, collateralLocked: 143, txHash: "0xR" });
      (blockchain.fundLoan as jest.Mock).mockResolvedValueOnce({ txHash: "0xF" });

      const result = await (lending as any).requestBorrow({ borrowerAgentId: "agentB", requestedAmountUsdc: 250 });

      expect(result.status).toBe("funded");
      expect(blockchain.approveUsdc).toHaveBeenCalledWith("0xborrowerkey", 143);
      expect(blockchain.requestLoan).toHaveBeenCalled();
    });
  });

  describe("Repayment Logic", () => {
    it("should log repayment amount as a numeric total instead of concatenating strings", async () => {
      (db.query as jest.Mock).mockImplementation((str: string) => {
        if (str.includes("FROM matches m") && str.includes("m.match_id = $1")) {
          return Promise.resolve({
            rows: [{
              loan_id_onchain: 42,
              borrower_wallet: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
              amount_usdc: "500.000000",
              interest_usdc: "10.000000",
              borrower_rep_at_origination: 25,
              lender_agent_id: "agentL1",
            }]
          });
        }
        if (str.includes("UPDATE agents SET reputation_score")) {
          return Promise.resolve({ rows: [] });
        }
        if (str.includes("SELECT agent_id FROM agents WHERE wallet_address")) {
          return Promise.resolve({ rows: [{ agent_id: "agentB" }] });
        }
        return Promise.resolve({ rows: [] });
      });

      (blockchain.repayLoan as jest.Mock).mockResolvedValueOnce({ txHash: "0xRepay" });
      (blockchain.getAgentRep as jest.Mock).mockResolvedValueOnce({ score: 30 });
      (redis.get as jest.Mock).mockResolvedValueOnce("{}").mockResolvedValueOnce("{}");

      const result = await (lending as any).repayLoan({
        matchId: 1,
        borrowerAgentId: "agentB",
        profitGeneratedUsdc: 5,
      });

      const eventInsertCall = (db.query as jest.Mock).mock.calls.find(([sql]) =>
        String(sql).includes("INSERT INTO event_log")
      );

      expect(result.status).toBe("repaid");
      expect(eventInsertCall?.[1]?.[2]).toBe(510);
    });
  });
});
