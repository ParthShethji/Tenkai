/**
 * lending.routes.ts
 *
 * All HTTP endpoints for the lending / borrowing lifecycle.
 */

import { Router, Request, Response } from "express";
import * as lending from "./lending.service";
import * as blockchain from "./blockchain.service";
// @ts-ignore
import { requireAuth } from "./middleware/auth";
// @ts-ignore
import { validate } from "./middleware/validate";
import Joi from "joi";

const router = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const postOfferSchema = Joi.object({
  lenderAgentId:  Joi.string().uuid().required(),
  maxAmountUsdc:  Joi.number().min(10).max(1000).required(),
  minRepRequired: Joi.number().integer().min(0).max(50).required(),
  ratePct:        Joi.number().min(0.5).max(10).required(),
});

const borrowSchema = Joi.object({
  borrowerAgentId:    Joi.string().uuid().required(),
  requestedAmountUsdc: Joi.number().min(10).max(1000).required(),
});

const repaySchema = Joi.object({
  matchId:             Joi.number().integer().required(),
  borrowerAgentId:     Joi.string().uuid().required(),
  profitGeneratedUsdc: Joi.number().min(0).default(0),
});

// ─── Lender endpoints ─────────────────────────────────────────────────────────

router.post("/offers", requireAuth, validate(postOfferSchema), async (req: Request, res: Response) => {
  const { lenderAgentId, maxAmountUsdc, minRepRequired, ratePct } = req.body;
  try {
    const offerId = await lending.postLendOffer({
      lenderAgentId,
      maxAmountUsdc,
      minRepRequired,
      ratePct,
    });
    res.json({ offerId });
  } catch (err: any) {
    const status = err.message.startsWith("ENS_MISMATCH") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.delete("/offers/:offerId", requireAuth, async (req: Request, res: Response) => {
  const { offerId } = req.params;
  const { lenderAgentId } = req.body;
  try {
    await lending.cancelLendOffer(parseInt(offerId as string), lenderAgentId);
    res.json({ message: "Offer cancelled. Reputation penalty applied." });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/offers", requireAuth, async (req: Request, res: Response) => {
  const { minRep = 0, maxAmount = 1000 } = req.query;
  try {
    // @ts-ignore
    const db = require("./config/db");
    const { rows } = await db.query(
      `SELECT lo.offer_id, lo.lender_agent_id, a.ens_name,
              lo.max_amount_usdc, lo.min_rep_required, lo.rate_pct, lo.created_at
       FROM lend_offers lo
       JOIN agents a ON lo.lender_agent_id = a.agent_id
       WHERE lo.status = 'open'
         AND lo.min_rep_required >= $1
         AND lo.max_amount_usdc <= $2
       ORDER BY lo.rate_pct ASC`,
      [parseInt(minRep as string), parseFloat(maxAmount as string)]
    );
    res.json({ offers: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Borrower endpoints ───────────────────────────────────────────────────────

router.post("/borrow", requireAuth, validate(borrowSchema), async (req: Request, res: Response) => {
  const { borrowerAgentId, requestedAmountUsdc } = req.body;
  try {
    const result = await lending.requestBorrow({ borrowerAgentId, requestedAmountUsdc });
    res.json(result);
  } catch (err: any) {
    let status = 400;
    if (err.message.startsWith("SYBIL_BLOCK") || err.message.startsWith("ENS_MISMATCH")) status = 403;
    res.status(status).json({ error: err.message });
  }
});

router.post("/borrow/approve/:approvalId", requireAuth, async (req: Request | any, res: Response) => {
  const { approvalId } = req.params;
  const { userId } = req.user;
  try {
    const result = await lending.approvePendingBorrow(parseInt(approvalId as string), userId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/borrow/quote", requireAuth, async (req: Request, res: Response) => {
  const { borrowerAgentId, amountUsdc } = req.query;
  if (!borrowerAgentId || !amountUsdc) {
    return res.status(400).json({ error: "borrowerAgentId and amountUsdc required" });
  }

  try {
    // @ts-ignore
    const db = require("./config/db");
    const { rows } = await db.query(
      "SELECT wallet_address FROM agents WHERE agent_id = $1",
      [borrowerAgentId]
    );
    if (!rows.length) return res.status(404).json({ error: "Agent not found" });

    const walletAddress = rows[0].wallet_address;
    const [repData, collateral, maxLoan] = await Promise.all([
      blockchain.getAgentRep(walletAddress),
      blockchain.getRequiredCollateral(walletAddress, parseFloat(amountUsdc as string)),
      blockchain.getMaxLoanSize(walletAddress),
    ]);

    const { interestUsdc, ratePct } = lending.calculateInterest(
      parseFloat(amountUsdc as string),
      repData.score
    );

    res.json({
      reputationScore: repData.score,
      maxLoanUsdc: maxLoan,
      requestedAmountUsdc: parseFloat(amountUsdc as string),
      collateralUsdc: collateral,
      interestUsdc,
      ratePct,
      totalOwedUsdc: parseFloat(amountUsdc as string) + interestUsdc,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Repayment endpoints ──────────────────────────────────────────────────────

router.post("/repay", requireAuth, validate(repaySchema), async (req: Request, res: Response) => {
  const { matchId, borrowerAgentId, profitGeneratedUsdc } = req.body;
  try {
    const result = await lending.repayLoan({
      matchId,
      borrowerAgentId,
      profitGeneratedUsdc,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Loan status / history ────────────────────────────────────────────────────

router.get("/loans/:loanId", requireAuth, async (req: Request, res: Response) => {
  try {
    const loan = await blockchain.getLoan(parseInt(req.params.loanId as string));
    res.json(loan);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

router.get("/agents/:agentId/loans", requireAuth, async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const { role = "borrower" } = req.query;

  try {
    // @ts-ignore
    const db = require("./config/db");
    const { rows } = await db.query(
      "SELECT wallet_address FROM agents WHERE agent_id = $1",
      [agentId]
    );
    if (!rows.length) return res.status(404).json({ error: "Agent not found" });

    const wallet = rows[0].wallet_address;
    const loanIds = role === "lender"
      ? await blockchain.getLenderLoanIds(wallet)
      : await blockchain.getBorrowerLoanIds(wallet);

    const loans = await Promise.all(loanIds.map(id => blockchain.getLoan(id)));
    res.json({ loans });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/agents/:agentId/rep", requireAuth, async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const db = require("./config/db");
    const { rows } = await db.query(
      "SELECT wallet_address FROM agents WHERE agent_id = $1",
      [req.params.agentId]
    );
    if (!rows.length) return res.status(404).json({ error: "Agent not found" });

    const rep = await blockchain.getAgentRep(rows[0].wallet_address);
    const collateral = await blockchain.getRequiredCollateral(rows[0].wallet_address, 100);
    const maxLoan = await blockchain.getMaxLoanSize(rows[0].wallet_address);

    res.json({
      ...rep,
      collateralPctFor100Usdc: collateral,
      maxLoanUsdc: maxLoan,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export = router;
