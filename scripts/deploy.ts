import { ethers, network, artifacts } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  // If only one key provided (no DEPLOYER_PRIVATE_KEY), reuse deployer as platformSigner
  const platformSigner = signers.length > 1 ? signers[1] : signers[0];
  console.log(`[deploy] network=${network.name}`);
  console.log(`[deploy] deployer=${deployer.address}`);
  console.log(`[deploy] platformSigner=${platformSigner.address}`);

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USDC", "USDC", 6);
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log(`[deploy] MockUSDC=${usdcAddress}`);

  const AgentFiLending = await ethers.getContractFactory("AgentFiLending");
  const lending = await AgentFiLending.deploy(usdcAddress, platformSigner.address);
  await lending.waitForDeployment();
  const lendingAddress = await lending.getAddress();
  console.log(`[deploy] AgentFiLending=${lendingAddress}`);

  const receipt = await lending.deploymentTransaction()?.wait(1);
  if (receipt?.hash) {
    console.log(`[deploy] AgentFiLending.txHash=${receipt.hash}`);
  }

  // Mint 1,000,000 USDC to deployer and platform signer for demo purposes
  const mintAmount = ethers.parseUnits("1000000", 6);
  await usdc.mint(deployer.address, mintAmount);
  await usdc.mint(platformSigner.address, mintAmount);
  console.log(`[deploy] Minted 1,000,000 USDC to deployer and platformSigner`);

  // Pre-approve lending contract from platform signer
  const usdcAsPlatform = usdc.connect(platformSigner);
  await usdcAsPlatform.approve(lendingAddress, ethers.MaxUint256);
  console.log(`[deploy] platformSigner approved lending contract for USDC`);

  const deployment = {
    network: network.name,
    chainId: Number(network.config.chainId || 0),
    deployer: deployer.address,
    platformSigner: platformSigner.address,
    contracts: {
      mockUsdc: usdcAddress,
      agentFiLending: lendingAddress,
    },
  };

  const deploymentDir = path.resolve(process.cwd(), "deployments");
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }
  const outPath = path.join(deploymentDir, `${network.name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log(`[deploy] wrote ${outPath}`);

  const artifact = await artifacts.readArtifact("AgentFiLending");
  fs.writeFileSync(
    path.resolve(process.cwd(), "contracts", "AgentFiLending.abi.json"),
    JSON.stringify(artifact.abi, null, 2)
  );
  console.log("[deploy] wrote contracts/AgentFiLending.abi.json");

  // Auto-update .env with new contract addresses
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, "utf8");
    envContent = envContent.replace(
      /^CONTRACT_ADDRESS=.*$/m,
      `CONTRACT_ADDRESS=${lendingAddress}`
    );
    envContent = envContent.replace(
      /^USDC_ADDRESS=.*$/m,
      `USDC_ADDRESS=${usdcAddress}`
    );
    fs.writeFileSync(envPath, envContent);
    console.log(`[deploy] updated .env with CONTRACT_ADDRESS=${lendingAddress} USDC_ADDRESS=${usdcAddress}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
