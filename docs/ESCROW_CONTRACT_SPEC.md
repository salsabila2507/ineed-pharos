# iNeedEscrow — Smart Contract Specification

## 1. Purpose

`iNeedEscrow` is the core smart contract of the iNeed marketplace. It manages the full lifecycle of a task bounty on-chain: creation with locked funds, participant acceptance, work submission, winner selection, reward distribution, refunds, and dispute resolution.

The contract acts as a trustless intermediary — funds are locked at task creation and only released according to predetermined rules or admin resolution. No party can withdraw funds unilaterally outside the defined state transitions.

### Scope

- Task registry and status tracking
- Escrow deposit, release, and refund
- Reward distribution (single winner, multiple winners)
- Winner selection (creator select, auto timeout)
- Dispute management with admin override

### Out of Scope (separate contracts)

- Agent identity registry (`iNeedAgentRegistry`)
- On-chain reputation scoring (post-MVP)

---

## 2. Task Data Structure

### Core Types

```
TaskStatus : enum
  Created → Funded → Open → Accepted → Submitted → Review → Completed
                                                          → Disputed → Resolved
                                                                     → Cancelled

RewardModel : enum
  Single     — entire reward to one winner
  Multiple   — reward split among N winners

WinnerSelection : enum
  CreatorSelect  — creator manually picks winner(s)
  RandomSelect   — on-chain entropy draws winner(s)
  ScoreBased     — determined by scores (post-MVP)
  AutoTimeout    — fallback when creator does not act
```

### Task Struct

Each task is stored as an on-chain struct keyed by a monotonically increasing `taskId`.

| Field | Type | Description |
|---|---|---|
| creator | address | Wallet that created and funded the task |
| rewardTotal | uint256 | Total locked amount in native token (wei) |
| rewardModel | RewardModel | Single or Multiple |
| rewardConfig | bytes | Encoded parameters (numWinners, weights, etc.) |
| winnerSelection | WinnerSelection | Method for selecting winner(s) |
| deadline | uint256 | Unix timestamp — submissions close after this |
| reviewDeadline | uint256 | Unix timestamp — creator must select winner by this |
| status | TaskStatus | Current lifecycle state |
| maxParticipants | uint256 | Max acceptances (0 = unlimited) |
| participantCount | uint256 | Current number of accepted participants |
| submissionCount | uint256 | Current number of submissions received |
| feeBps | uint16 | Platform fee in basis points snapshot at task creation (e.g. 200 = 2%) |
| feeTreasury | address | Treasury address snapshot at task creation |

### Escrow Struct

Separate escrow tracking per task for accounting transparency.

| Field | Type | Description |
|---|---|---|
| totalAmount | uint256 | Amount initially deposited |
| releasedAmount | uint256 | Total paid out to winner(s) |
| refundedAmount | uint256 | Total returned to creator |
| feeCollected | uint256 | Total platform fee collected from this task |

### Participant Tracking

The contract maintains two parallel data structures per task:

- `participants[]` — ordered list of accepted participant addresses
- `submissions[]` — ordered list of submission metadata (submitter address, content URI hash, timestamp)

A mapping tracks which addresses have already accepted to prevent duplicates.

```
mapping(uint256 → address[])  public participants
mapping(uint256 → Submission[]) public submissions

struct Submission {
    address submitter;
    bytes32 contentHash;
    uint256 timestamp;
    bool isWinner;
}
```

---

## 3. Task Lifecycle States

```
                    ┌─────────────┐
                    │   Created   │  Creator calls createTask()
                    └──────┬──────┘
                           │ deposit() sent with msg.value
                    ┌──────▼──────┐
                    │   Funded    │  Reward locked, task visible
                    └──────┬──────┘
                           │ accept() called by participant
                    ┌──────▼───────┐
                    │   Accepted   │  Slot reserved
                    └──────┬───────┘
                           │ submit() called with contentHash
                    ┌──────▼───────┐
                    │  Submitted   │  Submission recorded
                    └──────┬───────┘
                           │ Deadline passes or creator triggers review
                    ┌──────▼───────┐
                    │    Review    │  Winner selection window open
                    └──────┬───────┘
                    ┌──────┴──────────┐
                    │                 │
               ┌────▼──────┐   ┌─────▼──────┐
               │ Completed │   │  Disputed  │  Participant contests
               └────┬──────┘   └─────┬──────┘
                    │                │ Admin resolves
                    │           ┌────▼──────┐
                    │           │ Resolved  │
                    │           └───────────┘
                    ▼
              ┌──────────┐
              │   Done   │
              └──────────┘
```

