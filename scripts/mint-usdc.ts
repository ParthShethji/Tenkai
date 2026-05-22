import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

const DEFAULT_USDC_ADDRESS = "0xb246c2717B0a7666FFCcE4D2885541b96f487959";
const DEFAULT_RECIPIENT = "0x3CA5ea6c75c253cece62B8434eeeaE041a3C7368";
const DEFAULT_AMOUNT = "200000";

async function main() {
  const [signer] = await ethers.getSigners();

  const usdcAddress = process.env.MINT_USDC_ADDRESS || process.env.USDC_ADDRESS || DEFAULT_USDC_ADDRESS;
  const recipient = process.env.MINT_RECIPIENT || DEFAULT_RECIPIENT;
  const amount = process.env.MINT_AMOUNT || DEFAULT_AMOUNT;

  const usdc = await ethers.getContractAt("MockERC20", usdcAddress, signer);
  const decimals = await usdc.decimals();
  const mintAmount = ethers.parseUnits(amount, decimals);

  console.log(`[mint-usdc] minter=${signer.address}`);
  console.log(`[mint-usdc] usdc=${usdcAddress}`);
  console.log(`[mint-usdc] recipient=${recipient}`);
  console.log(`[mint-usdc] amount=${amount}`);

  const tx = await usdc.mint(recipient, mintAmount);
  const receipt = await tx.wait();

  console.log(`[mint-usdc] txHash=${receipt?.hash}`);
  console.log(`[mint-usdc] minted=${mintAmount.toString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
