import axios from "axios";
import { ethers } from "ethers";

jest.mock("axios");
jest.mock("ethers", () => {
  const actualEthers = jest.requireActual("ethers");
  return {
    ...actualEthers,
    JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
    Wallet: jest.fn().mockImplementation(() => ({ address: "0xAgent" })),
    Contract: jest.fn().mockImplementation(() => ({
      approve: jest.fn().mockResolvedValue({
        wait: jest.fn().mockResolvedValue(true)
      })
    }))
  };
});

jest.mock("../blockchain.service", () => ({
  onLoanFunded: jest.fn(),
  onLoanRepaid: jest.fn(),
  getLoan: jest.fn()
}));

const blockchain = require("../blockchain.service");

describe("Agent Process", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.AGENT_ID = "agent-1";
    process.env.AGENT_KEY = "0xAgentKey";
    process.env.AGENT_WALLET = "0xAgentWallet";
    process.env.FILEVERSE_DOC_ID = "doc123";
    
    (axios.create as jest.Mock).mockReturnValue(axios); // Return the mocked axios instance
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it("Lender role should boot, load strategy, and post offer", async () => {
    process.env.AGENT_ROLE = "lender";
    
    // Mock strategy doc fetch
    (axios.get as jest.Mock).mockResolvedValueOnce({ 
      data: { maxLoanAmount: 500, minReputation: 35, interestRate: 2.0 } 
    });
    // Mock post offer
    (axios.post as jest.Mock).mockResolvedValueOnce({ data: { offerId: 10 } });

    // Since agent.js executes on require, we require it here inside the test block
    // after setting up our mocks. We catch any exceptions thrown by process.exit (which shouldn't happen).
    const mainSpy = jest.spyOn(console, 'log').mockImplementation();
    
    jest.isolateModules(() => {
      require("../agent");
    });
    
    // Allow promises to resolve
    await new Promise(process.nextTick);

    expect(axios.get).toHaveBeenCalledWith("/fileverse/docs/doc123");
    expect(axios.post).toHaveBeenCalledWith("/lending/offers", expect.objectContaining({
      lenderAgentId: "agent-1",
      maxAmountUsdc: 500,
      minRepRequired: 35,
      ratePct: 2.0
    }));

    mainSpy.mockRestore();
  });

  it("Borrower role should get a quote, request borrow, hold, unwind, and repay", async () => {
    process.env.AGENT_ROLE = "borrower";
    const principal = 500;
    const interest = 10;
    
    (axios.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith("/fileverse/docs/")) {
        return Promise.resolve({
          data: { maxLoanAmount: principal, repayAfterSeconds: 0, tradeAllocation: { ETH: 60, stablecoin: 40 } }
        });
      }

      if (url.startsWith("/lending/borrow/quote")) {
        return Promise.resolve({
          data: { collateralUsdc: 20, interestUsdc: interest }
        });
      }

      return Promise.resolve({ data: {} });
    });

    const exitObj = { exitValueUsdc: principal + interest + 50 };
    (axios.post as jest.Mock).mockImplementation((url: string) => {
      if (url === "/lending/borrow") {
        return Promise.resolve({
          data: { status: "funded", matchId: 101, principalUsdc: principal, interestUsdc: interest, fundTxHash: "0xFundTx" }
        });
      }

      if (url === "/elsa/portfolio/construct") {
        return Promise.resolve({ data: { portfolioId: "port_123" } });
      }

      if (url === "/elsa/portfolio/exit") {
        return Promise.resolve({ data: exitObj });
      }

      if (url === "/lending/repay") {
        return Promise.resolve({
          data: { status: "repaid", txHash: "0xRepay", newReputationScore: 36, repDelta: 2 }
        });
      }

      return Promise.resolve({ data: {} });
    });

    const mainSpy = jest.spyOn(console, 'log').mockImplementation();
    
    jest.isolateModules(() => {
      require("../agent");
    });
    
    // Let all the promises chain settle
    await new Promise(r => setTimeout(r, 100));

    // Verify it called construct with the correct initial allocation and capital
    expect(axios.post).toHaveBeenCalledWith("/elsa/portfolio/construct", expect.objectContaining({
      action: "construct",
      totalUsdc: principal,
      allocation: { ETH: 60, stablecoin: 40 }
    }));

    // Verify it repaid with proper profit calculated
    expect(axios.post).toHaveBeenCalledWith("/lending/repay", expect.objectContaining({
      profitGeneratedUsdc: 50 // Received - Owed(Principal + Interest)
    }));

    mainSpy.mockRestore();
  });
});
