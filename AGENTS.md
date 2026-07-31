# AGENTS.md - iNeed Agent Marketplace

## Objective
Migrate iNeedEscrow to V2 with multi-asset reward support (native PHRS + ERC20 USDC) and complete the full frontend task lifecycle (fund, accept, submit, select winners).

## Important Details
- Repo root: `/home/ubuntu/ineed-pharos`, git is clean.
- Network: Pharos Atlantic Testnet (chain ID 688689), RPC `https://atlantic.dplabs-internal.com`, explorer `https://atlantic.pharosscan.xyz`.
- Deployer wallet `0xaa2db706d3864751ea2879f141a3d2A626da3cF6` is also TREASURY_ADDRESS; private key stored in `contracts/.env` (gitignored).
- Frontend uses Next.js 16.2.12, React 19, wagmi v3, viem v2, Tailwind v4, @tanstack/react-query, zustand.
- V2 contract uses `address(0)` for native PHRS; USDC token at `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8` (6 decimals).
- V2 deposit: native uses `msg.value`, ERC20 uses `approve` + `transferFrom`; fee 2% always in same asset.
- V2 is a fresh deployment (no proxy upgrade from V1).
- Do not modify V1 contract. Do not modify frontend yet. Only contract + tests first.
- Do not expose private key or seed phrase.

## Work State
### Completed
- Docs reviewed and updated: FINAL_ARCHITECTURE.md, ESCROW_CONTRACT_SPEC.md, ESCROW_TEST_PLAN.md, TECH_SPEC.md.
- V1 contract deployed to `0x1c169071cB32033c13305902704E5A0C6c658C89` on Pharos Atlantic Testnet (block 27165611).
- V1: 75/75 tests passing.
- V2 contract (`iNeedEscrowV2.sol`) written: multi-asset support (address(0) = native, ERC20), dual-path deposit, asset-aware payout/refund/dispute.
- MockUSDC test contract created (6 decimals, OpenZeppelin ERC20).
- V2 test suite: 63 tests covering native + ERC20 paths (deposit, accept, submit, release single/multi, refund, dispute, autoResolve, fee snapshot, edge cases).
- All 138 tests passing (75 V1 + 63 V2).
- **V2 deployed** to Pharos Atlantic Testnet:
  - iNeedEscrowV2: `0x27D17774B2aeCe56C41140cFf99894Be36Ac661e`
  - MockUSDC: `0x396b9B29E9D98EC8630dCEa9B528c785AFE916FA`
  - Real USDC: `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8`
- Frontend: all pages created and build-verified (create, dashboard, task detail with funding/accept/submission/winner cards).
- **Frontend fully migrated to V2** — ABI imports, contract addresses, hooks, create page (asset selector + approve-first flow), funding card (allowance check + ERC20 deposit), accept/submission/winners cards updated. Build passes with zero errors.
- **On-chain E2E happy path passed** (`contracts/scripts/e2eTestV2.js`): native task #1 → Completed, MockUSDC task #2 → Completed, refund task #3 → Cancelled.
- **On-chain edge-case suite passed 53/53** (`contracts/scripts/e2eEdgeV2.js`): input validation, deposit/refund (native+ERC20), unauthorized access, double-claim, state transitions/winner selection/dispute, ERC20 allowance/balance, submission deadline, fee/admin with global-state restore verified (feeBps=200, treasury=deployer, admin=deployer). No contract bugs found.
- **iNeedEscrowV2 verified on PharosScan** (SocialScan explorer) via keyless API — NO API key required (PharosScan Atlantic exposes no API Keys menu; `hardhat verify` is unusable because `/api` is not exposed and `PHAROSSCAN_API_KEY` is unset).

### Active / Next
- (none — V1+V2 deployed, tested, frontend migrated, contract verified)

### Contract verification on PharosScan (keyless method)
- Explorer is a SocialScan build; its frontend talks to `https://api.socialscan.io/pharos-atlantic-testnet` (no auth).
- `hardhat verify` will NOT work here: the Etherscan-style `https://atlantic.pharosscan.xyz/api` returns 404 and there is no API key.
- Keyless REST flow (used to verify iNeedEscrowV2):
  - `POST {base}/v1/explorer/verify_contract/check` `{"address":...}` → `{"already_verified":false}` = eligible.
  - `GET {base}/v1/explorer/verify_contract/{compiler_types,solidity_versions,evm_versions,license_types}` → pick strings (e.g. compiler `v0.8.20+commit.a1b79de6`, evm `paris`, license `MIT License (MIT)`, type `Solidity (Standard-Json-Input)`).
  - `POST {base}/v1/explorer/verify_contract/verify` with multipart fields: `address`, `compiler_type`, `license_type`, `evm_version`, `compiler_version`, `libraries={}`, `optimization`, `optimization_runs`, `constructor_arguments` (ABI-encoded), and the standard JSON input uploaded as a **file** under `files` (NOT `input_str` — `input_str` is only for single-file mode; JSON-input mode requires `files`).
  - Source JSON for `files` = `artifacts/build-info/a975c35426f312e2d1091aff427eaddb.json` `.input` (strip `outputSelection`). Repeat `check` → `already_verified:true` to confirm.
- Browser alternative: `https://atlantic.pharosscan.xyz/verify-contract` web form (also keyless).

### Testnet RPC caveats (for future on-chain scripts)
- Pharos testnet RPC is eventually consistent: `eth_call`/`eth_estimateGas` reads right after a confirmed write can return stale state for ~1-2s (e.g. stale revert reasons, stale balances). Mitigations used in `e2eEdgeV2.js`: explicit `gasLimit: 2000000n` on all writes, `expectRevert` retries up to 12×1.2s until expected reason, `readRetry` (exact-value poll) and `readRetryUntil` (condition poll) for state reads. Reuse these helpers in new scripts.
- ethers v6 API: `contract.method.estimateGas(...)`, NOT `contract.estimateGas.method(...)`.
- OZ v5.6.1 custom errors surface with `reason=null`; decode via selector (`0xfb8f41b2` = ERC20InsufficientAllowance, `0x52c63212` = ERC20InsufficientBalance).

### Blocked
- (none)

## Relevant Files
- `docs/ESCROW_CONTRACT_SPEC.md`: V2 spec with multi-asset design
- `docs/ESCROW_TEST_PLAN.md`: V2 test plan parameterized for native + USDC
- `docs/TECH_SPEC.md`: V2 technical specification
- `docs/FINAL_ARCHITECTURE.md`: V2 architecture
- `contracts/contracts/iNeedEscrow.sol`: V1 deployed contract (untouched)
- `contracts/contracts/iNeedEscrowV2.sol`: V2 contract with multi-asset support (done)
- `contracts/contracts/MockUSDC.sol`: Test ERC20 token (6 decimals)
- `contracts/test/iNeedEscrowV2.test.js`: 63 tests for V2
- `contracts/scripts/e2eTestV2.js`: on-chain E2E happy-path script (passed, tasks #1-3)
- `contracts/scripts/e2eEdgeV2.js`: on-chain edge-case suite, 53/53 passing, includes RPC staleness helpers
- `frontend/src/lib/abi.ts`: full iNeedEscrow ABI
- `frontend/src/lib/contract.ts`: contract address + config
- `frontend/src/lib/hooks/use-escrow.ts`: read/write hooks
