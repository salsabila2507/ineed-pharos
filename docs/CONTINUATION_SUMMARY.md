# iNeed Pharos — Project Continuation Summary

Status: **Testnet release validated and pushed to GitHub.**
Purpose: allow this VPS to be decommissioned and the project continued later from GitHub without losing context.
All details below are confirmed from the repository and from work completed so far (verified 2026-08-01). No secrets are included in this document.

---

## 1. Project Overview

iNeed is a decentralized task marketplace (bounty platform) on the Pharos blockchain. Users create tasks, fund them in escrow, participants accept and submit work, the creator selects winners, and rewards are released from escrow (2% platform fee). V2 adds multi-asset rewards: native PHRS and ERC20 USDC.

V2 is a **fresh deployment** (not a proxy upgrade of V1). V1 remains deployed and is intentionally untouched.

## 2. Current GitHub Repository and Branch

- Repo: `github.com/salsabila2507/ineed-pharos`
- Branch: `master`
- Latest commit: `5afe883` — "Deploy iNeedEscrowV2 multi-asset escrow with complete frontend task lifecycle"
- Working tree was clean at the time of writing; `master` is up to date with `origin/master`.

## 3. Current Architecture and Tech Stack

- **Contracts**: Hardhat (Solidity 0.8.20, optimizer on, runs 200, viaIR) — `contracts/`
- **Frontend**: Next.js 16.2.12 (App Router), React 19.2.4, TypeScript 5, Tailwind CSS v4 (`@tailwindcss/postcss`), wagmi v3, viem v2, @tanstack/react-query 5, zustand 5 — `frontend/`
- **Backend**: none yet (`backend/` is empty). Supabase/Postgres exists only as a planned off-chain indexer in `docs/`.
- Monorepo layout with per-directory package.json (no root package.json).

## 4. Pharos Network Configuration

- Network: **Pharos Atlantic Testnet**
- Chain ID: `688689`
- RPC: `https://atlantic.dplabs-internal.com`
- Explorer: `https://atlantic.pharosscan.xyz`
- Native token: **PHRS** (18 decimals); Pharos Pacific Mainnet is chain 1672 / PROS (defined in code, unused by the app)
- Caveat: testnet RPC is eventually consistent — post-write `eth_call` reads can be stale for ~1–2 s. Established mitigation helpers live in `contracts/scripts/e2eEdgeV2.js` (`expectRevert`, `readRetry`, `readRetryUntil`, explicit `gasLimit`).

## 5. Deployed Contracts

| Contract | Address | Notes |
|---|---|---|
| `iNeedEscrowV2` | `0x27D17774B2aeCe56C41140cFf99894Be36Ac661e` | **Verified on PharosScan** via keyless SocialScan REST API (no API key required). Confirmed `check` → `already_verified: true`. |
| `MockUSDC` | `0x396b9B29E9D98EC8630dCEa9B528c785AFE916FA` | Test ERC20, 6 decimals, mintable, OpenZeppelin-based |
| Real USDC | `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8` | 6 decimals, the production reward asset on testnet |
| Native PHRS | `0x0000000000000000000000000000000000000000` | `address(0)` = native in V2 |

Deployer = admin = feeTreasury = `0xaa2db706d3864751ea2879f141a3d2A626da3cF6`. Global fee config: `feeBps = 200` (2%), `maxFeeBps = 1000` (10% ceiling). Observed live on 2026-08-01: `nextTaskId = 106` (volatile runtime value, not a config constant).

## 6. Contract Status