### State Transition Rules

| From | To | Trigger | Guard |
|---|---|---|---|
| Created | Funded | `deposit(taskId)` | Must be called by creator; `msg.value == rewardTotal` |
| Funded | Open | Automatic in `deposit()` | None |
| Open | Accepted | `accept(taskId)` | `participantCount < maxParticipants` or maxParticipants == 0 |
| Open | Cancelled | `refund(taskId)` | Only before any participant accepts |
| Accepted | Submitted | `submit(taskId, contentHash)` | Caller must be an accepted participant |
| Submitted | Review | Automatic when deadline passes OR creator calls `startReview(taskId)` | At least one submission exists |
| Review | Completed | `selectWinner()` + `release()` | Winner(s) selected and funds released |
| Review | Disputed | `raiseDispute(taskId)` | Caller must be a rejected participant |
| Disputed | Resolved | `resolveDispute(...)` | Admin only; payout or refund |
| Review | Completed | Auto timeout triggers `autoResolve(taskId)` | reviewDeadline passed, creator did not act |

---

## 4. Reward Handling

### 4.1 Single Winner

**Config**: `rewardConfig = abi.encode(true)` (winner_takes_all flag)

**Flow**:
1. Winner selection runs (creator picks or auto-timeout resolves)
2. The single winner's address is recorded on-chain
3. Creator (or system) calls `release(taskId)`
4. Contract computes `fee = calculateFee(task.rewardTotal)`
5. Contract transfers `rewardTotal - fee` to the winner
6. Contract transfers `fee` to the treasury
7. Task status moves to Completed

**Edge cases**:
- If only one participant submitted, that participant is the sole candidate
- If no submissions exist, `release()` reverts

### 4.2 Multiple Winners

**Config**:
```solidity
rewardConfig = abi.encode(
    uint256 numWinners,       // N
    bool splitEqual,          // true = equal split, false = weighted
    uint256[] weights         // only used if splitEqual == false
)
```

**Flow for equal split**:
1. N winners are selected
2. `fee = calculateFee(task.rewardTotal)`
3. `payoutPool = task.rewardTotal - fee`
4. `rewardPerWinner = payoutPool / N`
5. Contract iterates winner addresses, transfers `rewardPerWinner` to each
6. Any remainder (due to integer division) stays in contract or goes to platform
7. `fee` is transferred to treasury

**Flow for weighted split**:
1. N winners are selected with assigned weights
2. `fee = calculateFee(task.rewardTotal)`
3. `payoutPool = task.rewardTotal - fee`
4. `weightSum = sum(weights)`
5. Each winner receives `payoutPool * weight_i / weightSum`
6. Residual dust is allocated to the last winner or platform
7. `fee` is transferred to treasury

**Guard conditions**:
- `numWinners ≤ submissionCount`
- All winner addresses must be unique
- Must have at least one winner

---

## 5. Winner Selection

### 5.1 Creator Select

**Config**: `winnerSelection = CreatorSelect`

**Flow**:
1. Task reaches Review state (submissions closed)
2. Creator calls `selectWinners(taskId, winnerAddresses[])`
3. Contract validates:
   - Caller is `task.creator`
   - All addresses are valid participants with submissions
   - Array length matches expected number of winners
4. Selected submissions are marked `isWinner = true`
5. Others remain rejected (eligible for dispute)
6. Creator then calls `release(taskId)` to execute payout

**Gas optimization**: For tasks with many submissions, creator can submit winner addresses in batches.

### 5.2 Auto Timeout

**Config**:
```solidity
winnerSelection = AutoTimeout
rewardConfig = abi.encode(
    AutoTimeoutAction action,  // PayAll, Refund, FirstSubmission
    uint256 reviewDeadline     // seconds after submission deadline
)
```

**AutoTimeoutAction enum**:
- `PayAll` — reward split equally among all submitters
- `Refund` — full reward returned to creator
- `FirstSubmission` — reward goes to earliest valid submission

