# iNeed Agent Marketplace — Final Architecture

## 1. Frontend Architecture

### Stack
- **Framework**: Next.js (React, SSR for SEO on task listings)
- **Wallet**: wagmi + viem for Pharos wallet connection (MetaMask and any EVM wallet via Chain ID / RPC)
- **State**: React Query for server state, Zustand for client state
- **UI**: Tailwind CSS + shadcn/ui components
- **Network Config**: Mainnet Chain ID `1672` (PROS), Testnet Chain ID `688689` (PHRS)

### Page Structure

```
/                          Landing / explorer (browse open tasks)
/dashboard                 Creator & participant task management
/tasks/[id]                Task detail, submission, review
/profile/[wallet]          User / agent profile + reputation
/admin                     Dispute queue, task oversight
/agents/new                Register an AI agent
```

### Page Responsibilities

| Page | Purpose |
|---|---|
| Explorer | List all open tasks with filters (reward, deadline, tags). Read-only for unauthenticated visitors. |
| Dashboard | Two views: tasks I created, tasks I accepted. Status badges, action buttons (submit, review, approve). |
| Task Detail | Full description, submission form (link upload), submission list with review controls for creator. Winner selection trigger. |
| Profile | Wallet-linked profile showing agent(s), reputation score, task history. |
| Admin | Dispute queue — list open disputes, evidence review, ruling form (payout or refund). |
| Agent Registration | Form to register an AI agent with name, description, capabilities, and icon. |

### Client → Contract Interaction

- Reads: use contract `view` functions for task details via wagmi + viem
- Writes: direct `writeContract` calls for deposit, accept, submit, approve, dispute
- Frontend never holds private keys — all transactions signed by user's wallet

---

## 2. Backend Architecture

### Stack
- **Runtime**: Node.js with Fastify
- **API style**: RESTful
- **Database**: PostgreSQL via Prisma ORM

### Service Map

```
Client ──► Fastify Router
                │
        ┌───────┼───────────────┐
        │       │               │
   Auth Svc  Task Svc      Agent Svc
        │       │               │
   Dispute Svc  │         Reward Svc
        └───────┴───────────────┘
                │
          Postgres DB
```

### Service Responsibilities

| Service | Responsibility |
|---|---|
| Auth | Wallet signature verification (SIWE / EIP-4361). Issues session token. No email/password. |
| Task | CRUD for tasks. Status transitions. Deadline enforcement. Syncs on-chain task IDs to DB. |
| Reward | Computes payout splits. Triggers `release()` on escrow contract. Records distribution in DB. |
| Dispute | Manages dispute lifecycle (open, under review, resolved). Admin-only ruling endpoints. |
| Agent | CRUD for agent profiles. Links agent to owner wallet. Off-chain metadata storage. |

### Endpoints (MVP)

```
POST   /auth/challenge          Generate SIWE challenge
POST   /auth/verify             Verify signature, return session

GET    /tasks                    List open tasks (paginated, filtered)
POST   /tasks                    Create task (signed tx hash)
GET    /tasks/:id                Task detail
POST   /tasks/:id/accept         Accept task

POST   /tasks/:id/submissions    Upload submission link
GET    /tasks/:id/submissions    List submissions

POST   /tasks/:id/review         Approve / reject submission
POST   /tasks/:id/select-winner  Trigger winner selection

GET    /disputes                 List disputes (admin)
POST   /disputes                 Raise dispute
POST   /disputes/:id/resolve     Admin ruling

GET    /agents                   List registered agents
POST   /agents                   Register agent
GET    /agents/:id               Agent detail + reputation

GET    /reputation/:wallet       Get reputation score + breakdown
```

### Syncing with On-chain State

- Backend tracks task status in Postgres as the source of truth for UI queries
- On-chain events (TaskCreated, DepositConfirmed, RewardReleased) are consumed by the backend via Pharos RPC polling
- Webhook/listener updates the corresponding DB record status
- For MVP: simpler polling approach — backend checks contract state on each relevant request

---

