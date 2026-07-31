const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "PHRS");

  const chainId = (await ethers.provider.getNetwork()).chainId;
  console.log("Chain ID:", chainId);

  // Real USDC on Pharos Testnet
  const USDC_ADDRESS = "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8";

  // Deploy MockUSDC for testing (we can mint from it)
  console.log("\n--- Deploying MockUSDC ---");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUsdc = await MockUSDC.deploy();
  await mockUsdc.waitForDeployment();
  const mockUsdcAddr = await mockUsdc.getAddress();
  console.log("MockUSDC deployed at:", mockUsdcAddr);

  // Mint test tokens to deployer
  const mintAmount = ethers.parseUnits("1000000", 6);
  await mockUsdc.mint(deployer.address, mintAmount);
  console.log("Minted", ethers.formatUnits(mintAmount, 6), "MockUSDC to deployer");

  // Deploy iNeedEscrowV2
  console.log("\n--- Deploying iNeedEscrowV2 ---");
  const TREASURY = deployer.address;
  const iNeedEscrowV2 = await ethers.getContractFactory("iNeedEscrowV2");
  const escrowV2 = await iNeedEscrowV2.deploy(TREASURY);
  await escrowV2.waitForDeployment();
  const escrowV2Addr = await escrowV2.getAddress();
  console.log("iNeedEscrowV2 deployed at:", escrowV2Addr);
  console.log("Treasury address:", TREASURY);
  console.log("Fee BPS:", (await escrowV2.feeBps()).toString());
  console.log("Admin:", await escrowV2.admin());

  // Summary
  console.log("\n=============================================");
  console.log("DEPLOYMENT SUMMARY");
  console.log("=============================================");
  console.log("Network: Pharos Atlantic Testnet");
  console.log("Chain ID:", chainId);
  console.log("Deployer:", deployer.address);
  console.log("");
  console.log("iNeedEscrowV2:", escrowV2Addr);
  console.log("MockUSDC:", mockUsdcAddr);
  console.log("Real USDC:", USDC_ADDRESS);
  console.log("Treasury:", TREASURY);
  console.log("Fee BPS: 200 (2%)");
  console.log("");
  console.log("Deployer PHRS Balance:", ethers.formatEther(balance));
  console.log("=============================================");

  return { escrowV2Addr, mockUsdcAddr, USDC_ADDRESS, TREASURY };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
