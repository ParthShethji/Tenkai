-- AgentFi lending schema
-- Run in order on Base Sepolia testnet environment

-- ─── Core tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE,
    wallet_address  TEXT UNIQUE,
    ens_name        TEXT,
    zk_proof_status TEXT DEFAULT 'none',   -- none | pending | verified
    human_id        TEXT UNIQUE,           -- ZK-derived hash, one per human (anti-sybil)
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_login      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agents (
    agent_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    ens_name          TEXT UNIQUE NOT NULL,   -- any valid ENS name (e.g. alice.eth)
    wallet_address    TEXT UNIQUE NOT NULL,   -- 2-of-2 multisig address
    private_key       TEXT,
    fileverse_doc_id  TEXT,
    bitgo_wallet_id   TEXT,
    role              TEXT NOT NULL CHECK (role IN ('lender', 'borrower')),
    status            TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','active','paused','stopped')),
    reputation_score  SMALLINT NOT NULL DEFAULT 25 CHECK (reputation_score BETWEEN 0 AND 50),
    last_activity_at  TIMESTAMPTZ DEFAULT NOW(),
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agents_user_id ON agents(user_id);
CREATE INDEX idx_agents_wallet  ON agents(wallet_address);

-- Runtime configuration and state for autonomous agents

CREATE TABLE IF NOT EXISTS agent_configs (
    agent_id                    UUID PRIMARY KEY REFERENCES agents(agent_id) ON DELETE CASCADE,
    agent_type                  TEXT NOT NULL CHECK (agent_type IN ('lender','borrower')),
    strategy_prompt             TEXT NOT NULL,
    strategy_json               TEXT NOT NULL DEFAULT '{}',
    execution_interval_seconds  INTEGER NOT NULL DEFAULT 60 CHECK (execution_interval_seconds >= 10),
    enabled_tools               TEXT NOT NULL DEFAULT '[]',
    risk_tolerance              TEXT NOT NULL DEFAULT 'balanced',
    profit_target_pct           NUMERIC(8,3) NOT NULL DEFAULT 4.000,
    runtime_status              TEXT NOT NULL DEFAULT 'active'
                                  CHECK (runtime_status IN ('active','paused','stopped')),
    last_execution_at           TIMESTAMPTZ,
    next_execution_at           TIMESTAMPTZ,
    last_result_summary         TEXT,
    total_cycles                INTEGER NOT NULL DEFAULT 0,
    total_profit_usdc           NUMERIC(12,6) NOT NULL DEFAULT 0,
    total_borrowed_usdc         NUMERIC(12,6) NOT NULL DEFAULT 0,
    total_lent_usdc             NUMERIC(12,6) NOT NULL DEFAULT 0,
    current_positions_json      TEXT NOT NULL DEFAULT '{}',
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_configs_runtime_status ON agent_configs(runtime_status, next_execution_at);

CREATE TABLE IF NOT EXISTS agent_execution_logs (
    log_id          BIGSERIAL PRIMARY KEY,
    agent_id        UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    cycle_id        TEXT NOT NULL,
    phase           TEXT NOT NULL,
    level           TEXT NOT NULL DEFAULT 'info'
                      CHECK (level IN ('debug','info','warn','error')),
    message         TEXT NOT NULL,
    tool_name       TEXT,
    tool_input      TEXT,
    tool_output     TEXT,
    metadata_json   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_execution_logs_agent ON agent_execution_logs(agent_id, created_at DESC);

-- ─── Lend orderbook ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lend_offers (
    offer_id          SERIAL PRIMARY KEY,
    lender_agent_id   UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    max_amount_usdc   NUMERIC(12,6) NOT NULL,
    min_rep_required  SMALLINT NOT NULL DEFAULT 25,
    rate_pct          NUMERIC(5,3) NOT NULL,
    status            TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','filled','cancelled','expired')),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    expires_at        TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX idx_lend_offers_status_rep ON lend_offers(status, min_rep_required, rate_pct);

-- ─── Borrow queue (no match found) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS borrow_queue (
    queue_id            SERIAL PRIMARY KEY,
    borrower_agent_id   UUID NOT NULL REFERENCES agents(agent_id),
    requested_amount_usdc NUMERIC(12,6) NOT NULL,
    rep_at_request      SMALLINT NOT NULL,
    status              TEXT DEFAULT 'waiting'
                          CHECK (status IN ('waiting','matched','cancelled')),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Pending user approvals (volume gate) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS pending_approvals (
    approval_id   SERIAL PRIMARY KEY,
    agent_id      UUID NOT NULL REFERENCES agents(agent_id),
    type          TEXT NOT NULL,       -- 'borrow_request'
    amount_usdc   NUMERIC(12,6) NOT NULL,
    status        TEXT DEFAULT 'pending_user'
                    CHECK (status IN ('pending_user','approved','rejected','expired')),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    expires_at    TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 minutes'
);

-- ─── Matches (funded loans) ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS matches (
    match_id                  SERIAL PRIMARY KEY,
    lender_agent_id           UUID NOT NULL REFERENCES agents(agent_id),
    borrower_agent_id         UUID NOT NULL REFERENCES agents(agent_id),
    amount_usdc               NUMERIC(12,6) NOT NULL,
    interest_usdc             NUMERIC(12,6) NOT NULL,
    rate_pct                  NUMERIC(5,3) NOT NULL,
    collateral_usdc           NUMERIC(12,6) NOT NULL DEFAULT 0,
    borrower_rep_at_origination SMALLINT NOT NULL,
    loan_id_onchain           INTEGER NOT NULL,   -- contract's loanId
    status                    TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN (
                                  'active','repaid','partial_default',
                                  'liquidated','defaulted'
                                )),
    funded_at                 TIMESTAMPTZ DEFAULT NOW(),
    repaid_at                 TIMESTAMPTZ,
    repay_tx_hash             TEXT,
    CONSTRAINT no_self_match CHECK (lender_agent_id != borrower_agent_id)
);

CREATE INDEX idx_matches_borrower ON matches(borrower_agent_id, status);
CREATE INDEX idx_matches_lender   ON matches(lender_agent_id, status);

-- ─── Append-only event log ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_log (
    event_id             BIGSERIAL PRIMARY KEY,
    agent_id             UUID NOT NULL REFERENCES agents(agent_id),
    type                 TEXT NOT NULL,
    -- loan_borrowed | loan_funded | loan_repaid | loan_partial_default
    -- loan_liquidated | rep_updated | offer_posted | offer_cancelled
    amount               NUMERIC(12,6),
    counterparty_agent_id UUID REFERENCES agents(agent_id),
    tx_hash              TEXT,
    rep_delta            SMALLINT DEFAULT 0,
    timestamp            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_event_log_agent ON event_log(agent_id, timestamp DESC);

-- ─── Reputation snapshots ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rep_snapshots (
    snapshot_id        BIGSERIAL PRIMARY KEY,
    wallet_address     TEXT NOT NULL,
    score              SMALLINT NOT NULL,
    source             TEXT NOT NULL,
    -- on_time_with_profit | on_time_no_profit | late_repayment
    -- partial_repayment | default | inactivity_decay | zk_vouch | offer_cancel_penalty
    on_chain_tx_hash   TEXT,
    timestamp          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rep_snapshots_wallet ON rep_snapshots(wallet_address, timestamp DESC);

-- ─── DB-level anti-sybil constraint ──────────────────────────────────────────
-- Belt-and-suspenders: matches table prevents same userId on both sides
-- via a trigger (the service layer also checks, but defense in depth)

CREATE OR REPLACE FUNCTION check_match_owner_isolation()
RETURNS TRIGGER AS $$
DECLARE
    lender_user UUID;
    borrower_user UUID;
BEGIN
    SELECT user_id INTO lender_user   FROM agents WHERE agent_id = NEW.lender_agent_id;
    SELECT user_id INTO borrower_user FROM agents WHERE agent_id = NEW.borrower_agent_id;

    IF lender_user = borrower_user THEN
        RAISE EXCEPTION 'SYBIL_BLOCK: lender and borrower belong to same user %', lender_user;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_match_owner_isolation
BEFORE INSERT ON matches
FOR EACH ROW EXECUTE FUNCTION check_match_owner_isolation();