**Flow**:
1. Submission deadline passes, task moves to Review
2. Creator has until `reviewDeadline` to call `selectWinners()`
3. If creator does not act, anyone can call `autoResolve(taskId)` after `reviewDeadline`
4. Contract automatically executes the configured default action
5. Task moves to Completed (or Cancelled for Refund)

**Fee handling per action**:
- `PayAll`: fee is deducted from total, remaining pool split equally among submitters
- `Refund`: full balance returned to creator, no fee deducted
- `FirstSubmission`: fee is deducted, remaining amount sent to earliest submitter

**Security**: `autoResolve` is permissionless — any address can trigger it. This prevents funds from being permanently locked if the creator goes offline.

---

## 6. Platform Fee System

### Fee Model

- Fee is deducted **only on successful reward release** (not on refund)
- Winner receives the reward **after** fee deduction
- Treasury receives the collected fee in the same transaction

### Example

```
Task reward: 100 USDC
Platform fee (2%): 2 USDC
Winner receives: 98 USDC
Treasury receives: 2 USDC
```

### Global Configuration

Stored as contract-level state, adjustable by admin.

| Parameter | Type | Default | Max | Description |
|---|---|---|---|---|
| `feeBps` | uint16 | 200 | 1000 | Platform fee in basis points (200 = 2%) |
| `feeTreasury` | address | deployer | — | Address that collects all platform fees |
| `maxFeeBps` | uint16 | 1000 | 1000 | Absolute ceiling (1000 bps = 10%), immutable |

### Guards

- `feeBps ≤ maxFeeBps` — enforced on every update
- `maxFeeBps` is set at deploy time and **never changes**
- `feeTreasury` must be a non-zero address
- Fee percentage is snapshotted into each `Task` struct at creation — changing the global fee later never affects already-funded tasks

### Admin Functions (abstract)

```solidity
function setFeeBps(uint16 newFeeBps) external;

function setFeeTreasury(address newTreasury) external;
```

### Fee Update Rules

- `setFeeBps`: admin only; reverts if `newFeeBps > maxFeeBps`
- `setFeeTreasury`: admin only; reverts if `newTreasury == address(0)`
- Changes apply to newly created tasks only — existing tasks retain their snapshotted fee

### Fee Calculation

```solidity
function calculateFee(uint256 amount) public view returns (uint256) {
    return amount * feeBps / 10000;
}
```

The fee is always calculated as a proportion of the **total reward at task creation**, not the released amount. This ensures deterministic accounting regardless of how many winners are paid.

### Fee Distribution During Release

1. Compute `fee = calculateFee(task.rewardTotal)`
2. Compute `payoutPool = task.rewardTotal - fee`
3. Distribute `payoutPool` among winner(s) according to reward model
4. Transfer `fee` to `task.feeTreasury`
5. Emit `PlatformFeeCollected(taskId, fee, feeTreasury)`

---

## 7. Deposit Flow

### Sequence

```
Creator                     iNeedEscrow
   │                             │
   │  1. createTask(metadata)    │
   │────────────────────────────►│  Assigns taskId, status = Created
   │                             │
   │  2. deposit(taskId)         │
   │     msg.value = rewardTotal │
   │────────────────────────────►│  Locks funds, status = Funded → Open
   │                             │  Emits TaskCreated, TaskFunded
```

### Function Signature (abstract)

```solidity
function createTask(
    uint256 rewardTotal,
    RewardModel rewardModel,
    bytes calldata rewardConfig,
    WinnerSelection winnerSelection,
    uint256 deadline,
    uint256 maxParticipants
) external returns (uint256 taskId);

function deposit(uint256 taskId) external payable;
```

### Validation

- `createTask`: `rewardTotal > 0`, `deadline > block.timestamp`
- `deposit`: `msg.value == task.rewardTotal`, caller is `task.creator`, task is in Created state
- At creation, the current global `feeBps` and `feeTreasury` are snapshotted into the task — subsequent fee config changes do not affect this task

---

## 8. Release Flow

### Sequence

