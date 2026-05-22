-- Demo seed for frontend/manual API testing
-- Safe to run multiple times because of ON CONFLICT DO NOTHING

-- Users
INSERT INTO users (user_id, email, wallet_address, zk_proof_status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'lender@test.com', '0xLenderUserWallet', 'verified'),
  ('33333333-3333-3333-3333-333333333333', 'borrower@test.com', '0xBorrowerUserWallet', 'verified')
ON CONFLICT DO NOTHING;

-- Agents
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
ON CONFLICT DO NOTHING;

-- Optional starter offer (so GET /lending/offers is not empty)
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
ON CONFLICT DO NOTHING;
