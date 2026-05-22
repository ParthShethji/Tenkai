import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("[seed:demo] DATABASE_URL is missing in environment.");
  process.exit(1);
}

async function run() {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
      INSERT INTO users (user_id, email, wallet_address, zk_proof_status)
      VALUES
        ('11111111-1111-1111-1111-111111111111', 'lender@test.com', '0xLenderUserWallet', 'verified'),
        ('33333333-3333-3333-3333-333333333333', 'borrower@test.com', '0xBorrowerUserWallet', 'verified')
      ON CONFLICT (user_id) DO NOTHING
      `
    );

    await client.query(
      `
      INSERT INTO agents (
        agent_id,
        user_id,
        ens_name,
        wallet_address,
        role,
        status,
        reputation_score
      )
      VALUES
        (
          '22222222-2222-2222-2222-222222222222',
          '11111111-1111-1111-1111-111111111111',
          'alice.eth',
          '0xLenderAgentWallet',
          'lender',
          'active',
          35
        ),
        (
          '44444444-4444-4444-4444-444444444444',
          '33333333-3333-3333-3333-333333333333',
          'bob.eth',
          '0xBorrowerAgentWallet',
          'borrower',
          'active',
          25
        )
      ON CONFLICT (agent_id) DO NOTHING
      `
    );

    await client.query(
      `
      INSERT INTO lend_offers (
        lender_agent_id,
        max_amount_usdc,
        min_rep_required,
        rate_pct,
        status
      )
      VALUES (
        '22222222-2222-2222-2222-222222222222',
        500,
        25,
        2.0,
        'open'
      )
      ON CONFLICT DO NOTHING
      `
    );

    await client.query("COMMIT");
    console.log("[seed:demo] Done.");
    console.log("[seed:demo] lenderAgentId: 22222222-2222-2222-2222-222222222222");
    console.log("[seed:demo] borrowerAgentId: 44444444-4444-4444-4444-444444444444");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[seed:demo] Failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void run();