## 3. Database Layer

### Stack
- **Engine**: PostgreSQL with pgcrypto (UUID generation)
- **ORM**: Prisma
- **No cache layer** in MVP (Redis deferred to post-MVP)

### Entity-Relationship

```
users ──1:N──> tasks (creator)
users ──1:N──> submissions (participant)
users ──1:N──> disputes (raiser)
users ──1:N──> agents (owner)

tasks ──1:N──> submissions
tasks ──1:N──> rewards
tasks ──1:N──> disputes

agents ──1:N──> submissions
agents ──1:N──> reputation (nullable agent_id)

users ──1:1──> reputation (nullable user_id)
```

### Core Tables

#### `users`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| wallet | VARCHAR(42) | Unique, indexed |
| username | VARCHAR(50) | |
| avatar_url | TEXT | |
| role | ENUM | `user` or `admin` |
| created_at | TIMESTAMPTZ | |

#### `agents`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| owner_id | UUID FK | References users |
| name | VARCHAR(100) | |
| description | TEXT | |
| capabilities | JSONB | Structured capability list |
| icon_url | TEXT | |
| is_active | BOOLEAN | |
| created_at | TIMESTAMPTZ | |

#### `tasks`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| onchain_id | BIGINT | Indexed |
| creator_id | UUID FK | References users |
| title | VARCHAR(200) | |
| description | TEXT | |
| reward_total | NUMERIC | In native token |
| reward_model | ENUM | `single` or `multiple` |
| reward_config | JSONB | Split weights, num_winners |
| winner_selection | ENUM | `creator_select`, `random_select`, `score_based`, `auto_timeout` |
| deadline | TIMESTAMPTZ | |
| status | ENUM | created → funded → open → accepted → submitted → review → completed / disputed → resolved / cancelled |
| max_participants | INTEGER | Null = unlimited |
| tags | TEXT[] | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

#### `submissions`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| task_id | UUID FK | |
| participant_id | UUID FK | References users or agents |
| participant_type | ENUM | `human` or `agent` |
| content_url | TEXT | Link to submitted work |
| description | TEXT | |
| status | ENUM | `pending`, `accepted`, `rejected`, `disputed` |
| rating | SMALLINT | 1-5, null until reviewed |
| review_note | TEXT | |
| submitted_at | TIMESTAMPTZ | |

#### `rewards`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| task_id | UUID FK | |
| submission_id | UUID FK | Nullable |
| recipient_id | UUID FK | Users or agents |
| recipient_type | ENUM | `human` or `agent` |
| amount | NUMERIC | |
| distribution_tx | VARCHAR(66) | On-chain tx hash |
| model | ENUM | `single` or `multiple` |
| paid_at | TIMESTAMPTZ | |

#### `disputes`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| task_id | UUID FK | |
| submission_id | UUID FK | Nullable |
| raised_by | UUID FK | |
| reason | TEXT | |
| evidence_urls | TEXT[] | |
| status | ENUM | `open`, `under_review`, `resolved`, `rejected` |
| ruling | ENUM | `in_favor_of_creator`, `in_favor_of_participant`, `split` |
| resolved_by | UUID FK | Admin |
| created_at | TIMESTAMPTZ | |
| resolved_at | TIMESTAMPTZ | |

#### `reputation`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK | Nullable (either user or agent) |
| agent_id | UUID FK | Nullable (either user or agent) |
| total_tasks | INTEGER | |
| successful_tasks | INTEGER | |
| failed_tasks | INTEGER | |
| total_earned | NUMERIC | |
| avg_rating | DECIMAL(3,2) | |
| disputes_lost | INTEGER | |
| reliability_score | DECIMAL(5,2) | Computed 0-100 |
| last_updated | TIMESTAMPTZ | |

---

## 4. Smart Contract Layer

### Contract Design (MVP)

MVP consolidates logic into **2 contracts** to reduce deployment complexity and audit surface.

### Contract A: `iNeedEscrowV2`

Single contract handling task registry, multi-asset escrow, and reward distribution.

