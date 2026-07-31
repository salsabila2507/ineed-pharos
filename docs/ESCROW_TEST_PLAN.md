# iNeedEscrowV2 — Test Plan

## Test Setup

### Roles
| Alias | Address | Role |
|---|---|---|
| Creator | `addr_creator` | Task creator, funder |
| ParticipantA | `addr_pA` | First participant / submitter |
| ParticipantB | `addr_pB` | Second participant / submitter |
| ParticipantC | `addr_pC` | Third participant / submitter |
| Admin | `addr_admin` | Contract admin, dispute resolver |
| Treasury | `addr_treasury` | Platform fee destination |
| Attacker | `addr_attacker` | Unauthorized actor |
| Random | `addr_random` | Unrelated wallet |

### Default Parameters
| Parameter | Value |
|---|---|
| `rewardTotal` | 100 PHRS (native) or 100 USDC (ERC20 with 6 decimals = 100_000_000) |
| `feeBps` | 200 (2%) |
| `maxFeeBps` | 1000 (10%) |
| `deadline` | `block.timestamp + 7 days` |
| `reviewDeadline` | `block.timestamp + 14 days` |
| `maxParticipants` | 3 |
| `numWinners` | 1 (single) or 2 (multiple) |
| `rewardAsset` | `address(0)` for native PHRS, `usdcAddress` for ERC20 |

### Expected Default Fee Math
```
rewardTotal  = 100
feeBps       = 200
fee          = 100 * 200 / 10000 = 2
payoutPool   = 100 - 2 = 98
```

### Token Setup
- **Native PHRS**: `rewardAsset = address(0)`, amounts in wei (18 decimals)
- **USDC**: `rewardAsset = 0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8`, amounts in 6-decimal units
- Each test suite is parameterized: run once with `address(0)` and once with USDC address (except where noted)

---

## 1. Task Creation Tests

### 1.1 Valid Task Creation

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-1.1a | Create single-winner task (native) | `rewardAsset = 0`, `rewardModel = Single` | Emits `TaskCreated` with `rewardAsset = 0`, taskId > 0 |
| TC-1.1b | Create single-winner task (USDC) | `rewardAsset = usdc`, `rewardModel = Single` | Emits `TaskCreated` with `rewardAsset = usdc` |
| TC-1.1c | Create multiple-winner task | `rewardModel = Multiple`, `numWinners = 2`, equal split | Task created with `rewardConfig` encoding two winners |
| TC-1.1d | Create task with max participants | `maxParticipants = 5` | `task.maxParticipants == 5` |
| TC-1.1e | Create task with unlimited participants | `maxParticipants = 0` | `task.maxParticipants == 0`, accept() never blocked |
| TC-1.1f | Create task with CreatorSelect | `winnerSelection = CreatorSelect` | `task.winnerSelection == CreatorSelect` |
| TC-1.1g | Create task with AutoTimeout PayAll | `winnerSelection = AutoTimeout, action = PayAll` | `task.reviewDeadline` set correctly |
| TC-1.1h | Create task with AutoTimeout Refund | `winnerSelection = AutoTimeout, action = Refund` | Task created with refund fallback |
| TC-1.1i | Create task with AutoTimeout FirstSubmission | `winnerSelection = AutoTimeout, action = FirstSubmission` | Task created with first-submission fallback |
| TC-1.1j | Fee snapshot at creation | Global `feeBps` is 200, create task | `task.feeBps == 200`, `task.feeTreasury == addr_treasury` |
| TC-1.1k | Reward asset stored correctly | Create task with USDC address | `task.rewardAsset == usdcAddress` |

### 1.2 Invalid Parameters

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-1.2a | Zero reward | `rewardTotal = 0` | Revert — reward must be > 0 |
| TC-1.2b | Past deadline | `deadline = block.timestamp - 1` | Revert — deadline must be in the future |
| TC-1.2c | Zero max participants | `maxParticipants = 0` | Allowed (unlimited). Verify `task.maxParticipants == 0` |
| TC-1.2d | Multiple winners with zero numWinners | `rewardModel = Multiple`, `numWinners = 0` | Revert — must have at least one winner |