```
Creator                     iNeedEscrow                 Winner(s)         Treasury
   │                             │                          │                 │
   │  1. selectWinners(id, [])  │                          │                 │
   │────────────────────────────►│  Marks isWinner flags   │                 │
   │                             │                          │                 │
   │  2. release(taskId)         │                          │                 │
   │────────────────────────────►│                          │                 │
   │                             │  Calculate fee           │                 │
   │                             │  payoutPool = total - fee│                 │
   │                             │                          │                 │
   │                             │── transfer(winnerAmt) ──►│                 │
   │                             │                          │                 │
   │                             │── transfer(fee) ────────────────────────►│
   │                             │  Emit RewardReleased     │                 │
   │                             │  Emit PlatformFeeCollected               │
   │                             │  Status → Completed     │                 │
```

### Function Signature (abstract)

```solidity
function selectWinners(
    uint256 taskId,
    address[] calldata winnerAddresses,
    bytes calldata proof
) external;

function release(uint256 taskId) external;
```

### Release Internal Logic

```
1. fee = calculateFee(task.rewardTotal)
2. payoutPool = task.rewardTotal - fee
3. For single winner:
     winnerAmount = payoutPool
     transfer(winner, winnerAmount)
4. For multiple winners (equal):
     winnerAmount = payoutPool / numWinners
     for each winner: transfer(winner, winnerAmount)
5. For multiple winners (weighted):
     for each winner: transfer(winner, payoutPool * weight_i / weightSum)
6. transfer(task.feeTreasury, fee)
7. task.status = Completed
```

### Validation

- `selectWinners`: caller is creator, task in Review state, all addresses are valid submitters
- `release`: winners selected, task in Review state, not disputed
- Cannot release more than the locked balance
- Payout must leave enough balance for the platform fee
- Fee is sent to the treasury address snapshotted in the task

---

## 9. Refund Flow

### Sequence

```
Creator                     iNeedEscrow
   │                             │
   │  refund(taskId)             │
   │────────────────────────────►│
   │                             │  Validate cancellable state
   │                             │  Transfer full balance to creator
   │                             │  Emit TaskRefunded
   │◄────────────────────────────│  Status → Cancelled
```

### When Refund Is Allowed

| Task Status | Refundable? | Reason |
|---|---|---|
| Created | Yes | No funds deposited yet (no-op) |
| Funded / Open | Yes | No work started |
| Accepted | No | Work may be in progress |
| Submitted / Review | No | Work has been delivered |
| Disputed | No | Must be resolved first |

### Function Signature (abstract)

```solidity
function refund(uint256 taskId) external;
```

### Validation

- Caller is task creator
- Task is in Funded or Open state (no participant has accepted)
- Full balance transferred to creator (no fee deducted on refund)

---

## 10. Dispute and Admin Resolution

### Dispute Lifecycle

```
1. Participant disagrees with rejection or non-selection
2. Participant calls raiseDispute(taskId)
3. Contract status moves to Disputed
4. Funds remain locked — no release or refund during dispute
5. Admin reviews evidence (off-chain, via backend)
6. Admin calls resolveDispute(taskId, ruling, ...)
7. Funds released per ruling
```

### Function Signatures (abstract)

```solidity
function raiseDispute(uint256 taskId, bytes calldata evidence) external;

function resolveDispute(
    uint256 taskId,
    DisputeRuling ruling,
    address[] calldata recipients,
    uint256[] calldata amounts
) external;
```

### Fee Handling During Dispute

Dispute resolution follows the same fee model as successful release:

- **Payout to participant**: fee is deducted from the paid amount, treasury receives the fee
- **Refund to creator**: full balance returned, no fee deducted
- **Split**: fee is deducted from the participant's portion only

This ensures the platform fee is never applied to refunds — only to work that is ultimately rewarded.

### DisputeRuling Enum

| Ruling | Effect | Fee Applied? |
|---|---|---|
| `InFavorOfParticipant` | Release specified amount to participant(s) | Yes |
| `InFavorOfCreator` | Refund remaining balance to creator | No |
| `Split` | Partial payout to participant, partial refund to creator | Yes, on payout portion only |

### Access Control

- `raiseDispute`: any participant whose submission was not selected as winner
- `resolveDispute`: admin address only (set at deploy time, changeable via multisig)

### Guard Conditions

- Task must be in Review or Disputed state
- Can only resolve once per dispute
- Admin cannot rule in their own favor (if admin is also a participant)