```
iNeedEscrowV2
├── Task storage (mapping taskId → Task struct)
├── Escrow storage (mapping taskId → Escrow struct)
├── createTask(title, description, rewardTotal, rewardAsset, rewardModel, winnerSelection, rewardConfig, deadline, maxParticipants)
├── deposit(taskId)                              ← Native: msg.value == rewardTotal; ERC20: pulls via transferFrom
├── accept(taskId)                                ← Reserve a slot as participant
├── submit(taskId, contentUrl)                    ← Upload work
├── selectWinners(taskId, recipients)              ← Creator selects winner(s)
├── release(taskId)                               ← Distribute rewards in the task's asset
├── refund(taskId)                                 ← Creator cancels (no work started)
├── raiseDispute(taskId)                           ← Participant challenges rejection
├── resolveDispute(taskId, ruling, recipient, amount) ← Admin only
└── Events: TaskCreated, TaskFunded, TaskAccepted, SubmissionUploaded, WinnersSelected, RewardReleased, TaskRefunded, DisputeRaised, DisputeResolved
```

### Contract B: `iNeedAgentRegistry`

Agent identity and metadata registry (unchanged from V1).

```
iNeedAgentRegistry
├── register(ownerWallet, name, description, icon, capabilities)
├── updateMetadata(agentId, ...)
├── deactivate(agentId)
├── getAgent(agentId) → AgentProfile
└── Events: AgentRegistered, AgentUpdated, AgentDeactivated
```

### On-chain Data Structures (Solidity)

```solidity
enum TaskStatus { Created, Funded, Open, Accepted, Submitted, Review, Completed, Disputed, Resolved, Cancelled }
enum RewardModel { Single, Multiple }
enum WinnerSelection { CreatorSelect, RandomSelect, ScoreBased, AutoTimeout }

struct Task {
    address creator;
    uint256 rewardTotal;
    address rewardAsset;             // address(0) = native PHRS, else ERC20 token
    RewardModel rewardModel;
    WinnerSelection winnerSelection;
    bytes rewardConfig;
    uint256 deadline;
    TaskStatus status;
    uint256 maxParticipants;
    address[] participants;
    address[] submissions;
}

struct Escrow {
    uint256 totalAmount;
    uint256 releasedAmount;
    uint256 refundedAmount;
    address disputeResolver;
}

struct AgentProfile {
    address ownerWallet;
    string name;
    string description;
    string icon;
    bytes capabilities;
    bool isActive;
    uint256 createdAt;
}
```

### Deploy & Upgrade

- **Network**: Pharos Atlantic Testnet (Chain ID: `688689`) first, then Pacific Mainnet (Chain ID: `1672`) after audit
- **Frameworks**: Hardhat (officially supported) or Foundry (officially supported) — both with Pharos RPC config
- **Language**: Solidity — Pharos is fully EVM-compatible
- **Verification**: PharosScan block explorer API for source code verification
- **Testnet RPC**: `https://atlantic.dplabs-internal.com`
- **Mainnet RPC**: `https://rpc.pharos.xyz`
- **Upgrade**: Initial deploy is immutable (no proxy in MVP); upgrade via multi-sig migration if needed

---

## 5. Wallet Flow

### Connection

```
1. User clicks "Connect Wallet"
2. Frontend calls window.ethereum.request({ method: 'eth_requestAccounts' })
3. wagmi detects account, network (Pharos)
4. If wrong network, prompt to switch via wallet_switchEthereumChain
5. On success: app reads wallet address, checks back-end for existing user
```

### Authentication (SIWE)

```
1. Frontend requests GET /auth/challenge
2. Backend returns { message: "Sign this message to prove your identity...", nonce }
3. Frontend calls wallet.signMessage(message)
4. Frontend POSTs { signature, message } to /auth/verify
5. Backend verifies: recovered address === signature.signer
6. Backend issues session token (JWT or httpOnly cookie)
7. Frontend stores token and uses it for authenticated requests
```

### Transaction Flow

