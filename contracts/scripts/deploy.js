const hre = require("hardhat");

async function main() {
  const treasury = process.env.TREASURY_ADDRESS;
  if (!treasury) {
    throw new Error("TREASURY_ADDRESS not set in .env");
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "PHRS");

  const iNeedEscrow = await hre.ethers.getContractFactory("iNeedEscrow");
  const escrow = await iNeedEscrow.deploy(treasury);
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log("iNeedEscrow deployed to:", address);
  console.log("Network:", hre.network.name, "(chain ID:", hre.network.config.chainId, ")");
  console.log("Admin:", await escrow.admin());
  console.log("Treasury:", await escrow.feeTreasury());
  console.log("Fee BPS:", (await escrow.feeBps()).toString());
  console.log("Max Fee BPS:", (await escrow.maxFeeBps()).toString());

  return address;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
