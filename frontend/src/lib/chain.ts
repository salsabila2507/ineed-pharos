import { defineChain } from "viem";

export const pharosTestnet = defineChain({
  id: 688_689,
  name: "Pharos Atlantic Testnet",
  nativeCurrency: { name: "PHRS", symbol: "PHRS", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://atlantic.dplabs-internal.com"] },
  },
  blockExplorers: {
    default: {
      name: "PharosScan",
      url: "https://atlantic.pharosscan.xyz",
    },
  },
});

export const pharosMainnet = defineChain({
  id: 1_672,
  name: "Pharos Pacific Mainnet",
  nativeCurrency: { name: "PROS", symbol: "PROS", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.pharos.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "PharosScan",
      url: "https://www.pharosscan.xyz",
    },
  },
});