### 1.3 Reward Validation

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-1.3a | Single winner config | `rewardConfig = abi.encode(true)` | Task stored as single winner |
| TC-1.3b | Multiple equal config | `rewardConfig` with `numWinners=2, equal=true` | Config decoded correctly, numWinners set |
| TC-1.3c | Multiple weighted config | `rewardConfig` with `numWinners=2, equal=false, weights=[70,30]` | Config decoded, weights stored |
| TC-1.3d | Consecutive task IDs | Create 3 tasks | IDs are 1, 2, 3 (monotonically increasing) |

---

## 2. Deposit Tests

### 2.1 Correct Deposit Amount

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-2.1a | Native: deposit exact `rewardTotal` | `msg.value = 100 PHRS`, native task | Status → Funded → Open, contract balance = 100 PHRS |
| TC-2.1b | USDC: deposit exact `rewardTotal` | `msg.value = 0`, approve + deposit, USDC task | Status → Funded → Open, USDC balance = 100 USDC |
| TC-2.1c | Deposit with different fee snapshot | Set global fee to 300, create task, deposit | `task.feeBps == 300`, escrow.totalAmount = rewardTotal |
| TC-2.1d | Multiple tasks, separate deposits | Create task 1 (50), task 2 (100). Deposit both. | Each escrow has correct `totalAmount` |
| TC-2.1e | USDC: require approval before deposit | No approval, call deposit | Revert — transferFrom fails |
| TC-2.1f | USDC: insufficient allowance | Approve 50, rewardTotal 100 | Revert — transferFrom fails |
| TC-2.1g | USDC: creator must have balance | Creator has 0 USDC | Revert — transferFrom fails |

### 2.2 Incorrect Amount

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-2.2a | Native: deposit less than `rewardTotal` | `msg.value = 50`, `rewardTotal = 100` | Revert |
| TC-2.2b | Native: deposit more than `rewardTotal` | `msg.value = 150`, `rewardTotal = 100` | Revert |
| TC-2.2c | Native: deposit with zero value | `msg.value = 0` | Revert |
| TC-2.2d | USDC: send native with ERC20 task | `msg.value = 100`, USDC task | Revert — native not expected |
| TC-2.2e | Native: send ERC20 call on native task | Create native task, try to deposit via transferFrom | Not possible — deposit() only uses msg.value for native |

### 2.3 Double Deposit Prevention

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-2.3a | Deposit twice on same task | `deposit(taskId)` then `deposit(taskId)` again | Second call reverts |
| TC-2.3b | Non-creator deposits | `addr_attacker` calls `deposit(taskId)` | Revert |
| TC-2.3c | Deposit after task accepted | Change status to Accepted, then deposit | Revert |
| TC-2.3d | USDC: deposit twice | Approve enough, deposit once, try again | Second revert — status no longer Created |

---

## 3. Submission and Winner Tests

### 3.1 Creator Select Winner

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-3.1a | Creator selects single winner (native) | 3 submissions, select A | `isWinner == true` for A, winner receives 98 PHRS |
| TC-3.1b | Creator selects single winner (USDC) | 3 submissions, select A | `isWinner == true` for A, winner receives 98 USDC |
| TC-3.1c | Creator selects multiple winners | 3 submissions, select A and B | `isWinner == true` for A and B |
| TC-3.1d | Creator selects all participants | All 3 submitters selected as winners | All `isWinner == true` |
| TC-3.1e | Creator selects winner, then releases | Full happy path native | Winner receives 98, treasury receives 2 |
| TC-3.1f | Full happy path USDC | Full happy path with USDC | Winner receives 98 USDC, treasury receives 2 USDC |

### 3.2 Multiple Winners Split

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-3.2a | Equal split, 2 winners (native) | 2 winners, equal = true | Each winner receives 49 PHRS, treasury 2 PHRS |
| TC-3.2b | Equal split, 2 winners (USDC) | 2 winners, equal = true | Each winner receives 49 USDC, treasury 2 USDC |
| TC-3.2c | Equal split, 3 winners | 3 winners, rewardTotal = 100 | Each receives floor(98 / 3) = 32, remainder 2 handled |
| TC-3.2d | Weighted split, 70/30 | weights = [70, 30] | WinnerA receives 68, WinnerB receives 29 |