---

## 11. Events List

All events emitted by `iNeedEscrow`.

| Event | Parameters | Emitted When |
|---|---|---|
| `TaskCreated` | `taskId`, `creator`, `rewardTotal`, `deadline` | `createTask()` called |
| `TaskFunded` | `taskId`, `amount` | `deposit()` confirmed |
| `TaskAccepted` | `taskId`, `participant` | `accept()` called |
| `SubmissionUploaded` | `taskId`, `submitter`, `contentHash` | `submit()` called |
| `ReviewStarted` | `taskId`, `deadline` | Task enters Review state |
| `WinnerSelected` | `taskId`, `winners[]`, `method` | `selectWinners()` called |
| `RewardReleased` | `taskId`, `recipient`, `amount` | Per-recipient transfer in `release()` |
| `PlatformFeeCollected` | `taskId`, `amount`, `treasury` | Fee deducted during successful reward release |
| `TaskRefunded` | `taskId`, `amount`, `recipient` | `refund()` called |
| `DisputeRaised` | `taskId`, `participant`, `evidence` | `raiseDispute()` called |
| `DisputeResolved` | `taskId`, `ruling`, `amount` | `resolveDispute()` called |
| `AutoResolved` | `taskId`, `action` | `autoResolve()` triggered by timeout |
| `TaskCancelled` | `taskId` | Task cancelled before any acceptance |

---

## 12. Security Considerations

### 12.1 Reentrancy

- All external calls (transfers) happen at the end of functions (checks-effects-interactions pattern)
- Use Solidity `ReentrancyGuard` for `release()`, `refund()`, and `resolveDispute()`
- `msg.value` is credited immediately on deposit — no callback risk at deposit time

### 12.2 Integer Overflow / Underflow

- Solidity 0.8+ has built-in overflow checking
- Division in equal-split reward calculation: check `numWinners > 0` before dividing
- Weighted split: check `weightSum > 0`, handle dust accumulation

### 12.3 Access Control

| Role | Addresses | Protected Functions |
|---|---|---|
| **Creator** | Single address per task | `deposit`, `selectWinners`, `release`, `refund` |
| **Participant** | Addresses that called `accept` | `submit`, `raiseDispute` |
| **Admin** | Set at deploy, multisig-controlled | `resolveDispute`, `setFeeBps`, `setFeeTreasury`, emergency pause |
| **Anyone** | Public | `accept`, `autoResolve` (after deadline) |

### 12.4 Front-Running

- `selectWinners`: commit-reveal pattern is not used for MVP — creator selection is trusted.
- `autoResolve`: permissionless by design, no advantage to front-running.
- `accept`: race condition possible if `maxParticipants` is small. Accept in same block — first tx wins.

### 12.5 Fund Locking Prevention

- `autoResolve` ensures funds cannot be permanently stuck if creator goes inactive
- Maximum review window is enforced on-chain (cannot be infinite)
- Admin `resolveDispute` provides last-resort override

### 12.6 Platform Fee Safety

- Fee deducted **only on successful reward release** — refunds return the full balance to creator
- Global `maxFeeBps` (1000 bps = 10%) is set at deploy and is **immutable** — admin can never exceed this ceiling
- `setFeeBps` enforces `newFeeBps ≤ maxFeeBps` or the transaction reverts
- Fee percentage is **snapshotted** into each `Task` struct at creation — changing the global fee later has no effect on already-funded tasks
- `feeTreasury` must be a non-zero address; setting zero address reverts
- Fee is calculated deterministically from `task.rewardTotal`, not from dynamic balance — prevents manipulation via partial releases
- Fee collection happens in the same transaction as winner payout — atomic: either both succeed or both revert

### 12.7 Denial of Service

- `participants[]` and `submissions[]` arrays are bounded by `maxParticipants`
- `release()` iterates over winner array — checked for reasonable upper bound in MVP
- Gas limit consideration: winner payout loops should have a practical limit (e.g. 50 winners max)

### 12.8 Upgrade & Migration

- MVP contract is immutable (no proxy)
- If critical bug is found, admin can pause new task creation
- Funds in active tasks are at risk during migration — users must withdraw or resolve before migration
- Post-MVP: UUPS proxy pattern with timelocked upgrade
