require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0000000000000000000000000000000000000000000000000000000000000000";
const PHAROSSCAN_API_KEY = process.env.PHAROSSCAN_API_KEY || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    pharosTestnet: {
      url: process.env.PHAROS_TESTNET_RPC || "https://atlantic.dplabs-internal.com",
      chainId: 688689,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    pharosMainnet: {
      url: process.env.PHAROS_MAINNET_RPC || "https://rpc.pharos.xyz",
      chainId: 1672,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      pharosTestnet: PHAROSSCAN_API_KEY,
      pharosMainnet: PHAROSSCAN_API_KEY,
    },
    customChains: [
      {
        network: "pharosTestnet",
        chainId: 688689,
        urls: {
          apiURL: "https://atlantic.pharosscan.xyz/api",
          browserURL: "https://atlantic.pharosscan.xyz",
        },
      },
      {
        network: "pharosMainnet",
        chainId: 1672,
        urls: {
          apiURL: "https://www.pharosscan.xyz/api",
          browserURL: "https://www.pharosscan.xyz",
        },
      },
    ],
  },
};
