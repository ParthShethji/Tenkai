import request from "supertest";
import express from "express";
import * as lendingRoutes from "../lending.routes";
import * as lendingService from "../lending.service";
import * as blockchainService from "../blockchain.service";

// Mock auth middleware to let tests pass through
jest.mock("../middleware/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = { userId: "user-123" };
    next();
  }
}));

// Mock validate middleware (joi is handled there)
jest.mock("../middleware/validate", () => ({
  validate: (schema: any) => (req: any, res: any, next: any) => {
    const { error } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    next();
  }
}));

jest.mock("../lending.service", () => ({
  postLendOffer: jest.fn(),
  requestBorrow: jest.fn(),
  calculateInterest: jest.fn(),
}));

jest.mock("../blockchain.service", () => ({
  getAgentRep: jest.fn(),
  getRequiredCollateral: jest.fn(),
  getMaxLoanSize: jest.fn(),
}));

jest.mock("../config/db", () => {
    return {
      query: jest.fn().mockResolvedValue({rows: [{wallet_address: "0x123"}]})
    };
});

const app = express();
app.use(express.json());
// Since the route exports an express router natively
const lendingRouter = (lendingRoutes as any).default || (lendingRoutes as any);
app.use("/lending", lendingRouter);

describe("Lending Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("POST /lending/offers should post a valid offer", async () => {
    (lendingService.postLendOffer as jest.Mock).mockResolvedValueOnce(12);

    const res = await request(app)
      .post("/lending/offers")
      .send({
        lenderAgentId: "d290f1ee-6c54-4b01-90e6-d701748f0851", // UUID
        maxAmountUsdc: 500,
        minRepRequired: 30,
        ratePct: 2.5
      });

    expect(res.status).toBe(200);
    expect(res.body.offerId).toBe(12);
  });

  it("POST /lending/offers should 400 on invalid input", async () => {
    const res = await request(app)
      .post("/lending/offers")
      .send({
        lenderAgentId: "not-uuid", // Fails Joi validation
        maxAmountUsdc: 5000,       // Max is 1000
        minRepRequired: 30,
        ratePct: 2.5
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("must be a valid GUID");
  });

  it("POST /lending/borrow should return match status", async () => {
    (lendingService.requestBorrow as jest.Mock).mockResolvedValueOnce({
      status: "funded",
      matchId: 1,
      principalUsdc: 100
    });

    const res = await request(app)
      .post("/lending/borrow")
      .send({
        borrowerAgentId: "d290f1ee-6c54-4b01-90e6-d701748f0851",
        requestedAmountUsdc: 100
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("funded");
  });

  it("GET /lending/borrow/quote should return quote structure from DB and BC details", async () => {
    (blockchainService.getAgentRep as jest.Mock).mockResolvedValueOnce({ score: 25 });
    (blockchainService.getRequiredCollateral as jest.Mock).mockResolvedValueOnce(28.6);
    (blockchainService.getMaxLoanSize as jest.Mock).mockResolvedValueOnce(500);
    (lendingService.calculateInterest as jest.Mock).mockReturnValueOnce({ interestUsdc: 2, ratePct: 2.0 });

    const res = await request(app).get("/lending/borrow/quote?borrowerAgentId=d290f1ee-6c54-4b01-90e6-d701748f0851&amountUsdc=100");
    
    expect(res.status).toBe(200);
    expect(res.body.reputationScore).toBe(25);
    expect(res.body.interestUsdc).toBe(2);
    expect(res.body.totalOwedUsdc).toBe(102);
  });
});