- **Tests**: 138/138 passing — 75 V1 (`contracts/test/iNeedEscrow.test.js`) + 63 V2 (`contracts/test/iNeedEscrowV2.test.js`). Run with `cd contracts && npm test` (`hardhat test`).
- **On-chain E2E happy path** (`contracts/scripts/e2eTestV2.js`): passed. Native task #1 → Completed, MockUSDC task #2 → Completed, refund task #3 → Cancelled.
- **On-chain edge-case suite** (`contracts/scripts/e2eEdgeV2.js`): 53/53 passing (input validation, deposit/refund native+ERC20, unauthorized access, double-claim, state transitions, winner selection, disputes, ERC20 allowance/balance, submission deadline, fee/admin). Global state restored after run: `feeBps=200`, `treasury=deployer`, `admin=deployer`.
- **Important contract behavior**:
  - `TaskStatus` enum: `{ Created=0, Funded=1, Open=2, Accepted=3, Submitted=4, Review=5, Completed=6, Disputed=7, Resolved=8, Cancelled=9 }`.
  - Deposit: native via `msg.value == rewardTotal`; ERC20 via `approve` + `transferFrom` with `msg.value == 0`. Deposit requires status `Created`.
  - Fee 2% (`task.feeBps`, snapshotted at creation) is charged **only on successful release**, always in the same asset; refunds are fee-free.
  - `accept` allowed in Open(2)/Accepted(3); `submit` in Accepted(3)/Submitted(4) with deadline check; `startReview` requires Submitted(4) + ≥1 submission → Review(5); `selectWinners` requires Review(5), creator, winners must have accepted+submitted (Single requires exactly 1); `release` requires Review(5) + winnersSelected, multi-winner requires `winnerCount == numWinners` from rewardConfig; `refund` requires Funded(1)/Open(2) and `participantCount == 0` → Cancelled(9).
  - `autoResolve` (after reviewDeadline), `raiseDispute`/`resolveDispute` (admin), `setFeeBps`, `setFeeTreasury`, `transferAdmin` exist and are contract-tested.
  - Do **not** modify `contracts/contracts/iNeedEscrowV2.sol` (verified, deployed).

## 7. Frontend Status

Fully migrated to V2. Production build passes with zero errors.

- **Completed lifecycle (all wired and status-gated correctly):**
  `Create → Fund → Accept → Submit → Start Review → Select Winners → Release`
- **Refund flow**: creator can refund/cancel a funded-but-unaccepted task (Open, 0 participants) from the task detail page.
- **PHRS + MockUSDC/real USDC support**: create page has an asset selector (native PHRS or USDC) with approve-first flow for ERC20; funding card does allowance check + approve + deposit.
- **Wallet/network configuration**:
  - wagmi config uses only `pharosTestnet` (chain 688689), `ssr: true`, `http()` transport (hardcoded RPC).
  - Wallet connect is **injected connector only** (browser extension wallet, e.g. MetaMask). No WalletConnect/Coinbase/multi-wallet modal.
  - Wrong-network UI: dashboard + every action card show a "Switch" button calling `switchChain({ chainId: 688689 })`.

## 8. Important Frontend Files and Their Roles

- `frontend/src/lib/abi.ts` — full `iNeedEscrowV2` ABI + minimal ERC20 ABI (approve/balanceOf/allowance/decimals)
- `frontend/src/lib/contract.ts` — **single source of truth** for addresses (V2 escrow, MockUSDC, USDC, ZERO), CHAIN_ID, EXPLORER_URL
- `frontend/src/lib/chain.ts` — Pharos testnet (688689) + mainnet (1672) chain definitions
- `frontend/src/lib/wagmi.ts` — wagmi config (pharosTestnet only, ssr)
- `frontend/src/lib/hooks/use-escrow.ts` — read/write hooks (`useTaskDetails`, `useEscrowWrite`, etc.) and the 10-state `STATUS_NAMES` mapping
- `frontend/src/app/create/page.tsx` — task creation + deposit (native/ERC20, approve-first)
- `frontend/src/app/page.tsx` — dashboard (contract status: nextTaskId, feeBps, admin, wrong-network banner)
- `frontend/src/app/tasks/[taskId]/page.tsx` — task detail page assembling the lifecycle cards
- `frontend/src/app/components/task-funding-card.tsx` — task info, deposit, refund/cancel
- `frontend/src/app/components/task-accept-card.tsx` — accept (gated on Open/Accepted)
- `frontend/src/app/components/task-submission-card.tsx` — submit (hashed content)
- `frontend/src/app/components/task-winners-card.tsx` — startReview → selectWinners (exact count) → release → completed
- `frontend/src/app/components/wallet-connect.tsx` — injected-only connect/disconnect
- `frontend/src/app/components/site-header.tsx` — nav + wallet
- `frontend/src/app/providers.tsx` — WagmiProvider + QueryClientProvider

## 9. Deployment Status