```
1. User takes action (e.g., "Create Task")
2. Frontend builds transaction parameters:
   - contractAddress: iNeedEscrowV2
   - functionName: deposit (or createTask + deposit)
   - args: [taskId]
   - value: rewardTotal (native) or 0 (ERC20)
3. For ERC20 tasks: user must first approve the contract to spend USDC via IERC20.approve()
4. wagmi calls wallet.sendTransaction() — wallet opens confirmation modal
5. User confirms in wallet
6. Frontend waits for tx receipt (txHash)
7. Frontend POSTs /tasks with { onchain_id: taskId, txHash, ... }
8. Backend validates tx on-chain, creates DB record
```

### Wallet Disconnect

```
1. User clicks "Disconnect"
2. Frontend clears session token
3. wagmi disconnects provider
4. User reverts to unauthenticated state (can browse, cannot act)
```

---

## 6. Task Lifecycle

### State Flow (MVP)

```
                    ┌──────────┐
                    │ Created  │  Creator drafts task, no funds
                    └────┬─────┘
                         │ Creator sends deposit tx
                         │ Native: msg.value == rewardTotal
                         │ ERC20: contract pulls rewardTotal via transferFrom
                    ┌────▼─────┐
                    │  Funded  │  Reward locked in escrow (same asset)
                    └────┬─────┘
                         │ Participant accepts (on-chain)
                    ┌────▼──────┐
                    │ Accepted  │  Slot reserved
                    └────┬──────┘
                         │ Work submitted (content URL)
                    ┌────▼──────┐
                    │ Submitted │  Notification sent to creator
                    └────┬──────┘
                         │ Winner selection triggered
                    ┌────▼──────┐
                    │  Review   │  Creator evaluates
                    └────┬──────┘
                    ┌─────┴──────────┐
                    │                │
               ┌────▼──────┐   ┌────▼──────┐
               │Completed  │   │ Disputed  │
               └────┬──────┘   └────┬──────┘
                    │               │ Admin resolves
                    │          ┌────▼──────┐
                    │          │ Resolved  │
                    │          └───────────┘
                    ▼
              ┌──────────┐
              │   Done   │
              └──────────┘
```

### State Transitions

| From | To | Trigger | Who |
|---|---|---|---|
| created | funded | `deposit()` tx confirmed | Creator (on-chain) |
| funded | open | Automatic post-funding | System |
| open | accepted | `accept()` called | Participant |
| accepted | submitted | `submit()` called | Participant |
| submitted | review | Automatic post-submit | System |
| review | completed | `selectWinner()` + `release()` | Creator / System |
| review | disputed | `raiseDispute()` | Participant |
| disputed | resolved | `resolveDispute()` | Admin |
| funded | cancelled | `refund()` | Creator |
| open | cancelled | `refund()` | Creator |
| review | completed | `auto_timeout` trigger | System (cron) |

### Action Permissions

| Action | Who can perform |
|---|---|
| Create / Fund | Any connected wallet |
| Accept | Any wallet (unless task has max_participants limit) |
| Submit | User who accepted the task |
| Select winner | Creator (or system on auto-timeout) |
| Approve / Release | Creator |
| Raise dispute | Participant whose submission was rejected |
| Resolve dispute | Admin wallet only |
| Cancel / Refund | Creator (before any acceptance) |

---

## 7. Reward Flow

### High-level Sequence

```
Creator                Escrow Contract            Participant(s)
   │                        │                          │
   │── deposit(taskId) ────►│                          │
   │     (locks funds)      │                          │
   │                        │                          │
   │                        │◄──── accept(taskId) ─────│
   │                        │                          │
   │                        │◄──── submit(taskId) ─────│
   │                        │                          │
   │── selectWinner() ─────►│                          │
   │                        │                          │
   │── release(taskId) ────►│                          │
   │                        │── transfer(winner) ─────►│
   │                        │                          │
   │                  Event: RewardReleased             │
```

### Single Winner Flow

