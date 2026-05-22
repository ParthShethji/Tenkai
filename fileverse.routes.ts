import { Router } from "express";
import { getStrategyDoc, putStrategyDoc } from "./utils/strategyStore";

const router = Router();

router.get("/docs/:docId", (req, res) => {
  const doc = getStrategyDoc(req.params.docId);
  if (!doc) {
    return res.status(404).json({ error: "doc not found" });
  }
  return res.json(doc);
});

router.put("/docs/:docId", (req, res) => {
  putStrategyDoc(req.params.docId, req.body || {});
  return res.json({ docId: req.params.docId, updated: true });
});

export = router;