- **Production build**: ✅ passes (`cd frontend && npm run build`). TypeScript clean. Routes: `/` and `/create` static, `/tasks/[taskId]` dynamic (server-rendered).
- **Runtime smoke test**: ✅ `/`, `/create`, `/tasks/1` all HTTP 200 with no SSR errors.
- **Vercel configuration**: none in-repo (no `vercel.json` needed). `next.config.ts` is empty → default Node.js server output (not static export, not standalone).
- **Root directory**: **`frontend`** (critical — package.json lives there; there is no root package.json).
- **Commands**: install `npm ci`, build `npm run build`, production serve `npm run start`. Node.js `>= 20.9.0` required (Next 16).
- **Environment variables required**: **none**. `process.env` is never referenced in `frontend/src`; all config is compile-time constants. No `.env` needed.
- Deployment options: Vercel (import repo, root `frontend`, auto-detect Next.js, no env vars) or a Node VPS (`npm ci && npm run build && npm run start`).

## 10. Git Status

- Latest commit: `5afe883` (pushed)
- Branch: `master` (tracks `origin/master`)
- Remote: `origin` → `https://github.com/salsabila2507/ineed-pharos.git`
- Note: the local remote URL in `.git/config` embeds a GitHub PAT; a plain URL (no token) is used above.

## 11. Known Non-Blocking Items

- `contracts/scripts/README.md` still documents V1 deploy/verify commands (historical; not updated).
- `autoResolve`, `raiseDispute`, `resolveDispute` have **no frontend UI** — they are contract-tested but only reachable via scripts/contracts (admin/timeout flows).
- Wallet connect is injected-only (no multi-wallet modal) — by design for this release.
- Submission card stays visible after review starts; a late submit reverts cleanly on-chain ("Task not accepting submissions").
- ESLint reports pre-existing `@typescript-eslint/no-explicit-any` errors across the codebase (uniform `as any` pattern; not enforced by the build).
- `opencode.json` (live API key) is excluded from the repo via root `.gitignore` — not committed.

## 12. Known Historical/V1 Files (Do Not Mistake for Active V2)

- `contracts/contracts/iNeedEscrow.sol` — V1 contract, deployed at `0x1c169071cB32033c13305902704E5A0C6c658C89`; **do not modify**
- `contracts/scripts/deploy.js`, `contracts/scripts/README.md` — V1 deploy tooling/docs
- `contracts/test/iNeedEscrow.test.js` — V1 tests (75)
- `contracts/deployment.json` → `v1` key — historical V1 record (block 27165611); top-level keys now describe the V2 deployment
- Active V2 config lives in `frontend/src/lib/contract.ts` and the verified `contracts/contracts/iNeedEscrowV2.sol`; active deploy scripts are `contracts/scripts/deployV2.js`, `e2eTestV2.js`, `e2eEdgeV2.js`.

## 13. Exact Next Step When Continuing

1. `git clone` the repo, `cd frontend && npm ci && npm run build` (Node ≥ 20.9.0).
2. To redeploy the frontend: Vercel import with root directory `frontend`, or VPS `npm run start`. No env vars needed.
3. If contract work resumes: `cd contracts && npm test` (expect 138 passing). For on-chain scripts, recreate `contracts/.env` from `contracts/.env.example` (see §14) and use the mitigation helpers in `e2eEdgeV2.js`.
4. Verify against the live testnet: chain 688689, `iNeedEscrowV2` at `0x27D17774B2aeCe56C41140cFf99894Be36Ac661e`, USDC at `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8`.

## 14. VPS-Specific Information That Must NOT Be Committed to GitHub

This section names items so future maintainers know they exist locally on the VPS, but **never include the values**:

- The absolute repo path on the VPS (`/home/ubuntu/ineed-pharos`).
- `contracts/.env` on the VPS contains the deployer wallet **private key** and RPC URLs. It is gitignored (`contracts/.gitignore`) and never committed. Recreate it from `contracts/.env.example` if lost; do not put the real key in any committed file.
- The GitHub remote URL in the VPS's `.git/config` embeds a **personal access token**. Use the plain `https://github.com/salsabila2507/ineed-pharos.git` URL elsewhere; never copy the tokenized URL into shared docs.
- `opencode.json` at the repo root previously contained a live API key and is gitignored — keep it out of Git.

## 15. Security Notes

- `contracts/.env` holds the deployer private key — gitignored, never committed, never shared.
- `opencode.json` held a live API key and is gitignored (excluded from the repo).
- No secrets appear in this summary; secret values are referenced only by location, never printed.
- Never commit `contracts/.env`, `opencode.json`, or any token/password/API key to GitHub.
