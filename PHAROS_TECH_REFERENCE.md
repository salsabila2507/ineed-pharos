# Pharos Blockchain — Technical Reference

> All information verified against official Pharos documentation at [docs.pharos.xyz](https://docs.pharos.xyz).

---

## 1. EVM Compatibility

Pharos is **EVM-compatible**. It runs the Ethereum Virtual Machine and supports standard Ethereum JSON-RPC methods. Solidity smart contracts can be deployed to Pharos without modification.

Smart contract development frameworks that work on Ethereum work on Pharos:
- **Hardhat** — officially supported in developer guides
- **Foundry** — officially supported in developer guides
- **Viem** / **ethers.js** / **web3.js** / **web3.py** — all compatible

The native token on Mainnet is **PROS** (not ETH), but the EVM interface treats it the same way (18 decimals, sent as `msg.value`).

---

## 2. Network Configuration

### Pacific Mainnet

| Parameter | Value |
|---|---|
| Network Name | Pharos Pacific Mainnet |
| Chain ID | `1672` (hex: `0x688`) |
| Native Currency | PROS (18 decimals) |
| RPC URL | `https://rpc.pharos.xyz` |
| Block Explorer | `https://www.pharosscan.xyz` |
| Status | Production |

### Atlantic Testnet

| Parameter | Value |
|---|---|
| Network Name | Pharos Atlantic Testnet |
| Chain ID | `688689` |
| Native Currency | PHRS (18 decimals) |
| RPC Public Endpoint | `https://atlantic.dplabs-internal.com` |
| WebSocket Endpoint | `wss://atlantic.dplabs-internal.com` |
| Block Explorer | `https://atlantic.pharosscan.xyz` |
| Rate Limit | 500 requests per 5 minutes |
| Max Pending TXs per Address | 64 |
| Status | Testnet / Development |

---

## 3. Smart Contract Language

**Solidity** is the primary language for smart contract development on Pharos.

The official docs provide Solidity tutorials for:
- dApps
- Tokens (ERC-20)
- NFTs (ERC-721)
- Uniswap-style contracts

Pharos also supports **Rust** development (WASM-based contracts with EVM interoperability — see "Call EVM From WASM" in the docs), but this is an advanced path. For the iNeed MVP, **Solidity + Hardhat/Foundry** is the recommended stack.

---

## 4. RPC Providers

Pharos supports multiple RPC providers:

| Provider | Description |
|---|---|
| **Pharos Public RPC** | `https://rpc.pharos.xyz` (Mainnet), `https://atlantic.dplabs-internal.com` (Testnet) |
| **ZAN** | Managed node service with API keys, Ethereum-compatible JSON-RPC |
| **Alchemy** | Scalable RPC infrastructure with dashboard and tooling |
| **Nirvana** | Additional RPC provider option |
| **dRPC** | Decentralized RPC, endpoint: `https://pharos.drpc.org` |

---

## 5. Wallet Compatibility

Pharos is compatible with any **EVM wallet** that supports custom networks via Chain ID and RPC URL.

### Supported Wallets

| Wallet | Notes |
|---|---|
| **MetaMask** | Add Pharos network via Chain List or manual config |
| **Safe MultiSig** | Officially documented custody solution for teams |
| **Fordefi** | Officially documented institutional custody solution |
| Any EVM-compatible wallet | Tested with wagmi, RainbowKit, Web3Modal |

### Wallet Connection (Frontend)

Pharos works with standard Ethereum wallet connection libraries:
- **wagmi** — recommended for React/Next.js (used in official docs examples)
- **viem** — low-level TypeScript client (used in official docs examples)
- **ethers.js** — JavaScript library
- **Ant Design Web3** — React component library

Example wagmi chain config (from official docs):

```javascript
import { defineChain } from 'viem'

const pharosTestnet = defineChain({
  id: 688689,
  name: 'Pharos Atlantic Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://atlantic.dplabs-internal.com'] },
  },
  blockExplorers: {
    default: { name: 'Pharos Explorer', url: 'https://atlantic.pharosscan.io/' },
  },
})
```

---

## 6. Block Explorer & Contract Verification

| Network | Explorer URL | Verification |
|---|---|---|
| Pacific Mainnet | [pharosscan.xyz](https://www.pharosscan.xyz) | Yes — contract source verification supported |
| Atlantic Testnet | [atlantic.pharosscan.xyz](https://atlantic.pharosscan.xyz) | Yes — contract source verification supported |

Both explorers support:
- Transaction lookup and status
- Block inspection
- Address/account balance
- Smart contract interaction (read/write)
- Contract source code verification via API

---

## 7. Developer Tooling & SDKs

### Smart Contract Development

| Tool | Official Support | Use |
|---|---|---|
| **Hardhat** | Yes — dedicated guide | Compile, deploy, test Solidity contracts |
| **Foundry** | Yes — dedicated guide | Fast Solidity testing, forge scripts for deployment |
| **Remix IDE** | Compatible (EVM) | Browser-based prototyping |

### Client SDKs

| SDK | Use |
|---|---|
| **viem** | TypeScript client for reading chain state, sending transactions |
| **wagmi** | React hooks for wallet connection + contract interaction |
| **ethers.js** | JavaScript library for smart contract interaction |
| **web3.js** | JavaScript library |
| **web3.py** | Python library |

### Infrastructure

| Tool | Official Support |
|---|---|
| **Goldsky** | Yes — subgraph indexing and data pipeline |
| **Chainlink** | Yes — Data Feeds and Push Engine oracles |
| **Supra** | Yes — oracle provider |
| **Chainlink CCIP** | Yes — cross-chain messaging |
| **Circle CCTP** | Yes — cross-chain USDC transfers |
| **LayerZero** | Yes — cross-chain messaging |
| **Anvita Flow** | Yes — agent service publishing framework |

---

## 8. Gas Model

Key details from official docs:
- Gas refund mechanism is supported
- Gas limit parameters apply per transaction
- Testnet gas prices are typically 10 Gwei (stable)
- Block time is approximately 900ms (both Mainnet and Testnet)
- Mainnet supports real-time TPS of ~1.72 (varies), with reported peak throughput of 500K TPS under consensus design

---

## 9. Key Implications for iNeed

| Requirement | Pharos Support | Verdict |
|---|---|---|
| EVM compatibility | Yes — full EVM | No contract rewrites needed |
| Solidity support | Yes — primary language | Use standard Solidity tooling |
| Chain ID (Mainnet) | 1672 | Use in wagmi/Hardhat config |
| Chain ID (Testnet) | 688689 (Atlantic) | Use for development |
| Public RPC (Testnet) | `https://atlantic.dplabs-internal.com` | Rate limited to 500/5m |
| Explorer + verification | Yes — both networks | Verify contracts via API |
| Wallet (MetaMask) | Yes — custom network | Add to user-facing dApp |
| wagmi/viem | Yes — documented | Frontend connector |
| Foundry | Yes — documented | Contract deployment |
| Hardhat | Yes — documented | Alternative deployment |
| MultiSig (Safe) | Yes — documented | Admin dispute multi-sig |
| Indexing (Goldsky) | Yes — documented | Future subgraph support |

---

## 10. Reference Links

| Resource | URL |
|---|---|
| Official Docs | [docs.pharos.xyz](https://docs.pharos.xyz) |
| Pacific Mainnet | [docs.pharos.xyz/getting-started/network/pacific-mainnet](https://docs.pharos.xyz/getting-started/network/pacific-mainnet) |
| Atlantic Testnet | [docs.pharos.xyz/getting-started/network/atlantic-testnet](https://docs.pharos.xyz/getting-started/network/atlantic-testnet) |
| RPC Infrastructure | [docs.pharos.xyz/tooling-and-infrastructure/rpc](https://docs.pharos.xyz/tooling-and-infrastructure/rpc) |
| Block Explorer | [docs.pharos.xyz/tooling-and-infrastructure/block-explorer](https://docs.pharos.xyz/tooling-and-infrastructure/block-explorer) |
| Wallet Setup | [docs.pharos.xyz/tooling-and-infrastructure/wallets](https://docs.pharos.xyz/tooling-and-infrastructure/wallets) |
| Foundry Guide | [docs.pharos.xyz/developer-guide/foundry](https://docs.pharos.xyz/developer-guide/foundry) |
| Hardhat Guide | [docs.pharos.xyz/developer-guide/hardhat](https://docs.pharos.xyz/developer-guide/hardhat) |
| JSON-RPC API | [docs.pharos.xyz/api-and-sdk/json-rpc-methods](https://docs.pharos.xyz/api-and-sdk/json-rpc-methods) |
| Gas Model | [docs.pharos.xyz/getting-started/gas-model](https://docs.pharos.xyz/getting-started/gas-model) |
| ChainList (Mainnet) | [chainlist.org/chain/1672](https://chainlist.org/chain/1672) |
| Mainnet Explorer | [pharosscan.xyz](https://www.pharosscan.xyz) |
| Testnet Explorer | [atlantic.pharosscan.xyz](https://atlantic.pharosscan.xyz) |