### 3.3 Invalid Winner Selection

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-3.3a | Non-creator selects winner | `addr_attacker` calls `selectWinners` | Revert |
| TC-3.3b | Select non-participant as winner | Select address that never called `accept()` | Revert |
| TC-3.3c | Select same winner twice | Include same address twice in winners array | Revert |
| TC-3.3d | Select winners when task not in Review | Call on task in Open state | Revert |
| TC-3.3e | Select more winners than submissions | 2 submissions, try 3 winners | Revert |
| TC-3.3f | Creator selects winner before deadline | Task still in Submitted state | Revert |

### 3.4 Timeout Selection

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-3.4a | Auto timeout PayAll (native) | PayAll after review deadline | Pool split equally, 98 PHRS distributed, 2 PHRS fee |
| TC-3.4b | Auto timeout PayAll (USDC) | PayAll after review deadline | Pool split equally, 98 USDC distributed, 2 USDC fee |
| TC-3.4c | Auto timeout Refund | Review deadline passes, Refund | Full balance to creator, no fee |
| TC-3.4d | Auto timeout FirstSubmission | Review deadline passes, FirstSubmission | Earliest submitter gets payout minus fee |
| TC-3.4e | Auto timeout before review deadline | `autoResolve` before `reviewDeadline` | Revert |
| TC-3.4f | Anyone triggers auto timeout | `addr_random` after deadline | Allowed |

---

## 4. Release Tests

### 4.1 Platform Fee Calculation

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-4.1a | Default 2% fee | `feeBps = 200`, rewardTotal = 100 | `calculateFee(100) == 2` |
| TC-4.1b | Zero fee | `feeBps = 0`, rewardTotal = 100 | `calculateFee(100) == 0`, winner receives full amount |
| TC-4.1c | Maximum fee | `feeBps = 1000`, rewardTotal = 100 | `calculateFee(100) == 10`, winner receives 90 |
| TC-4.1d | Rounding precision | `feeBps = 333`, rewardTotal = 100 | `calculateFee(100) == 3` |
| TC-4.1e | Large reward | `feeBps = 200`, rewardTotal = 1000000 | `calculateFee(1000000) == 20000` |

### 4.2 Treasury Payout

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-4.2a | Native: fee sent to treasury | Release completes native task | Treasury PHRS balance increases by fee |
| TC-4.2b | USDC: fee sent to treasury | Release completes USDC task | Treasury USDC balance increases by fee |
| TC-4.2c | Treasury address from snapshot | Fee snapshot captured, treasury changed before release | Fee still sent to original address |
| TC-4.2d | `PlatformFeeCollected` event | Release called | Event emitted with taskId, fee, treasury |

### 4.3 Winner Payout

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-4.3a | Single winner receives correct amount (native) | 1 winner, rewardTotal = 100 | Winner receives 98 PHRS |
| TC-4.3b | Single winner receives correct amount (USDC) | 1 winner, rewardTotal = 100 | Winner receives 98 USDC |
| TC-4.3c | Multiple winners receive correct amounts | 2 winners equal split | Each receives 49 |
| TC-4.3d | `RewardReleased` event per recipient | 2 winners | 2 events emitted |
| TC-4.3e | Release without selecting winners | No winners selected | Revert |

### 4.4 Fee Snapshot Validation

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-4.4a | Fee change after task creation | Create task A with fee=200, change fee to 500, create task B | Task A fee = 200, Task B fee = 500 |
| TC-4.4b | Old fee applies on release for task A | Release task A after global fee changed | Fee = `100 * 200 / 10000 = 2` |
| TC-4.4c | New fee applies on release for task B | Release task B created after fee change | Fee = `100 * 500 / 10000 = 5` |

---

## 5. Refund Tests

### 5.1 Creator Refund

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-5.1a | Native: full refund before accept | Fund task, no one accepts, refund | Creator receives 100 PHRS back |
| TC-5.1b | USDC: full refund before accept | Fund USDC task, no one accepts, refund | Creator receives 100 USDC back |
| TC-5.1c | Refund with zero fee | `feeBps = 0`, refund | Full amount returned |
| TC-5.1d | Contract balance after refund | Refund complete | Contract balance = 0 |

### 5.2 Invalid Refund Attempt

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-5.2a | Refund after participant accepted | Participant called `accept()` | Revert |
| TC-5.2b | Refund after submission | Participant submitted | Revert |
| TC-5.2c | Refund during dispute | Status is Disputed | Revert |
| TC-5.2d | Non-creator refunds | `addr_attacker` calls `refund` | Revert |
| TC-5.2e | Refund on completed task | Status is Completed | Revert |