```
1. Creator reviews submissions (via UI)
2. Creator calls selectWinner(taskId, selectionParams, winnerAddress)
   OR system triggers selectWinner for random_select / auto_timeout
3. Escrow contract records selected winner
4. Creator calls release(taskId)
5. Escrow transfers full rewardTotal to winner address using the task's rewardAsset:
   - address(0): call{value: amount}(recipient)
   - ERC20: IERC20(rewardAsset).transfer(recipient, amount)
6. 2% fee sent to treasury in same asset
7. Event RewardReleased(taskId, winner, amount, asset) emitted
8. Backend listener records reward in DB
9. All other submissions marked as rejected
```

### Multiple Winners Flow

```
1. Creator or system selects N winners
2. For each winner, reward split is computed:
   - "equal": rewardTotal / N
   - "weighted": rewardTotal * (weight_i / sum_of_weights)
3. Creator calls release(taskId) — contract iterates recipients array
4. Escrow transfers each amount to corresponding recipient in the task's rewardAsset
5. Fee (2% of total) sent to treasury in the same asset
6. Event emitted per recipient (with asset address)
7. Backend creates N reward records
8. Non-winners marked as rejected
```

### Reward Data Flow (Backend)

```
selectWinner/release tx
        │
        ▼
Backend listens for RewardReleased event
        │
        ▼
Parses event: { taskId, recipients[], amounts[] }
        │
        ▼
Inserts row(s) into `rewards` table
        │
        ▼
Updates `submissions` status → accepted/rejected
        │
        ▼
Updates `tasks` status → completed
        │
        ▼
Updates `reputation` for each participant
```

---

## 8. Winner Selection Flow

### 8.1 Creator Select

```
1. Deadline passes (or creator decides early)
2. Creator navigates to task detail page
3. UI shows all submissions with "Select as Winner" button per submission
4. Creator clicks button → wallet prompts selectWinner() tx
5. For multiple winners: creator selects N submissions, confirms order/weights
6. Contract records { taskId, method: CreatorSelect, winner: address }
7. Creator then calls release() to execute payout
8. If creator does not act before auto_timeout deadline, system triggers
   auto_timeout fallback
```

### 8.2 Random Select

```
1. Deadline passes
2. Creator or anyone can trigger selectWinner(taskId, RandomSelect, ...)
   (configurable — permissionless or creator-only)
3. Contract uses block hash at a future block as entropy source:
   - Request random: store request block number
   - Fulfill: use blockhash(requestBlock + 1) mod num_submissions
4. For commit-reveal: each participant commits a hash, then reveals
   - Combined entropy = XOR of all reveals
   - Winner = combined_entropy mod num_submissions
5. Selected entrant is recorded as winner
6. Winner can claim reward (or system auto-releases)
```

### 8.3 Auto Selection (Timeout)

```
1. Task reaches its auto_timeout deadline (separate from submission deadline)
2. Creator has not selected any winner
3. Anyone (or cron) calls resolveTimeout(taskId)
4. Contract executes default_action:
   - "pay_all":   rewardTotal / numSubmissions to each submitter
   - "refund":    full amount back to creator
   - "first_submission": reward to earliest submitted work
5. Task moves to completed (or cancelled for refund)
6. Backend records the outcome
```

### Selection Method Comparison

| Method | Trust Model | Best For | Gas Cost |
|---|---|---|---|
| Creator Select | Trusts creator judgment | Creative, subjective tasks | Low (1-2 writes) |
| Random Select | Trusts on-chain entropy | Raffles, fair chance | Medium (VRF) |
| Score Based | Trusts scoring criteria | Objective, measurable | Medium (needs scores) |
| Auto Timeout | Trustless fallback | Preventing stuck funds | Low (1 write) |

### MVP Deployment

| Method | In MVP? | Notes |
|---|---|---|
| Creator Select | Yes | Primary flow for all task types |
| Random Select | Yes | On-chain block hash entropy |
| Score Based | Post-MVP | Requires scoring UI and threshold logic |
| Auto Timeout | Yes | Cron-based or permissionless trigger after review window expires |
