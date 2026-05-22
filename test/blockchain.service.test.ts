const mockProvider = {
  getTransactionReceipt: jest.fn().mockResolvedValue({
    logs: [{ topics: ["0xTopic"] }]
  })
};

const mockContractInstance = {
  interface: {
    getEvent: jest.fn().mockReturnValue({ topicHash: "0xTopic" }),
    parseLog: jest.fn().mockReturnValue({ args: { loanId: "1" } }),
  },
  connect: jest.fn().mockReturnValue({
    repayLoan: jest.fn().mockResolvedValue({
      hash: "0xHashRepay",
      wait: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, gasUsed: 50000n }),
    }),
  }),
  getAgentRep: jest.fn().mockResolvedValue({ score: 25n, lastActivityAt: 0n, totalLoans: 0n, cleanRepayments: 0n, defaults: 0n }),
  maxLoanSize: jest.fn().mockResolvedValue(500000000n), // 500 * 10^6
  requiredCollateral: jest.fn().mockResolvedValue(28600000n), // 28.6 * 10^6
  allowance: jest.fn().mockResolvedValue(1000000000n), // 1000 * 10^6
  balanceOf: jest.fn().mockResolvedValue(1000000000n),
  requestLoan: jest.fn().mockResolvedValue({
    hash: "0xHashReq",
    wait: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, gasUsed: 50000n }),
  }),
  fundLoan: jest.fn().mockResolvedValue({
    hash: "0xHashFund",
    wait: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, gasUsed: 50000n }),
  }),
  getLoan: jest.fn().mockResolvedValue({
    loanId: 1n, borrower: "0xB", lender: "0xL", principal: 100000000n, collateral: 28600000n, interestAmount: 2000000n, dueAt: 0n, repaidAt: 0n, status: 2n
  })
};

jest.mock("ethers", () => {
  const actualEthers = jest.requireActual("ethers");
  return {
    ...actualEthers,
    JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
    Wallet: jest.fn().mockImplementation(() => ({
      address: "0x123",
      connect: jest.fn().mockReturnValue({})
    })),
    Contract: jest.fn().mockImplementation(() => mockContractInstance),
  };
});

const blockchain = require("../blockchain.service");

describe("Blockchain Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USDC_ADDRESS = "0xUSDC";
    process.env.CONTRACT_ADDRESS = "0xContract";
    process.env.PLATFORM_PRIVATE_KEY = "0xFakeKey";
  });

  it("should get agent rep", async () => {
    const rep = await blockchain.getAgentRep("0xWallet");
    expect(rep.score).toBe(25);
  });

  it("should request loan successfully", async () => {
    const res = await blockchain.requestLoan({
      borrowerWallet: "0xB",
      lenderWallet: "0xL",
      principalUsdc: 100,
      interestUsdc: 2,
      borrowerEns: "bob.eth",
      lenderEns: "alice.eth"
    });

    expect(res.loanId).toBe(1);
    expect(res.txHash).toBe("0xHashReq");
    expect(res.collateralLocked).toBe(28.6);
  });

  it("should fail to request loan if allowance insufficient", async () => {
    mockContractInstance.allowance.mockResolvedValueOnce(0n); // borrower allowance is 0

    await expect(blockchain.requestLoan({
      borrowerWallet: "0xB", lenderWallet: "0xL", principalUsdc: 100, interestUsdc: 2, borrowerEns: "e1", lenderEns: "e2"
    })).rejects.toThrow("Borrower collateral allowance insufficient.");
  });
});