### 5.3 No Fee on Refund

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-5.3a | Full amount returned | rewardTotal = 100, refund called | Creator receives 100 |
| TC-5.3b | Treasury balance unchanged | Treasury had 0 before refund | Treasury still has 0 |
| TC-5.3c | No `PlatformFeeCollected` on refund | Refund called | Event NOT emitted |

---

## 6. Dispute Tests

### 6.1 Open Dispute

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-6.1a | Rejected participant raises dispute | Participant B not selected, raises dispute | Status → Disputed |
| TC-6.1b | Winner raises dispute | Winner calls `raiseDispute` | Revert |
| TC-6.1c | Non-participant raises dispute | `addr_random` calls | Revert |
| TC-6.1d | Raise dispute before review | Task in Submitted state | Revert |
| TC-6.1e | Raise dispute with evidence | With evidence bytes | Event includes evidence |

### 6.2 Admin Resolution

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-6.2a | Non-admin resolves | `addr_attacker` calls `resolveDispute` | Revert |
| TC-6.2b | Resolve without open dispute | Task not in Disputed state | Revert |
| TC-6.2c | Double resolution | Resolve twice | Second reverts |

### 6.3 Payout to Participant

| ID | Case | Native | USDC |
|---|---|---|---|
| TC-6.3a | InFavorOfParticipant, full payout | Participant receives 98 PHRS, treasury 2 PHRS | Participant receives 98 USDC, treasury 2 USDC |
| TC-6.3b | Event emitted | `DisputeResolved` with correct ruling | Same |
| TC-6.3c | Status updated | Status = Resolved | Same |

### 6.4 Refund to Creator

| ID | Case | Native | USDC |
|---|---|---|---|
| TC-6.4a | InFavorOfCreator, full refund | Creator receives 100 PHRS | Creator receives 100 USDC |
| TC-6.4b | No fee collected | Treasury unchanged | Same |
| TC-6.4c | Status updated | Status = Resolved | Same |

### 6.5 Split Decision

