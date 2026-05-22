import fs from "fs";
import path from "path";
import { Pool as PgPool } from "pg";
import { PGlite } from "@electric-sql/pglite";

type QueryResult = {
  rows: any[];
  rowCount?: number;
};

let pool: any;
let dbReady: Promise<void> = Promise.resolve();

function loadSchemaForEmbeddedPg() {
  const schemaPath = path.resolve(__dirname, "..", "schema.sql");
  const rawSchema = fs.readFileSync(schemaPath, "utf8");
  return rawSchema
    .split("CREATE OR REPLACE FUNCTION check_match_owner_isolation()")[0]
    .replace(/DEFAULT gen_random_uuid\(\)/g, "")
    .replace(/gen_random_uuid\(\)/g, "'00000000-0000-0000-0000-000000000001'")
    .replace(/CREATE INDEX(?!\s+IF NOT EXISTS)/g, "CREATE INDEX IF NOT EXISTS");
}

function splitSqlStatements(sql: string) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) =>
      statement
        .split(/\r?\n/)
        .filter((line) => line.trim() && !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
}

async function execEmbeddedSql(sql: string) {
  const statements = splitSqlStatements(sql);
  for (const statement of statements) {
    await pool.query(statement);
  }
}

async function cleanupLegacyDemoData() {
  await pool.query(
    `DELETE FROM lend_offers
     WHERE lender_agent_id IN ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444')`
  );
  await pool.query(
    `DELETE FROM agent_configs
     WHERE agent_id IN ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444')`
  );
  await pool.query(
    `DELETE FROM agent_execution_logs
     WHERE agent_id IN ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444')`
  );
  await pool.query(
    `DELETE FROM event_log
     WHERE agent_id IN ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444')
        OR counterparty_agent_id IN ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444')`
  );
  await pool.query(
    `DELETE FROM matches
     WHERE lender_agent_id IN ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444')
        OR borrower_agent_id IN ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444')`
  );
  await pool.query(
    `DELETE FROM borrow_queue
     WHERE borrower_agent_id IN ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444')`
  );
  await pool.query(
    `DELETE FROM pending_approvals
     WHERE agent_id IN ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444')`
  );
  await pool.query(
    `DELETE FROM agents
     WHERE agent_id IN ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444')`
  );
  await pool.query(
    `DELETE FROM users
     WHERE user_id IN ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333')`
  );
}

async function initializeEmbeddedPgAt(dbPath: string) {
  pool = new PGlite(dbPath);
  await execEmbeddedSql(loadSchemaForEmbeddedPg());
  await cleanupLegacyDemoData();
}

async function initEmbeddedPg() {
  const dbPath = process.env.EMBEDDED_DB_PATH
    ? path.resolve(process.env.EMBEDDED_DB_PATH)
    : path.resolve(process.cwd(), ".localdb", "agentfi");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  try {
    await initializeEmbeddedPgAt(dbPath);
  } catch (error: any) {
    const message = String(error?.message || error || "");
    const shouldRecover =
      message.includes("RuntimeError: Aborted") ||
      message.includes("_pg_initdb") ||
      message.includes("wasm");

    if (!shouldRecover) {
      throw error;
    }

    const corruptedPath = `${dbPath}.corrupt-${Date.now()}`;
    try {
      if (fs.existsSync(dbPath)) {
        fs.renameSync(dbPath, corruptedPath);
        console.warn(`[db] embedded DB looked corrupted; moved it to ${corruptedPath}`);
      }
    } catch {
      if (fs.existsSync(dbPath)) {
        fs.rmSync(dbPath, { recursive: true, force: true });
        console.warn("[db] embedded DB looked corrupted; removed old local DB directory");
      }
    }

    await initializeEmbeddedPgAt(dbPath);
  }
}

const usePostgres = process.env.USE_POSTGRES === "true";

if (usePostgres && process.env.DATABASE_URL) {
  pool = new PgPool({ connectionString: process.env.DATABASE_URL });
  console.log("[db] using Postgres via DATABASE_URL");
} else {
  dbReady = initEmbeddedPg();
  const displayPath = process.env.EMBEDDED_DB_PATH
    ? path.resolve(process.env.EMBEDDED_DB_PATH)
    : ".localdb/agentfi";
  console.log(`[db] using embedded file-backed PGlite at ${displayPath}`);
}

export const query = async (text: string, params: any[] = []): Promise<QueryResult> => {
  await dbReady;
  const result = await pool.query(text, params);
  return { rows: result.rows || [], rowCount: result.rowCount };
};

export const close = async () => {
  await dbReady;
  if (pool?.end) {
    await pool.end();
  } else if (pool?.close) {
    await pool.close();
  }
};
