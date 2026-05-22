import { Router } from "express";
import { randomUUID } from "crypto";

const router = Router();

const openPortfolios = new Map<string, { totalUsdc: number }>();

router.post("/portfolio/construct", (req, res) => {
  const { totalUsdc } = req.body || {};
  const portfolioId = `port_${randomUUID()}`;
  openPortfolios.set(portfolioId, { totalUsdc: Number(totalUsdc || 0) });
  return res.json({ portfolioId, status: "constructed" });
});

router.post("/portfolio/exit", (req, res) => {
  const { portfolioId } = req.body || {};
  const portfolio = openPortfolios.get(portfolioId);
  if (!portfolio) {
    return res.status(404).json({ error: "portfolio not found" });
  }

  // Placeholder deterministic-ish PnL for hackathon demo.
  const multiplier = 1.04;
  const exitValueUsdc = Math.round(portfolio.totalUsdc * multiplier * 1e6) / 1e6;
  openPortfolios.delete(portfolioId);
  return res.json({ portfolioId, exitValueUsdc });
});

export = router;
