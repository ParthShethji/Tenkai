import "dotenv/config";
import express from "express";
import lendingRoutes = require("./lending.routes");
import platformRoutes = require("./platform.routes");
import fileverseRoutes = require("./fileverse.routes");
import elsaRoutes = require("./elsa.routes");
import { startScheduler } from "./scheduler";
import { agentRuntimeManager } from "./runtime.manager";

const app = express();
const port = Number(process.env.PORT || 3000);
const configuredOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  ...configuredOrigins,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

app.use(express.json());
app.use((req, res, next) => {
  const requestOrigin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const allowOrigin = !requestOrigin || allowedOrigins.has(requestOrigin);

  if (allowOrigin) {
    res.header("Access-Control-Allow-Origin", requestOrigin || configuredOrigins[0] || "http://localhost:5173");
  }

  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.sendStatus(allowOrigin ? 204 : 403);
  }

  return next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "agentfi-lending-api" });
});

app.use("/lending", lendingRoutes);
app.use("/platform", platformRoutes);
app.use("/fileverse", fileverseRoutes);
app.use("/elsa", elsaRoutes);

app.listen(port, () => {
  console.log(`[api] AgentFi backend running on port ${port}`);
  startScheduler();
  void agentRuntimeManager.start();
});