| ID | Case | Input | Expected |
|---|---|---|---|
| TC-6.5a | Split 50/50 (native) | 50 participant, 50 creator | Participant receives 49 PHRS, creator receives 50 PHRS |
| TC-6.5b | Split 50/50 (USDC) | 50 participant, 50 creator | Participant receives 49 USDC, creator receives 50 USDC |
| TC-6.5c | Fee applied only to payout portion | Participant 50, creator 50 | Fee = 1 (only on participant's 50) |

---

## 7. Access Control Tests

| ID | Case | Function | Caller | Expected |
|---|---|---|---|---|
| AC-1 | Creator deposits | `deposit` | `addr_attacker` | Revert |
| AC-2 | Creator selects winners | `selectWinners` | `addr_random` | Revert |
| AC-3 | Creator releases | `release` | `addr_attacker` | Revert |
| AC-4 | Creator refunds | `refund` | `addr_attacker` | Revert |
| AC-5 | Admin resolves dispute | `resolveDispute` | `addr_creator` | Revert |
| AC-6 | Admin sets fee | `setFeeBps` | `addr_creator` | Revert |
| AC-7 | Admin sets treasury | `setFeeTreasury` | `addr_creator` | Revert |
| AC-8 | Anyone accepts | `accept` | `addr_random` | Allowed |
| AC-9 | Participant submits | `submit` | `addr_random` | Revert (not accepted) |
| AC-10 | Anyone auto-resolves | `autoResolve` | `addr_random` | Allowed (after deadline) |
| AC-11 | Admin fee exceeds max | `setFeeBps(1001)` | `addr_admin` | Revert |
| AC-12 | Admin sets treasury to zero | `setFeeTreasury(zero)` | `addr_admin` | Revert |

---

## 8. Security Tests

### 8.1 Reentrancy

| ID | Case | Expected |
|---|---|---|
| SC-1a | Malicious contract as winner | `nonReentrant` prevents re-entry |
| SC-1b | Malicious contract as creator on refund | Guard blocks recursive refund |
| SC-1c | Malicious contract in dispute resolution | Guard prevents nested resolution |
| SC-1d | Malicious ERC20 with hooks (if applicable) | USDC has no hooks — safe |

### 8.2 Locked Funds

| ID | Case | Expected |
|---|---|---|
| SC-2a | Creator goes inactive after submissions | `autoResolve` can be called by anyone |
| SC-2b | All participants go silent | Creator can `refund()` |
| SC-2c | Admin goes inactive during dispute | Funds remain locked (no timeout on dispute) |

### 8.3 Invalid State Transition

| ID | Case | Expected |
|---|---|---|
| SC-3a | Accept without deposit | Revert |
| SC-3b | Submit without accept | Revert |
| SC-3c | Release without winners | Revert |
| SC-3d | Deposit after funding | Revert |
| SC-3e | Accept beyond max participants | Revert |
| SC-3f | Duplicate accept | Revert |

### 8.4 Asset Mismatch

| ID | Case | Expected |
|---|---|---|
| SC-4a | Native msg.value on ERC20 task | Revert — msg.value must be 0 |
| SC-4b | ERC20 task with wrong token | Revert — transferFrom fails |
| SC-4c | Native task with ERC20 call | Not possible — deposit only accepts msg.value |

### 8.5 Fee Manipulation

| ID | Case | Expected |
|---|---|---|
| SC-5a | Set fee above max | Revert |
| SC-5b | Change fee after tasks created | Old tasks use snapshotted fee |
| SC-5c | Fee update to valid value | Global feeBps updated |
| SC-5d | Treasury change to valid address | New treasury stored |

### 8.6 Event Emission Verification

| ID | Case | Expected Events |
|---|---|---|
| EV-1 | Full happy path native | `TaskCreated` → `TaskFunded` → `TaskAccepted` → `SubmissionUploaded` → `ReviewStarted` → `WinnerSelected` → `RewardReleased` + `PlatformFeeCollected` |
| EV-2 | Full happy path USDC | Same events as native (rewardAsset in TaskCreated) |
| EV-3 | Creator refund | `TaskCreated` → `TaskFunded` → `TaskRefunded` → `TaskCancelled` |
| EV-4 | Dispute → resolved for participant | ... → `DisputeRaised` → `DisputeResolved` + `RewardReleased` + `PlatformFeeCollected` |
| EV-5 | Auto timeout PayAll | ... → `AutoResolved` + `RewardReleased` + `PlatformFeeCollected` |

---

## 9. Admin Function Tests

| ID | Case | Input | Expected |
|---|---|---|---|
| AF-1 | Set fee to valid value | `setFeeBps(500)` by admin | Updated, event emitted |
| AF-2 | Set fee to zero | `setFeeBps(0)` by admin | Fee disabled |
| AF-3 | Set fee to max allowed | `setFeeBps(1000)` by admin | Fee set to 10% cap |
| AF-4 | Set treasury to valid address | `setFeeTreasury(0xNew...)` by admin | Updated, event emitted |
| AF-5 | Non-admin sets fee | `setFeeBps(300)` by creator | Revert |
| AF-6 | Non-admin sets treasury | by creator | Revert |

---

## 10. Multi-Asset Integration Tests

| ID | Case | Expected |
|---|---|---|
| MA-1 | Native and USDC tasks coexist | Independent escrow balances per asset, no cross-contamination |
| MA-2 | Native task operations don't affect USDC | USDC treasury balance unchanged |
| MA-3 | USDC task operations don't affect native | Native contract balance unchanged |
| MA-4 | Multiple USDC tasks from same creator | Each task has independent escrow accounting |
| MA-5 | Fee collected in correct asset per task | Native tasks → treasury gets PHRS, USDC tasks → treasury gets USDC |

---

## 11. Gas and Performance Tests

| ID | Case | Expected Behavior |
|---|---|---|
| GP-1 | Single winner full cycle (native) | Deploy, create, deposit, accept, submit, select, release — measure gas |
| GP-2 | Single winner full cycle (USDC) | Same flow with ERC20 — measure gas (includes transferFrom) |
| GP-3 | Multiple winners equal split (3 winners) | Full cycle with 3 winners — measure gas |
| GP-4 | Refund gas cost | Fund, refund — measure gas |
| GP-5 | Dispute resolution gas cost | Full cycle with dispute — measure gas |
