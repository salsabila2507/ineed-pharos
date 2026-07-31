# iNeedEscrow — Deployment Guide

## Prerequisites

1. **Wallet funded with PHRS on Pharos Atlantic Testnet**
   - Get testnet PHRS from the Pharos faucet
   - The deployer account needs enough PHRS to cover gas

2. **Configure environment variables**

```bash
cp .env.example .env
```

Edit `.env`:
```
PRIVATE_KEY=your_wallet_private_key
TREASURY_ADDRESS=0xAddressThatCollectsPlatformFees
```

> **Security**: Never commit `.env` to version control. The `.gitignore` already excludes it.

## Deployed Contracts

| Contract | Address | Explorer |
|---|---|---|
| **iNeedEscrow** | `0x1c169071cB32033c13305902704E5A0C6c658C89` | [PharosScan](https://atlantic.pharosscan.xyz/address/0x1c169071cB32033c13305902704E5A0C6c658C89) |

- **Network**: Pharos Atlantic Testnet (Chain ID: 688689)
- **Deployer / Admin**: `0xaa2db706d3864751ea2879f141a3d2A626da3cF6`
- **Treasury**: `0xaa2db706d3864751ea2879f141a3d2A626da3cF6`
- **Deploy TX**: `0x3e7bca704b7cae67bfbf537f67bb2583b73b35e4c483919cc89af18b5518be5f`
- **Block**: 27165611
- **Fee BPS**: 200 (2%)
- **Max Fee BPS**: 1000 (10%)

## Deploy to Pharos Atlantic Testnet

```bash
npx hardhat run scripts/deploy.js --network pharosTestnet
```

### What the deploy script does
1. Connects to Pharos Atlantic Testnet (chain ID: 688689)
2. Deploys `iNeedEscrow` with the configured treasury address
3. The deployer wallet becomes the contract admin
4. Default platform fee: 2% (200 bps), capped at 10% (1000 bps)
5. Prints the deployed contract address and config

## Verify on PharosScan

After deployment, verify the contract source code:

```bash
npx hardhat verify --network pharosTestnet <DEPLOYED_ADDRESS> <TREASURY_ADDRESS>
```

Example:
```bash
npx hardhat verify --network pharosTestnet 0x1c169071cB32033c13305902704E5A0C6c658C89 0xaa2db706d3864751ea2879f141a3d2A626da3cF6
```

> **Note**: Verification requires a PharosScan API key. Set `PHAROSSCAN_API_KEY` in `.env`.
> Obtain one from https://atlantic.pharosscan.xyz (Account > API Keys).

## Deploy to Pharos Pacific Mainnet

1. Update `.env` with mainnet RPC and funded wallet
2. Run:

```bash
npx hardhat run scripts/deploy.js --network pharosMainnet
```

## Post-Deployment

1. Verify the contract on PharosScan
2. Update the frontend config with the deployed address (see `frontend/`)
3. Configure the backend dispute resolver wallet as the admin (optional: transfer admin via `transferAdmin()`)
4. Update `feeBps` and `feeTreasury` if needed via admin functions

## Contract Functions Reference

| Function | Description |
|---|---|
| `createTask(...)` | Create a new task (no funds required) |
| `deposit(taskId)` | Fund a task with exact reward amount |
| `accept(taskId)` | Accept a task as a participant |
| `submit(taskId, contentHash)` | Submit work |
| `startReview(taskId)` | Move to review phase (after deadline) |
| `selectWinners(taskId, winners)` | Select winner(s) |
| `release(taskId)` | Release funds to winners (deducts platform fee) |
| `refund(taskId)` | Cancel and refund (before any acceptances) |
| `raiseDispute(taskId, evidence)` | Raise a dispute |
| `resolveDispute(...)` | Admin resolve a dispute |
| `autoResolve(taskId)` | Permissionless timeout resolution |
| `setFeeBps(newFeeBps)` | Admin: update platform fee |
| `setFeeTreasury(newAddr)` | Admin: update treasury address |
| `transferAdmin(newAdmin)` | Admin: transfer admin role |
