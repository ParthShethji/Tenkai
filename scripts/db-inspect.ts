import fs from "fs";
import os from "os";
import path from "path";

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function printSection(db: (sql: string) => Promise<{ rows: any[] }>, title: string, sql: string) {
  const { rows } = await db(sql);
  console.log(`\n=== ${title} ===`);
  console.table(rows);
}

function prepareEmbeddedSnapshotIfNeeded() {
  const usePostgres = process.env.USE_POSTGRES === "true";
  if (usePostgres && process.env.DATABASE_URL) {
    return null;
  }

  const sourcePath = path.resolve(process.cwd(), ".localdb", "agentfi");
  if (!fs.existsSync(sourcePath)) {
    return null;
  }

  const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentfi-db-inspect-"));
  const snapshotPath = path.join(snapshotRoot, "agentfi");
  fs.cpSync(sourcePath, snapshotPath, { recursive: true });
  process.env.EMBEDDED_DB_PATH = snapshotPath;
  return snapshotRoot;
}

async function main() {
  const showSecrets = hasFlag("--show-secrets");
  const snapshotRoot = prepareEmbeddedSnapshotIfNeeded();

  try {
    const { query: db, close } = await import("../config/db");

    await printSection(
      db,
      "Users",
      `SELECT user_id, email, wallet_address, ens_name, zk_proof_status, created_at
       FROM users
       ORDER BY created_at DESC`
    );

    await printSection(
      db,
      "Agents",
      showSecrets
        ? `SELECT agent_id, ens_name, wallet_address, role, status, reputation_score,
                  private_key, created_at
           FROM agents
           ORDER BY created_at DESC`
        : `SELECT agent_id, ens_name, wallet_address, role, status, reputation_score,
                  private_key IS NOT NULL AS has_private_key, created_at
           FROM agents
           ORDER BY created_at DESC`
    );

    await printSection(
      db,
      "Agent Configs",
      `SELECT agent_id, agent_type, runtime_status, execution_interval_seconds,
              total_cycles, total_profit_usdc, total_borrowed_usdc, total_lent_usdc,
              last_execution_at, next_execution_at
       FROM agent_configs
       ORDER BY updated_at DESC NULLS LAST`
    );

    await printSection(
      db,
      "Recent Logs",
      `SELECT agent_id, phase, level, message, tool_name, created_at
       FROM agent_execution_logs
       ORDER BY created_at DESC
       LIMIT 25`
    );

    await close();
  } finally {
    if (snapshotRoot && fs.existsSync(snapshotRoot)) {
      fs.rmSync(snapshotRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
