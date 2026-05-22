import { query as db } from "./db";

const keyByWallet = new Map<string, string>();

function normalize(walletAddress: string) {
  return walletAddress.toLowerCase();
}

export function setAgentPrivateKey(walletAddress: string, privateKey: string) {
  keyByWallet.set(normalize(walletAddress), privateKey);
}

export function getAgentPrivateKey(walletAddress: string): string | null {
  return keyByWallet.get(normalize(walletAddress)) || null;
}

export async function persistAgentPrivateKey(
  agentId: string,
  walletAddress: string,
  privateKey: string
) {
  setAgentPrivateKey(walletAddress, privateKey);
  await db(
    `UPDATE agents
     SET private_key = $2
     WHERE agent_id = $1`,
    [agentId, privateKey]
  );
}

export async function loadAgentPrivateKey(walletAddress: string): Promise<string | null> {
  const cached = getAgentPrivateKey(walletAddress);
  if (cached) return cached;

  const { rows } = await db(
    `SELECT private_key
     FROM agents
     WHERE lower(wallet_address) = lower($1)
     LIMIT 1`,
    [walletAddress]
  );

  const privateKey = rows[0]?.private_key ? String(rows[0].private_key) : null;
  if (privateKey) {
    setAgentPrivateKey(walletAddress, privateKey);
  }
  return privateKey;
}
