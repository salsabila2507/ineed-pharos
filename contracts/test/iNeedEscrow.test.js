const { expect } = require("chai");
const { ethers } = require("hardhat");

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

const singleConfig = abiCoder.encode(["bool"], [true]);
const multiEqualConfig = (n) => abiCoder.encode(["uint256", "bool", "uint256[]"], [n, true, []]);
const multiWeightedConfig = (n, weights) => abiCoder.encode(["uint256", "bool", "uint256[]"], [n, false, weights]);
const autoTimeoutConfig = (action) => abiCoder.encode(["uint8"], [action]);

const DAY = 86400;
const REWARD = ethers.parseEther("100");
const FEE_200 = 200n;
const FEE_500 = 500n;
const MAX_FEE = 1000n;

async function createTask(escrow, creator, overrides = {}) {
  const deadline = (await ethers.provider.getBlock("latest")).timestamp + (overrides.duration || 7 * DAY);
  const reviewDeadline = deadline + (overrides.reviewDuration || 7 * DAY);
  const tx = await escrow.connect(creator).createTask(
    overrides.rewardTotal || REWARD,
    overrides.rewardModel || 0, // Single
    overrides.rewardConfig || singleConfig,
    overrides.winnerSelection || 0, // CreatorSelect
    deadline,
    reviewDeadline,
    overrides.maxParticipants !== undefined ? overrides.maxParticipants : 3
  );
  const receipt = await tx.wait();
  const event = receipt.logs.find(l => escrow.interface.parseLog({ topics: l.topics, data: l.data }));
  const parsed = escrow.interface.parseLog({ topics: event.topics, data: event.data });
  return parsed.args.taskId;
}

async function fundTask(escrow, creator, taskId, amount = REWARD) {
  await escrow.connect(creator).deposit(taskId, { value: amount });
}

async function acceptTask(escrow, participant, taskId) {
  await escrow.connect(participant).accept(taskId);
}

async function submitWork(escrow, participant, taskId, contentHash = ethers.keccak256(ethers.toUtf8Bytes("work"))) {
  await escrow.connect(participant).submit(taskId, contentHash);
}

async function startReview(escrow, creator, taskId) {
  await escrow.connect(creator).startReview(taskId);
}

async function selectWinners(escrow, creator, taskId, winners) {
  await escrow.connect(creator).selectWinners(taskId, winners);
}

async function release(escrow, creator, taskId) {
  await escrow.connect(creator).release(taskId);
}

