/**
 * scheduler.ts
 *
 * Cron jobs that run on the backend server process.
 */

// @ts-ignore
import cron from "node-cron";
import * as lending from "./lending.service";

// @ts-ignore
const logger = process.env.NODE_ENV === "test" ? console : require("./utils/logger");

export function startScheduler() {
  cron.schedule("*/15 * * * *", async () => {
    logger.info("[scheduler] running liquidation sweep");
    try {
      await lending.runLiquidationSweep();
    } catch (err: any) {
      logger.error(`[scheduler] liquidation sweep error: ${err.message}`);
    }
  });

  cron.schedule("0 2 * * *", async () => {
    logger.info("[scheduler] running rep decay sweep");
    try {
      await lending.runRepDecaySweep();
    } catch (err: any) {
      logger.error(`[scheduler] decay sweep error: ${err.message}`);
    }
  });

  cron.schedule("0 * * * *", async () => {
    // @ts-ignore
    const db = require("./config/db");
    await db.query(
      `UPDATE lend_offers SET status='expired' WHERE status='open' AND expires_at < NOW()`
    );
    logger.info("[scheduler] stale offers expired");
  });

  cron.schedule("*/5 * * * *", async () => {
    // @ts-ignore
    const db = require("./config/db");
    await db.query(
      `UPDATE pending_approvals SET status='expired' WHERE status='pending_user' AND expires_at < NOW()`
    );
  });

  logger.info("[scheduler] all crons registered");
}
