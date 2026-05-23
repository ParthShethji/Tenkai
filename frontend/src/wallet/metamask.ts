import { BrowserProvider, Contract, parseEther, parseUnits } from "ethers";

export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

export const ETHEREUM_SEPOLIA_CHAIN_ID = "0xaa36a7";
export const ARC_TESTNET_CHAIN_ID = "0x14a34";

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const ENS_RESOLVER = "0x8FADE66B79cC9f707aB26799354482EB93a5B7dD";
const ERC20_ABI = [
  "function transfer(address to, uint256 value) returns (bool)",
];

export function getEthereumProvider(): EthereumProvider | null {
  const eth = (window as any).ethereum as EthereumProvider | undefined;
  return eth ?? null;
}

export async function connectMetaMask(): Promise<{ address: string; chainId: string }> {
  const ethereum = getEthereumProvider();
  if (!ethereum) throw new Error("MetaMask not detected");

  const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error("No account returned from wallet");

  const chainId = (await ethereum.request({ method: "eth_chainId" })) as string;
  return { address, chainId };
}

export async function getCurrentAccount(): Promise<{ address: string; chainId: string } | null> {
  const ethereum = getEthereumProvider();
  if (!ethereum) return null;

  const accounts = (await ethereum.request({ method: "eth_accounts" })) as string[];
  const address = accounts?.[0];
  if (!address) return null;

  const chainId = (await ethereum.request({ method: "eth_chainId" })) as string;
  return { address, chainId };
}

export async function signMessage(message: string, address: string) {
  const ethereum = getEthereumProvider();
  if (!ethereum) throw new Error("MetaMask not detected");
  const signature = (await ethereum.request({
    method: "personal_sign",
    params: [message, address],
  })) as string;
  return signature;
}

export function getChainLabel(chainId?: string | null) {
  if (!chainId) return "Unknown network";
  const normalized = chainId.toLowerCase();
  if (normalized === "0x7a69" || normalized === "0x539") return "Local Hardhat";
  if (normalized === ETHEREUM_SEPOLIA_CHAIN_ID) return "Ethereum Sepolia";
  if (normalized === ARC_TESTNET_CHAIN_ID) return "Arc Network";
  if (normalized === "0x1") return "Ethereum Mainnet";
  return `Chain ${chainId}`;
}

async function getBrowserSigner() {
  const ethereum = getEthereumProvider();
  if (!ethereum) throw new Error("MetaMask not detected");
  const provider = new BrowserProvider(ethereum as any);
  return provider.getSigner();
}

async function switchEthereumChain(chainId: string, chainName: string, rpcUrls: string[], blockExplorerUrls: string[]) {
  const eth = getEthereumProvider();
  if (!eth) throw new Error("MetaMask not detected");
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (err: any) {
    if (err?.code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId,
          chainName,
          rpcUrls,
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          blockExplorerUrls,
        }],
      });
      return;
    }
    throw err;
  }
}

export async function switchToEthereumSepolia(): Promise<void> {
  await switchEthereumChain(
    ETHEREUM_SEPOLIA_CHAIN_ID,
    "Ethereum Sepolia",
    ["https://rpc.sepolia.org"],
    ["https://sepolia.etherscan.io"]
  );
}

export async function switchToArcNetwork(): Promise<void> {
  await switchEthereumChain(
    ARC_TESTNET_CHAIN_ID,
    "Arc Network",
    ["https://testnet.rpc.arc.network"],
    ["https://testnet.explorer.arc.network"]
  );
}

export async function sendEthToAgent(to: string, amountEth: string) {
  const signer = await getBrowserSigner();
  const tx = await signer.sendTransaction({
    to,
    value: parseEther(amountEth),
  });
  await tx.wait();
  return tx.hash;
}

export async function sendUsdcToAgent(usdcAddress: string, to: string, amountUsdc: string) {
  const signer = await getBrowserSigner();
  const token = new Contract(usdcAddress, ERC20_ABI, signer);
  const tx = await token.transfer(to, parseUnits(amountUsdc, 6));
  await tx.wait();
  return tx.hash;
}

export function formatAddress(addr: string, chars = 4) {
  if (!addr) return "";
  return `${addr.slice(0, 2 + chars)}...${addr.slice(-chars)}`;
}

function hexPad32(hex: string): string {
  return hex.replace("0x", "").padStart(64, "0");
}

function ensNodeHelpers(_name: string) {
  return { namehash: "", labelHash: "" };
}

async function keccak256Str(str: string): Promise<string> {
  const { labelHash } = ensNodeHelpers(str);
  return labelHash;
}

export async function createEnsSubdomain({
  parentEnsName,
  label,
  agentWallet,
  userAddress,
  parentNode,
  subdomainNode,
  labelHash,
}: {
  parentEnsName: string;
  label: string;
  agentWallet: string;
  userAddress: string;
  parentNode: string;
  subdomainNode: string;
  labelHash: string;
}): Promise<string> {
  const eth = getEthereumProvider();
  if (!eth) throw new Error("MetaMask not detected");

  await switchToEthereumSepolia();

  const setSubnodeRecordSelector = "5ef2c7f0";
  const resolverPadded = hexPad32(ENS_RESOLVER.toLowerCase().replace("0x", ""));
  const ownerPadded = hexPad32(userAddress.toLowerCase().replace("0x", ""));
  const ttlPadded = hexPad32("0");
  const registryCalldata =
    "0x" +
    setSubnodeRecordSelector +
    hexPad32(parentNode.replace("0x", "")) +
    hexPad32(labelHash.replace("0x", "")) +
    ownerPadded +
    resolverPadded +
    ttlPadded;

  const tx1Hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{
      from: userAddress,
      to: ENS_REGISTRY,
      data: registryCalldata,
      gas: "0x186a0",
    }],
  })) as string;

  await waitForTxConfirmation(eth, tx1Hash);

  const setAddrSelector = "d5fa2b00";
  const agentWalletPadded = hexPad32(agentWallet.toLowerCase().replace("0x", ""));
  const resolverCalldata =
    "0x" +
    setAddrSelector +
    hexPad32(subdomainNode.replace("0x", "")) +
    agentWalletPadded;

  const tx2Hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{
      from: userAddress,
      to: ENS_RESOLVER,
      data: resolverCalldata,
      gas: "0x11170",
    }],
  })) as string;

  await waitForTxConfirmation(eth, tx2Hash);

  return tx1Hash;
}

async function waitForTxConfirmation(eth: EthereumProvider, txHash: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const receipt = (await eth.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    })) as { status: string } | null;
    if (receipt?.status === "0x1") return;
    if (receipt?.status === "0x0") throw new Error(`ENS tx failed: ${txHash}`);
  }
  throw new Error(`ENS tx not confirmed after 60s: ${txHash}`);
}