describe("iNeedEscrow", function () {
  let escrow, admin, creator, participant1, participant2, participant3, treasury, attacker;

  beforeEach(async function () {
    [admin, creator, participant1, participant2, participant3, treasury, attacker] = await ethers.getSigners();
    const iNeedEscrow = await ethers.getContractFactory("iNeedEscrow");
    escrow = await iNeedEscrow.deploy(treasury.address);
    await escrow.waitForDeployment();
  });

  // ─── 1. Task Creation ───

  describe("1. Task Creation", function () {
    it("should create a single-winner task with correct state", async function () {
      const taskId = await createTask(escrow, creator);

      const task = await escrow.tasks(taskId);
      expect(task.creator).to.equal(creator.address);
      expect(task.rewardTotal).to.equal(REWARD);
      expect(task.rewardModel).to.equal(0); // Single
      expect(task.status).to.equal(0); // Created
      expect(task.feeBps).to.equal(200);
      expect(task.feeTreasury).to.equal(treasury.address);
    });

    it("should create a multiple-winner equal split task", async function () {
      const taskId = await createTask(escrow, creator, {
        rewardModel: 1, // Multiple
        rewardConfig: multiEqualConfig(2),
      });

      const task = await escrow.tasks(taskId);
      expect(task.rewardModel).to.equal(1);
    });

    it("should reject zero reward", async function () {
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 7 * DAY;
      await expect(
        escrow.connect(creator).createTask(0, 0, singleConfig, 0, deadline, deadline + 7 * DAY, 3)
      ).to.be.revertedWith("Reward must be > 0");
    });

    it("should reject past deadline", async function () {
      const past = (await ethers.provider.getBlock("latest")).timestamp - 1;
      await expect(
        escrow.connect(creator).createTask(REWARD, 0, singleConfig, 0, past, past + 7 * DAY, 3)
      ).to.be.revertedWith("Deadline must be in the future");
    });

    it("should reject review deadline before submission deadline", async function () {
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 7 * DAY;
      await expect(
        escrow.connect(creator).createTask(REWARD, 0, singleConfig, 0, deadline, deadline - 1, 3)
      ).to.be.revertedWith("Review deadline must be after submission deadline");
    });

    it("should assign monotonically increasing task IDs", async function () {
      const id1 = await createTask(escrow, creator);
      const id2 = await createTask(escrow, creator);
      const id3 = await createTask(escrow, creator);
      expect(id1).to.equal(1n);
      expect(id2).to.equal(2n);
      expect(id3).to.equal(3n);
    });

    it("should emit TaskCreated event", async function () {
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 7 * DAY;
      await expect(
        escrow.connect(creator).createTask(REWARD, 0, singleConfig, 0, deadline, deadline + 7 * DAY, 3)
      ).to.emit(escrow, "TaskCreated").withArgs(1n, creator.address, REWARD, deadline);
    });

    it("should create task with zero maxParticipants (unlimited)", async function () {
      const taskId = await createTask(escrow, creator, { maxParticipants: 0 });
      const task = await escrow.tasks(taskId);
      expect(task.maxParticipants).to.equal(0);
    });
  });

  // ─── 2. Deposit ───

  describe("2. Deposit", function () {
    it("should fund a task and emit TaskFunded", async function () {
      const taskId = await createTask(escrow, creator);
      await expect(
        escrow.connect(creator).deposit(taskId, { value: REWARD })
      ).to.emit(escrow, "TaskFunded").withArgs(taskId, REWARD);

      const task = await escrow.tasks(taskId);
      expect(task.status).to.equal(2); // Open
    });

    it("should revert if non-creator deposits", async function () {
      const taskId = await createTask(escrow, creator);
      await expect(
        escrow.connect(attacker).deposit(taskId, { value: REWARD })
      ).to.be.revertedWith("Only creator");
    });

    it("should revert if msg.value != rewardTotal", async function () {
      const taskId = await createTask(escrow, creator);
      await expect(
        escrow.connect(creator).deposit(taskId, { value: ethers.parseEther("50") })
      ).to.be.revertedWith("msg.value must equal rewardTotal");
    });

    it("should revert if already funded", async function () {
      const taskId = await createTask(escrow, creator);
      await escrow.connect(creator).deposit(taskId, { value: REWARD });
      await expect(
        escrow.connect(creator).deposit(taskId, { value: REWARD })
      ).to.be.revertedWith("Task not in Created state");
    });

    it("should set correct escrow balance", async function () {
      const taskId = await createTask(escrow, creator);
      await escrow.connect(creator).deposit(taskId, { value: REWARD });
      const escrowData = await escrow.getEscrow(taskId);
      expect(escrowData.totalAmount).to.equal(REWARD);
    });

    it("should accept deposit with fee snapshot at creation", async function () {
      await escrow.connect(admin).setFeeBps(500);
      const taskId = await createTask(escrow, creator);
      await escrow.connect(creator).deposit(taskId, { value: REWARD });
      const task = await escrow.tasks(taskId);
      expect(task.feeBps).to.equal(500);
    });
  });

  // ─── 3. Accept & Submit ───

  describe("3. Accept & Submit", function () {
    it("should accept a participant and emit TaskAccepted", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);

      await expect(escrow.connect(participant1).accept(taskId))
        .to.emit(escrow, "TaskAccepted").withArgs(taskId, participant1.address);
    });

    it("should not accept if already accepted", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await escrow.connect(participant1).accept(taskId);
      await expect(
        escrow.connect(participant1).accept(taskId)
      ).to.be.revertedWith("Already accepted");
    });

    it("should not accept if max participants reached", async function () {
      const taskId = await createTask(escrow, creator, { maxParticipants: 2 });
      await fundTask(escrow, creator, taskId);
      await escrow.connect(participant1).accept(taskId);
      await escrow.connect(participant2).accept(taskId);
      await expect(
        escrow.connect(participant3).accept(taskId)
      ).to.be.revertedWith("Max participants reached");
    });

    it("should not accept if task not open", async function () {
      const taskId = await createTask(escrow, creator);
      await expect(
        escrow.connect(participant1).accept(taskId)
      ).to.be.revertedWith("Task not open for acceptance");
    });

    it("should submit work and emit SubmissionUploaded", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await escrow.connect(participant1).accept(taskId);

      const contentHash = ethers.keccak256(ethers.toUtf8Bytes("my work"));
      await expect(escrow.connect(participant1).submit(taskId, contentHash))
        .to.emit(escrow, "SubmissionUploaded").withArgs(taskId, participant1.address, contentHash);
    });

    it("should not submit if not accepted", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await escrow.connect(participant1).accept(taskId);
      await expect(
        escrow.connect(attacker).submit(taskId, ethers.keccak256(ethers.toUtf8Bytes("hack")))
      ).to.be.revertedWith("Not an accepted participant");
    });

    it("should not submit twice", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await escrow.connect(participant1).accept(taskId);
      await escrow.connect(participant1).submit(taskId, ethers.keccak256(ethers.toUtf8Bytes("work1")));
      await expect(
        escrow.connect(participant1).submit(taskId, ethers.keccak256(ethers.toUtf8Bytes("work2")))
      ).to.be.revertedWith("Already submitted");
    });

    it("should not submit after deadline", async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const shortDeadline = now + 10; // 10 seconds
      const taskId = await createTask(escrow, creator, {
        duration: 10,
        deadline: now + 10,
      });
      // Manually create with shorter deadline
      // Since createTask uses our helper, let's just fund and accept quickly
      await fundTask(escrow, creator, taskId);
      await escrow.connect(participant1).accept(taskId);
      // Wait past deadline
      await ethers.provider.send("evm_increaseTime", [15]);
      await ethers.provider.send("evm_mine");
      await expect(
        escrow.connect(participant1).submit(taskId, ethers.keccak256(ethers.toUtf8Bytes("late")))
      ).to.be.revertedWith("Submission deadline passed");
    });
  });

  // ─── 4. Winner Selection & Release (Single) ───

  describe("4. Single Winner Selection & Release", function () {
    it("should select and release to single winner with fee deducted", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);

      // Advance past deadline and start review
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);

      const balBefore = await ethers.provider.getBalance(participant1.address);
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);

      await selectWinners(escrow, creator, taskId, [participant1.address]);
      await release(escrow, creator, taskId);

      const fee = REWARD * 200n / 10000n; // 2 ETH
      const payout = REWARD - fee; // 98 ETH

      expect(await ethers.provider.getBalance(participant1.address)).to.equal(balBefore + payout);
      expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore + fee);

      const task = await escrow.tasks(taskId);
      expect(task.status).to.equal(6); // Completed
    });

    it("should emit RewardReleased and PlatformFeeCollected", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);

      const fee = REWARD * 200n / 10000n;
      const payout = REWARD - fee;

      await expect(escrow.connect(creator).release(taskId))
        .to.emit(escrow, "RewardReleased").withArgs(taskId, participant1.address, payout)
        .and.to.emit(escrow, "PlatformFeeCollected").withArgs(taskId, fee, treasury.address);
    });

    it("should revert if no winners selected", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);

      await expect(release(escrow, creator, taskId)).to.be.revertedWith("Winners not selected");
    });

    it("should revert if non-creator selects winner", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);

      await expect(
        escrow.connect(attacker).selectWinners(taskId, [participant1.address])
      ).to.be.revertedWith("Only creator");
    });

    it("should reject non-participant as winner", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);

      await expect(
        selectWinners(escrow, creator, taskId, [attacker.address])
      ).to.be.revertedWith("Winner not a participant");
    });

    it("should reject selecting winner before Review state", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);

      await expect(
        selectWinners(escrow, creator, taskId, [participant1.address])
      ).to.be.revertedWith("Task not in Review state");
    });

    it("should reject release from non-creator", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);

      await expect(escrow.connect(attacker).release(taskId)).to.be.revertedWith("Only creator");
    });
  });

  // ─── 5. Multiple Winners ───

  describe("5. Multiple Winners", function () {
    it("should split equally among winners", async function () {
      const taskId = await createTask(escrow, creator, {
        rewardModel: 1,
        rewardConfig: multiEqualConfig(2),
      });
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address, participant2.address]);

      const balP1Before = await ethers.provider.getBalance(participant1.address);
      const balP2Before = await ethers.provider.getBalance(participant2.address);

      await release(escrow, creator, taskId);

      const fee = REWARD * 200n / 10000n;
      const payoutPool = REWARD - fee; // 98 ETH
      const each = payoutPool / 2n; // 49 ETH

      expect(await ethers.provider.getBalance(participant1.address)).to.equal(balP1Before + each);
      expect(await ethers.provider.getBalance(participant2.address)).to.equal(balP2Before + each);
    });

    it("should split weighted among winners", async function () {
      const taskId = await createTask(escrow, creator, {
        rewardModel: 1,
        rewardConfig: multiWeightedConfig(2, [70, 30]),
      });
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address, participant2.address]);

      const balP1Before = await ethers.provider.getBalance(participant1.address);
      const balP2Before = await ethers.provider.getBalance(participant2.address);

      await release(escrow, creator, taskId);

      const fee = REWARD * 200n / 10000n;
      const payoutPool = REWARD - fee; // 98 ETH
      const p1Amount = payoutPool * 70n / 100n; // 68.6 ETH → 68 (truncated)
      const p2Amount = payoutPool - p1Amount; // 30 (remainder)

      expect(await ethers.provider.getBalance(participant1.address)).to.equal(balP1Before + p1Amount);
      expect(await ethers.provider.getBalance(participant2.address)).to.equal(balP2Before + p2Amount);
    });
  });

  // ─── 6. Refund ───

  describe("6. Refund", function () {
    it("should refund full amount to creator before anyone accepts", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);

      const creatorBefore = await ethers.provider.getBalance(creator.address);
      const tx = await escrow.connect(creator).refund(taskId);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      expect(await ethers.provider.getBalance(creator.address)).to.equal(creatorBefore + REWARD - gasCost);

      const task = await escrow.tasks(taskId);
      expect(task.status).to.equal(9); // Cancelled
    });

    it("should not charge fee on refund", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);

      const treasuryBefore = await ethers.provider.getBalance(treasury.address);
      await escrow.connect(creator).refund(taskId);
      expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore);
    });

    it("should revert refund after participant accepts", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);

      await expect(escrow.connect(creator).refund(taskId)).to.be.revertedWith(
        "Cannot refund at current state"
      );
    });

    it("should revert refund from non-creator", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);

      await expect(escrow.connect(attacker).refund(taskId)).to.be.revertedWith("Only creator");
    });

    it("should emit TaskRefunded and TaskCancelled", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);

      await expect(escrow.connect(creator).refund(taskId))
        .to.emit(escrow, "TaskRefunded").withArgs(taskId, REWARD, creator.address)
        .and.to.emit(escrow, "TaskCancelled").withArgs(taskId);
    });
  });

  // ─── 7. Dispute ───

  describe("7. Dispute & Resolution", function () {
    it("should allow rejected participant to raise dispute", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);

      await expect(escrow.connect(participant2).raiseDispute(taskId, "0x"))
        .to.emit(escrow, "DisputeRaised").withArgs(taskId, participant2.address, "0x");
    });

    it("should not allow winner to dispute", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);

      await expect(escrow.connect(participant1).raiseDispute(taskId, "0x")).to.be.revertedWith("Winner cannot dispute");
    });

    it("should not allow non-participant to dispute", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);

      await expect(escrow.connect(attacker).raiseDispute(taskId, "0x")).to.be.revertedWith("Not a participant");
    });

    it("should resolve dispute in favor of participant with fee", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);
      await escrow.connect(participant2).raiseDispute(taskId, "0x");

      const balBefore = await ethers.provider.getBalance(participant2.address);
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);

      const fee = REWARD * 200n / 10000n;
      const payout = REWARD - fee;

      await escrow.connect(admin).resolveDispute(
        taskId,
        0, // InFavorOfParticipant
        [participant2.address],
        [REWARD]
      );

      // participant2 gets payout minus fee (net)
      expect(await ethers.provider.getBalance(participant2.address)).to.equal(balBefore + payout);
      expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore + fee);
    });

    it("should resolve dispute in favor of creator with full refund (no fee)", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);
      await escrow.connect(participant2).raiseDispute(taskId, "0x");

      const treasuryBefore = await ethers.provider.getBalance(treasury.address);

      await escrow.connect(admin).resolveDispute(taskId, 1, [], []);

      // Full balance returned to creator, no fee taken
      expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    });

    it("should not allow non-admin to resolve dispute", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);
      await escrow.connect(participant2).raiseDispute(taskId, "0x");

      await expect(
        escrow.connect(attacker).resolveDispute(taskId, 0, [participant1.address], [REWARD])
      ).to.be.revertedWith("Only admin");
    });

    it("should handle Split ruling with fee on participant portion only", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);
      await escrow.connect(participant2).raiseDispute(taskId, "0x");

      const balP1 = await ethers.provider.getBalance(participant1.address);
      const treasuryBal = await ethers.provider.getBalance(treasury.address);

      // Split: 50 to participant, 50 to creator
      const participantGross = ethers.parseEther("50");
      const fee = participantGross * 200n / 10000n;
      const netToParticipant = participantGross - fee;

      await escrow.connect(admin).resolveDispute(
        taskId,
        2, // Split
        [participant1.address],
        [participantGross]
      );

      expect(await ethers.provider.getBalance(participant1.address)).to.equal(balP1 + netToParticipant);
      expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBal + fee);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    });
  });

  // ─── 8. Auto Resolve ───

  describe("8. Auto Resolve (Timeout)", function () {
    it("should auto resolve with PayAll", async function () {
      const taskId = await createTask(escrow, creator, {
        winnerSelection: 3, // AutoTimeout
        rewardConfig: autoTimeoutConfig(0), // PayAll
      });
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);

      // Advance past review deadline (14 days from creation, but our helper sets 7+7)
      await ethers.provider.send("evm_increaseTime", [15 * DAY]);
      await ethers.provider.send("evm_mine");

      const balP1 = await ethers.provider.getBalance(participant1.address);
      const balP2 = await ethers.provider.getBalance(participant2.address);

      await escrow.connect(attacker).autoResolve(taskId);

      const fee = REWARD * 200n / 10000n;
      const payoutPool = REWARD - fee;
      const each = payoutPool / 2n;

      expect(await ethers.provider.getBalance(participant1.address)).to.equal(balP1 + each);
      expect(await ethers.provider.getBalance(participant2.address)).to.equal(balP2 + (payoutPool - each));
    });

    it("should auto resolve with Refund (no fee)", async function () {
      const taskId = await createTask(escrow, creator, {
        winnerSelection: 3, // AutoTimeout
        rewardConfig: autoTimeoutConfig(1), // Refund
      });
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);

      await ethers.provider.send("evm_increaseTime", [15 * DAY]);
      await ethers.provider.send("evm_mine");

      const creatorBefore = await ethers.provider.getBalance(creator.address);
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);

      await escrow.connect(attacker).autoResolve(taskId);

      expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore); // No fee
      // Creator gets full amount back (minus gas for the refund tx, not this one)
      // We check contract balance instead: should be 0
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    });

    it("should auto resolve with FirstSubmission", async function () {
      const taskId = await createTask(escrow, creator, {
        winnerSelection: 3, // AutoTimeout
        rewardConfig: autoTimeoutConfig(2), // FirstSubmission
      });
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      // participant1 submits first, then participant2
      await submitWork(escrow, participant1, taskId, ethers.keccak256(ethers.toUtf8Bytes("first")));
      await ethers.provider.send("evm_increaseTime", [1]); // small gap
      await ethers.provider.send("evm_mine");
      await submitWork(escrow, participant2, taskId, ethers.keccak256(ethers.toUtf8Bytes("second")));

      await ethers.provider.send("evm_increaseTime", [15 * DAY]);
      await ethers.provider.send("evm_mine");

      const balP1 = await ethers.provider.getBalance(participant1.address);

      await escrow.connect(attacker).autoResolve(taskId);

      const fee = REWARD * 200n / 10000n;
      const payout = REWARD - fee;

      // participant1 (first submitter) gets full payout
      expect(await ethers.provider.getBalance(participant1.address)).to.equal(balP1 + payout);
    });

    it("should revert autoResolve before review deadline", async function () {
      const taskId = await createTask(escrow, creator, {
        winnerSelection: 3,
        rewardConfig: autoTimeoutConfig(0),
      });
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);

      await expect(escrow.connect(attacker).autoResolve(taskId)).to.be.revertedWith(
        "Review deadline not yet passed"
      );
    });

    it("should be callable by anyone after deadline", async function () {
      const taskId = await createTask(escrow, creator, {
        winnerSelection: 3,
        rewardConfig: autoTimeoutConfig(0),
      });
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [15 * DAY]);
      await ethers.provider.send("evm_mine");

      await expect(escrow.connect(attacker).autoResolve(taskId)).to.not.be.reverted;
    });
  });

  // ─── 9. Fee Snapshot & Admin ───

  describe("9. Fee Snapshots & Admin", function () {
    it("should snapshot fee at task creation, not affected by global change", async function () {
      const taskA = await createTask(escrow, creator); // feeBps = 200
      await fundTask(escrow, creator, taskA);
      await acceptTask(escrow, participant1, taskA);
      await submitWork(escrow, participant1, taskA);

      // Admin changes fee
      await escrow.connect(admin).setFeeBps(500);

      const taskB = await createTask(escrow, creator); // feeBps = 500

      const taskDataA = await escrow.tasks(taskA);
      const taskDataB = await escrow.tasks(taskB);

      expect(taskDataA.feeBps).to.equal(200);
      expect(taskDataB.feeBps).to.equal(500);
    });

    it("should use snapshotted fee on release", async function () {
      const taskId = await createTask(escrow, creator); // fee = 200
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);

      await escrow.connect(admin).setFeeBps(500); // Change global fee
      await selectWinners(escrow, creator, taskId, [participant1.address]);

      const treasuryBefore = await ethers.provider.getBalance(treasury.address);

      await release(escrow, creator, taskId);

      const fee = REWARD * 200n / 10000n; // Should use 200, not 500
      expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore + fee);
    });

    it("should enforce maxFeeBps ceiling", async function () {
      await expect(escrow.connect(admin).setFeeBps(1001)).to.be.revertedWith("Fee exceeds max");
    });

    it("should allow admin to set fee to max", async function () {
      await escrow.connect(admin).setFeeBps(1000);
      expect(await escrow.feeBps()).to.equal(1000);
    });

    it("should revert zero treasury address", async function () {
      await expect(escrow.connect(admin).setFeeTreasury(ethers.ZeroAddress)).to.be.revertedWith(
        "Treasury cannot be zero"
      );
    });

    it("should revert non-admin setting fee", async function () {
      await expect(escrow.connect(creator).setFeeBps(300)).to.be.revertedWith("Only admin");
    });

    it("should revert non-admin setting treasury", async function () {
      await expect(escrow.connect(creator).setFeeTreasury(creator.address)).to.be.revertedWith("Only admin");
    });
  });

  // ─── 10. Access Control ───

  describe("10. Access Control", function () {
    it("should allow anyone to accept", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await expect(escrow.connect(attacker).accept(taskId)).to.not.be.reverted;
    });

    it("should allow anyone to autoResolve after deadline", async function () {
      const taskId = await createTask(escrow, creator, {
        winnerSelection: 3,
        rewardConfig: autoTimeoutConfig(0),
      });
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [15 * DAY]);
      await ethers.provider.send("evm_mine");

      await expect(escrow.connect(attacker).autoResolve(taskId)).to.not.be.reverted;
    });

    it("should block non-creator from depositing", async function () {
      const taskId = await createTask(escrow, creator);
      await expect(escrow.connect(attacker).deposit(taskId, { value: REWARD })).to.be.revertedWith("Only creator");
    });

    it("should block non-creator from selecting winners", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);

      await expect(escrow.connect(participant1).selectWinners(taskId, [participant1.address])).to.be.revertedWith(
        "Only creator"
      );
    });

    it("should block non-admin from resolving dispute", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);
      await escrow.connect(participant2).raiseDispute(taskId, "0x");

      await expect(
        escrow.connect(creator).resolveDispute(taskId, 0, [participant2.address], [REWARD])
      ).to.be.revertedWith("Only admin");
    });
  });

  // ─── 11. Edge Cases & Security ───

  describe("11. Edge Cases & Security", function () {
    it("should handle zero fee correctly", async function () {
      await escrow.connect(admin).setFeeBps(0);
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);

      const balBefore = await ethers.provider.getBalance(participant1.address);
      await release(escrow, creator, taskId);

      // Winner gets full amount with zero fee
      expect(await ethers.provider.getBalance(participant1.address)).to.equal(balBefore + REWARD);
    });

    it("should handle minimum reward (1 wei)", async function () {
      const minReward = 1n;
      const taskId = await createTask(escrow, creator, { rewardTotal: minReward });
      await escrow.connect(creator).deposit(taskId, { value: minReward });
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);

      const balBefore = await ethers.provider.getBalance(participant1.address);
      await release(escrow, creator, taskId);

      // fee = 1 * 200 / 10000 = 0 (truncated), winner gets 1
      expect(await ethers.provider.getBalance(participant1.address)).to.equal(balBefore + minReward);
    });

    it("should reject duplicate winner addresses", async function () {
      const taskId = await createTask(escrow, creator, {
        rewardModel: 1,
        rewardConfig: multiEqualConfig(2),
      });
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);

      await expect(
        selectWinners(escrow, creator, taskId, [participant1.address, participant1.address])
      ).to.be.revertedWith("Duplicate winner");
    });

    it("should reject selecting more winners than submissions", async function () {
      const taskId = await createTask(escrow, creator, {
        rewardModel: 1,
        rewardConfig: multiEqualConfig(3),
      });
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);

      // Can select 2 winners even though rewardConfig says 3 - the mismatch is caught in release
      await selectWinners(escrow, creator, taskId, [participant1.address, participant2.address]);

      await expect(release(escrow, creator, taskId)).to.be.revertedWith("Winner count mismatch");
    });

    it("should reject startReview on non-Submitted task", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);

      await expect(startReview(escrow, creator, taskId)).to.be.revertedWith("Task not in Submitted state");
    });

    it("should reject release on disputed task", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);
      await escrow.connect(participant2).raiseDispute(taskId, "0x");

      await expect(release(escrow, creator, taskId)).to.be.revertedWith("Task is disputed");
    });

    it("should allow contract to hold multiple task funds", async function () {
      const task1 = await createTask(escrow, creator);
      const task2 = await createTask(escrow, creator);
      await fundTask(escrow, creator, task1);
      await fundTask(escrow, creator, task2);

      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(REWARD * 2n);
    });

    it("should allow admin transfer", async function () {
      await escrow.connect(admin).transferAdmin(creator.address);
      expect(await escrow.admin()).to.equal(creator.address);
    });

    it("should reject zero address for admin transfer", async function () {
      await expect(escrow.connect(admin).transferAdmin(ethers.ZeroAddress)).to.be.revertedWith(
        "Admin cannot be zero"
      );
    });

    it("should revert selectWinners with empty array", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);

      await expect(selectWinners(escrow, creator, taskId, [])).to.be.revertedWith(
        "Must select at least one winner"
      );
    });

    it("should not allow duplicate selectWinners call", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);

      await expect(selectWinners(escrow, creator, taskId, [participant1.address])).to.be.revertedWith(
        "Winners already selected"
      );
    });
  });

  // ─── 12. Gas Events ───

  describe("12. Event Emission (Full Paths)", function () {
    it("should emit full event sequence for happy path (single winner)", async function () {
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 7 * DAY;
      const reviewDeadline = deadline + 7 * DAY;

      // TaskCreated
      const createTx = await escrow.connect(creator).createTask(REWARD, 0, singleConfig, 0, deadline, reviewDeadline, 3);
      await expect(createTx).to.emit(escrow, "TaskCreated");

      const taskId = 1n;
      await expect(escrow.connect(creator).deposit(taskId, { value: REWARD })).to.emit(escrow, "TaskFunded");
      await expect(escrow.connect(participant1).accept(taskId)).to.emit(escrow, "TaskAccepted");
      await expect(escrow.connect(participant1).submit(taskId, ethers.keccak256(ethers.toUtf8Bytes("work"))))
        .to.emit(escrow, "SubmissionUploaded");

      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");

      await expect(escrow.connect(creator).startReview(taskId)).to.emit(escrow, "ReviewStarted");
      await expect(escrow.connect(creator).selectWinners(taskId, [participant1.address]))
        .to.emit(escrow, "WinnerSelected");

      const releaseTx = await escrow.connect(creator).release(taskId);
      await expect(releaseTx).to.emit(escrow, "RewardReleased");
      await expect(releaseTx).to.emit(escrow, "PlatformFeeCollected");
    });

    it("should emit correct events for refund path", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);

      const refundTx = await escrow.connect(creator).refund(taskId);
      await expect(refundTx).to.emit(escrow, "TaskRefunded");
      await expect(refundTx).to.emit(escrow, "TaskCancelled");
    });

    it("should emit correct events for dispute resolution path", async function () {
      const taskId = await createTask(escrow, creator);
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);
      await expect(escrow.connect(participant2).raiseDispute(taskId, "0x")).to.emit(escrow, "DisputeRaised");

      const resolveTx = await escrow.connect(admin).resolveDispute(
        taskId, 0, [participant2.address], [REWARD]
      );
      await expect(resolveTx).to.emit(escrow, "DisputeResolved");
      await expect(resolveTx).to.emit(escrow, "RewardReleased");
      await expect(resolveTx).to.emit(escrow, "PlatformFeeCollected");
    });

    it("should emit AutoResolved event", async function () {
      const taskId = await createTask(escrow, creator, {
        winnerSelection: 3,
        rewardConfig: autoTimeoutConfig(0),
      });
      await fundTask(escrow, creator, taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [15 * DAY]);
      await ethers.provider.send("evm_mine");

      await expect(escrow.connect(attacker).autoResolve(taskId)).to.emit(escrow, "AutoResolved").withArgs(taskId, 0);
    });
  });
});
