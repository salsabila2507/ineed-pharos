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
const ZERO_ADDRESS = ethers.ZeroAddress;

describe("iNeedEscrowV2", function () {
  let escrow, token, admin, creator, participant1, participant2, participant3, treasury, attacker;

  beforeEach(async function () {
    [admin, creator, participant1, participant2, participant3, treasury, attacker] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    token = await MockUSDC.deploy();
    await token.waitForDeployment();

    await token.connect(admin).mint(creator.address, ethers.parseUnits("10000000000000000", 6));
    await token.connect(admin).mint(participant1.address, ethers.parseUnits("10000000000000000", 6));
    await token.connect(admin).mint(participant2.address, ethers.parseUnits("10000000000000000", 6));
    await token.connect(admin).mint(treasury.address, ethers.parseUnits("10000000000000000", 6));

    const iNeedEscrowV2 = await ethers.getContractFactory("iNeedEscrowV2");
    escrow = await iNeedEscrowV2.deploy(treasury.address);
    await escrow.waitForDeployment();
  });

  async function createTask(overrides = {}) {
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + (overrides.duration || 7 * DAY);
    const reviewDeadline = deadline + (overrides.reviewDuration || 7 * DAY);
    const rewardAsset = overrides.rewardAsset !== undefined ? overrides.rewardAsset : ZERO_ADDRESS;
    const rewardTotal = overrides.rewardTotal || REWARD;
    const tx = await escrow.connect(overrides.creator || creator).createTask(
      rewardTotal,
      rewardAsset,
      overrides.rewardModel || 0,
      overrides.rewardConfig || singleConfig,
      overrides.winnerSelection || 0,
      deadline,
      reviewDeadline,
      overrides.maxParticipants !== undefined ? overrides.maxParticipants : 3
    );
    const receipt = await tx.wait();
    const log = receipt.logs.find(l => escrow.interface.parseLog({ topics: l.topics, data: l.data }));
    const parsed = escrow.interface.parseLog({ topics: log.topics, data: log.data });
    return parsed.args.taskId;
  }

  async function fundTask(taskId, overrides = {}) {
    const caller = overrides.creator || creator;
    const amount = overrides.amount || REWARD;
    const task = await escrow.tasks(taskId);
    if (task.rewardAsset === ZERO_ADDRESS) {
      await escrow.connect(caller).deposit(taskId, { value: amount });
    } else {
      const tokenContract = await ethers.getContractAt("MockUSDC", task.rewardAsset);
      await tokenContract.connect(caller).approve(await escrow.getAddress(), amount);
      await escrow.connect(caller).deposit(taskId);
    }
  }

  describe("1. Task Creation (V2 Multi-Asset)", function () {
    it("should create a native task with rewardAsset = address(0)", async function () {
      const taskId = await createTask({ rewardAsset: ZERO_ADDRESS });
      const task = await escrow.tasks(taskId);
      expect(task.rewardAsset).to.equal(ZERO_ADDRESS);
      expect(task.creator).to.equal(creator.address);
      expect(task.rewardTotal).to.equal(REWARD);
      expect(task.rewardModel).to.equal(0);
      expect(task.status).to.equal(0);
      expect(task.feeBps).to.equal(200);
      expect(task.feeTreasury).to.equal(treasury.address);
    });

    it("should create an ERC20 task with rewardAsset = token address", async function () {
      const taskId = await createTask({ rewardAsset: await token.getAddress() });
      const task = await escrow.tasks(taskId);
      expect(task.rewardAsset).to.equal(await token.getAddress());
    });

    it("should emit TaskCreated with rewardAsset", async function () {
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 7 * DAY;
      await expect(
        escrow.connect(creator).createTask(REWARD, ZERO_ADDRESS, 0, singleConfig, 0, deadline, deadline + 7 * DAY, 3)
      ).to.emit(escrow, "TaskCreated").withArgs(1n, creator.address, ZERO_ADDRESS, REWARD, deadline);
    });

    it("should create ERC20 multi-winner task", async function () {
      const taskId = await createTask({
        rewardAsset: await token.getAddress(),
        rewardModel: 1,
        rewardConfig: multiEqualConfig(2),
      });
      const task = await escrow.tasks(taskId);
      expect(task.rewardModel).to.equal(1);
      expect(task.rewardAsset).to.equal(await token.getAddress());
    });

    it("should reject zero reward", async function () {
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 7 * DAY;
      await expect(
        escrow.connect(creator).createTask(0, ZERO_ADDRESS, 0, singleConfig, 0, deadline, deadline + 7 * DAY, 3)
      ).to.be.revertedWith("Reward must be > 0");
    });

    it("should reject past deadline", async function () {
      const past = (await ethers.provider.getBlock("latest")).timestamp - 1;
      await expect(
        escrow.connect(creator).createTask(REWARD, ZERO_ADDRESS, 0, singleConfig, 0, past, past + 7 * DAY, 3)
      ).to.be.revertedWith("Deadline must be in the future");
    });

    it("should reject review deadline before submission deadline", async function () {
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 7 * DAY;
      await expect(
        escrow.connect(creator).createTask(REWARD, ZERO_ADDRESS, 0, singleConfig, 0, deadline, deadline - 1, 3)
      ).to.be.revertedWith("Review deadline must be after submission deadline");
    });
  });

  describe("2. Deposit", function () {
    describe("2a. Native PHRS deposit", function () {
      it("should fund a native task and emit TaskFunded", async function () {
        const taskId = await createTask({ rewardAsset: ZERO_ADDRESS });
        await expect(escrow.connect(creator).deposit(taskId, { value: REWARD }))
          .to.emit(escrow, "TaskFunded").withArgs(taskId, REWARD);
        const task = await escrow.tasks(taskId);
        expect(task.status).to.equal(2);
      });

      it("should revert native deposit with wrong msg.value", async function () {
        const taskId = await createTask({ rewardAsset: ZERO_ADDRESS });
        await expect(escrow.connect(creator).deposit(taskId, { value: ethers.parseEther("50") }))
          .to.be.revertedWith("msg.value must equal rewardTotal");
      });
    });

    describe("2b. ERC20 USDC deposit", function () {
      it("should fund an ERC20 task via transferFrom", async function () {
        const taskId = await createTask({ rewardAsset: await token.getAddress() });
        const tokenAddr = await token.getAddress();
        const escrowAddr = await escrow.getAddress();

        await token.connect(creator).approve(escrowAddr, REWARD);
        const creatorBefore = await token.balanceOf(creator.address);
        await escrow.connect(creator).deposit(taskId);

        expect(await token.balanceOf(escrowAddr)).to.equal(REWARD);
        expect(await token.balanceOf(creator.address)).to.equal(creatorBefore - REWARD);
        const task = await escrow.tasks(taskId);
        expect(task.status).to.equal(2);
      });

      it("should emit TaskFunded for ERC20 deposit", async function () {
        const taskId = await createTask({ rewardAsset: await token.getAddress() });
        await token.connect(creator).approve(await escrow.getAddress(), REWARD);
        await expect(escrow.connect(creator).deposit(taskId))
          .to.emit(escrow, "TaskFunded").withArgs(taskId, REWARD);
      });

      it("should revert ERC20 deposit with msg.value > 0", async function () {
        const taskId = await createTask({ rewardAsset: await token.getAddress() });
        await token.connect(creator).approve(await escrow.getAddress(), REWARD);
        await expect(escrow.connect(creator).deposit(taskId, { value: 1 }))
          .to.be.revertedWith("msg.value must be 0 for ERC20 deposit");
      });

      it("should revert ERC20 deposit without approval", async function () {
        const taskId = await createTask({ rewardAsset: await token.getAddress() });
        await expect(escrow.connect(creator).deposit(taskId))
          .to.be.reverted;
      });

      it("should revert if non-creator deposits", async function () {
        const taskId = await createTask({ rewardAsset: ZERO_ADDRESS });
        await expect(escrow.connect(attacker).deposit(taskId, { value: REWARD }))
          .to.be.revertedWith("Only creator");
      });

      it("should set correct escrow balance for both asset types", async function () {
        let taskId = await createTask({ rewardAsset: ZERO_ADDRESS });
        await fundTask(taskId);
        let escrowData = await escrow.getEscrow(taskId);
        expect(escrowData.totalAmount).to.equal(REWARD);

        taskId = await createTask({ rewardAsset: await token.getAddress() });
        await fundTask(taskId);
        escrowData = await escrow.getEscrow(taskId);
        expect(escrowData.totalAmount).to.equal(REWARD);
      });
    });

    it("should revert if already funded", async function () {
      const taskId = await createTask({ rewardAsset: ZERO_ADDRESS });
      await escrow.connect(creator).deposit(taskId, { value: REWARD });
      await expect(escrow.connect(creator).deposit(taskId, { value: REWARD }))
        .to.be.revertedWith("Task not in Created state");
    });

    it("should accept deposit with fee snapshot at creation", async function () {
      await escrow.connect(admin).setFeeBps(500);
      const taskId = await createTask({ rewardAsset: ZERO_ADDRESS });
      await escrow.connect(creator).deposit(taskId, { value: REWARD });
      const task = await escrow.tasks(taskId);
      expect(task.feeBps).to.equal(500);
    });
  });

  describe("3. Accept & Submit", function () {
    it("should accept a participant and emit TaskAccepted", async function () {
      const taskId = await createTask({ rewardAsset: ZERO_ADDRESS });
      await fundTask(taskId);
      await expect(escrow.connect(participant1).accept(taskId))
        .to.emit(escrow, "TaskAccepted").withArgs(taskId, participant1.address);
    });

    it("should not accept if already accepted", async function () {
      const taskId = await createTask();
      await fundTask(taskId);
      await escrow.connect(participant1).accept(taskId);
      await expect(escrow.connect(participant1).accept(taskId))
        .to.be.revertedWith("Already accepted");
    });

    it("should not accept if max participants reached", async function () {
      const taskId = await createTask({ maxParticipants: 2 });
      await fundTask(taskId);
      await escrow.connect(participant1).accept(taskId);
      await escrow.connect(participant2).accept(taskId);
      await expect(escrow.connect(participant3).accept(taskId))
        .to.be.revertedWith("Max participants reached");
    });

    it("should not accept if task not open", async function () {
      const taskId = await createTask();
      await expect(escrow.connect(participant1).accept(taskId))
        .to.be.revertedWith("Task not open for acceptance");
    });

    it("should submit work and emit SubmissionUploaded", async function () {
      const taskId = await createTask();
      await fundTask(taskId);
      await escrow.connect(participant1).accept(taskId);
      const contentHash = ethers.keccak256(ethers.toUtf8Bytes("my work"));
      await expect(escrow.connect(participant1).submit(taskId, contentHash))
        .to.emit(escrow, "SubmissionUploaded").withArgs(taskId, participant1.address, contentHash);
    });

    it("should not submit if not accepted", async function () {
      const taskId = await createTask();
      await fundTask(taskId);
      await escrow.connect(participant1).accept(taskId);
      await expect(escrow.connect(attacker).submit(taskId, ethers.keccak256(ethers.toUtf8Bytes("hack"))))
        .to.be.revertedWith("Not an accepted participant");
    });

    it("should not submit twice", async function () {
      const taskId = await createTask();
      await fundTask(taskId);
      await escrow.connect(participant1).accept(taskId);
      await escrow.connect(participant1).submit(taskId, ethers.keccak256(ethers.toUtf8Bytes("work1")));
      await expect(escrow.connect(participant1).submit(taskId, ethers.keccak256(ethers.toUtf8Bytes("work2"))))
        .to.be.revertedWith("Already submitted");
    });

    it("should not submit after deadline", async function () {
      const taskId = await createTask({ duration: 10 });
      await fundTask(taskId);
      await escrow.connect(participant1).accept(taskId);
      await ethers.provider.send("evm_increaseTime", [15]);
      await ethers.provider.send("evm_mine");
      await expect(escrow.connect(participant1).submit(taskId, ethers.keccak256(ethers.toUtf8Bytes("late"))))
        .to.be.revertedWith("Submission deadline passed");
    });
  });

  describe("4. Single Winner Selection & Release", function () {
    async function fullSingleFlow(taskId) {
      await fundTask(taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);
    }

    it("should release native PHRS to single winner with fee deducted", async function () {
      const taskId = await createTask({ rewardAsset: ZERO_ADDRESS });
      await fullSingleFlow(taskId);

      const balBefore = await ethers.provider.getBalance(participant1.address);
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);

      await release(escrow, creator, taskId);

      const fee = REWARD * 200n / 10000n;
      const payout = REWARD - fee;
      expect(await ethers.provider.getBalance(participant1.address)).to.equal(balBefore + payout);
      expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore + fee);
      const s = await escrow.tasks(taskId);
      expect(s.status).to.equal(6);
    });

    it("should release ERC20 USDC to single winner with fee deducted", async function () {
      const taskId = await createTask({ rewardAsset: await token.getAddress() });
      await fullSingleFlow(taskId);

      const balBefore = await token.balanceOf(participant1.address);
      const treasuryBefore = await token.balanceOf(treasury.address);

      await release(escrow, creator, taskId);

      const fee = REWARD * 200n / 10000n;
      const payout = REWARD - fee;
      expect(await token.balanceOf(participant1.address)).to.equal(balBefore + payout);
      expect(await token.balanceOf(treasury.address)).to.equal(treasuryBefore + fee);
    });

    it("should emit RewardReleased and PlatformFeeCollected for both assets", async function () {
      for (const assetDesc of ["native", "ERC20"]) {
        const rewardAsset = assetDesc === "native" ? ZERO_ADDRESS : await token.getAddress();
        const taskId = await createTask({ rewardAsset });
        await fundTask(taskId);
        await acceptTask(escrow, participant1, taskId);
        await submitWork(escrow, participant1, taskId);
        await ethers.provider.send("evm_increaseTime", [8 * DAY]);
        await ethers.provider.send("evm_mine");
        await startReview(escrow, creator, taskId);
        await selectWinners(escrow, creator, taskId, [participant1.address]);

        const fee = REWARD * 200n / 10000n;
        const payout = REWARD - fee;

        const releaseTx = await escrow.connect(creator).release(taskId);
        await expect(releaseTx).to.emit(escrow, "RewardReleased").withArgs(taskId, participant1.address, payout);
        await expect(releaseTx).to.emit(escrow, "PlatformFeeCollected").withArgs(taskId, fee, treasury.address);
      }
    });

    it("should revert if no winners selected", async function () {
      const taskId = await createTask();
      await fundTask(taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await expect(release(escrow, creator, taskId)).to.be.revertedWith("Winners not selected");
    });

    it("should revert if non-creator selects winner", async function () {
      const taskId = await createTask();
      await fundTask(taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await expect(escrow.connect(attacker).selectWinners(taskId, [participant1.address]))
        .to.be.revertedWith("Only creator");
    });

    it("should reject non-participant as winner", async function () {
      const taskId = await createTask();
      await fundTask(taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await expect(selectWinners(escrow, creator, taskId, [attacker.address]))
        .to.be.revertedWith("Winner not a participant");
    });

    it("should reject selecting winner before Review state", async function () {
      const taskId = await createTask();
      await fundTask(taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await expect(selectWinners(escrow, creator, taskId, [participant1.address]))
        .to.be.revertedWith("Task not in Review state");
    });
  });

  describe("5. Multiple Winners", function () {
    it("should split equally among winners (native)", async function () {
      const taskId = await createTask({
        rewardModel: 1,
        rewardConfig: multiEqualConfig(2),
      });
      await fundTask(taskId);
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
      const payoutPool = REWARD - fee;
      const each = payoutPool / 2n;
      expect(await ethers.provider.getBalance(participant1.address)).to.equal(balP1Before + each);
      expect(await ethers.provider.getBalance(participant2.address)).to.equal(balP2Before + each);
    });

    it("should split equally among winners (ERC20)", async function () {
      const taskId = await createTask({
        rewardAsset: await token.getAddress(),
        rewardModel: 1,
        rewardConfig: multiEqualConfig(2),
      });
      await fundTask(taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address, participant2.address]);

      const balP1Before = await token.balanceOf(participant1.address);
      const balP2Before = await token.balanceOf(participant2.address);
      await release(escrow, creator, taskId);

      const fee = REWARD * 200n / 10000n;
      const payoutPool = REWARD - fee;
      const each = payoutPool / 2n;
      expect(await token.balanceOf(participant1.address)).to.equal(balP1Before + each);
      expect(await token.balanceOf(participant2.address)).to.equal(balP2Before + each);
    });

    it("should split weighted among winners (native)", async function () {
      const taskId = await createTask({
        rewardModel: 1,
        rewardConfig: multiWeightedConfig(2, [70, 30]),
      });
      await fundTask(taskId);
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
      const payoutPool = REWARD - fee;
      const p1Amount = payoutPool * 70n / 100n;
      const p2Amount = payoutPool - p1Amount;
      expect(await ethers.provider.getBalance(participant1.address)).to.equal(balP1Before + p1Amount);
      expect(await ethers.provider.getBalance(participant2.address)).to.equal(balP2Before + p2Amount);
    });
  });

  describe("6. Refund", function () {
    it("should refund native PHRS to creator", async function () {
      const taskId = await createTask({ rewardAsset: ZERO_ADDRESS });
      await fundTask(taskId);
      const creatorBefore = await ethers.provider.getBalance(creator.address);
      const tx = await escrow.connect(creator).refund(taskId);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      expect(await ethers.provider.getBalance(creator.address)).to.equal(creatorBefore + REWARD - gasCost);
      const s2 = await escrow.tasks(taskId);
      expect(s2.status).to.equal(9);
    });

    it("should refund ERC20 USDC to creator", async function () {
      const taskId = await createTask({ rewardAsset: await token.getAddress() });
      await fundTask(taskId);
      const creatorBefore = await token.balanceOf(creator.address);
      const escrowBefore = await token.balanceOf(await escrow.getAddress());
      await escrow.connect(creator).refund(taskId);
      expect(await token.balanceOf(creator.address)).to.equal(creatorBefore + escrowBefore);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    });

    it("should not charge fee on refund for either asset", async function () {
      const taskId = await createTask({ rewardAsset: ZERO_ADDRESS });
      await fundTask(taskId);
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);
      await escrow.connect(creator).refund(taskId);
      expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore);
    });

    it("should revert refund after participant accepts", async function () {
      const taskId = await createTask();
      await fundTask(taskId);
      await acceptTask(escrow, participant1, taskId);
      await expect(escrow.connect(creator).refund(taskId)).to.be.revertedWith("Cannot refund at current state");
    });

    it("should revert refund from non-creator", async function () {
      const taskId = await createTask();
      await fundTask(taskId);
      await expect(escrow.connect(attacker).refund(taskId)).to.be.revertedWith("Only creator");
    });
  });

  describe("7. Dispute & Resolution", function () {
    async function setupDispute(rewardAsset) {
      const taskId = await createTask({ rewardAsset });
      await fundTask(taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);
      return taskId;
    }

    it("should resolve dispute in favor of participant (native)", async function () {
      const taskId = await setupDispute(ZERO_ADDRESS);
      await escrow.connect(participant2).raiseDispute(taskId, "0x");

      const balBefore = await ethers.provider.getBalance(participant2.address);
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);

      await escrow.connect(admin).resolveDispute(taskId, 0, [participant2.address], [REWARD]);

      const fee = REWARD * 200n / 10000n;
      const payout = REWARD - fee;
      expect(await ethers.provider.getBalance(participant2.address)).to.equal(balBefore + payout);
      expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore + fee);
    });

    it("should resolve dispute in favor of participant (ERC20)", async function () {
      const taskId = await setupDispute(await token.getAddress());
      await escrow.connect(participant2).raiseDispute(taskId, "0x");

      const balBefore = await token.balanceOf(participant2.address);
      const treasuryBefore = await token.balanceOf(treasury.address);

      await escrow.connect(admin).resolveDispute(taskId, 0, [participant2.address], [REWARD]);

      const fee = REWARD * 200n / 10000n;
      const payout = REWARD - fee;
      expect(await token.balanceOf(participant2.address)).to.equal(balBefore + payout);
      expect(await token.balanceOf(treasury.address)).to.equal(treasuryBefore + fee);
    });

    it("should resolve dispute in favor of creator (no fee)", async function () {
      const taskId = await setupDispute(ZERO_ADDRESS);
      await escrow.connect(participant2).raiseDispute(taskId, "0x");

      const treasuryBefore = await ethers.provider.getBalance(treasury.address);
      await escrow.connect(admin).resolveDispute(taskId, 1, [], []);

      expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    });

    it("should handle Split ruling", async function () {
      const taskId = await setupDispute(ZERO_ADDRESS);
      await escrow.connect(participant2).raiseDispute(taskId, "0x");

      const balP1 = await ethers.provider.getBalance(participant1.address);
      const treasuryBal = await ethers.provider.getBalance(treasury.address);

      const participantGross = ethers.parseEther("50");
      const fee = participantGross * 200n / 10000n;
      const netToParticipant = participantGross - fee;

      await escrow.connect(admin).resolveDispute(taskId, 2, [participant1.address], [participantGross]);

      expect(await ethers.provider.getBalance(participant1.address)).to.equal(balP1 + netToParticipant);
      expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBal + fee);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    });
  });

  describe("8. Auto Resolve (Timeout)", function () {
    async function setupAutoResolve(rewardAsset, action = 0) {
      const taskId = await createTask({
        rewardAsset,
        winnerSelection: 3,
        rewardConfig: autoTimeoutConfig(action),
      });
      await fundTask(taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId, ethers.keccak256(ethers.toUtf8Bytes("first")));
      await ethers.provider.send("evm_increaseTime", [1]);
      await ethers.provider.send("evm_mine");
      await submitWork(escrow, participant2, taskId, ethers.keccak256(ethers.toUtf8Bytes("second")));
      await ethers.provider.send("evm_increaseTime", [15 * DAY]);
      await ethers.provider.send("evm_mine");
      return taskId;
    }

    it("should auto resolve with PayAll (native)", async function () {
      const taskId = await setupAutoResolve(ZERO_ADDRESS, 0);
      const balP1 = await ethers.provider.getBalance(participant1.address);
      const balP2 = await ethers.provider.getBalance(participant2.address);
      await escrow.connect(attacker).autoResolve(taskId);
      const fee = REWARD * 200n / 10000n;
      const payoutPool = REWARD - fee;
      const each = payoutPool / 2n;
      expect(await ethers.provider.getBalance(participant1.address)).to.equal(balP1 + each);
      expect(await ethers.provider.getBalance(participant2.address)).to.equal(balP2 + (payoutPool - each));
    });

    it("should auto resolve with PayAll (ERC20)", async function () {
      const taskId = await setupAutoResolve(await token.getAddress(), 0);
      const balP1 = await token.balanceOf(participant1.address);
      const balP2 = await token.balanceOf(participant2.address);
      await escrow.connect(attacker).autoResolve(taskId);
      const fee = REWARD * 200n / 10000n;
      const payoutPool = REWARD - fee;
      const each = payoutPool / 2n;
      expect(await token.balanceOf(participant1.address)).to.equal(balP1 + each);
      expect(await token.balanceOf(participant2.address)).to.equal(balP2 + (payoutPool - each));
    });

    it("should auto resolve with Refund (no fee)", async function () {
      const taskId = await setupAutoResolve(ZERO_ADDRESS, 1);
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);
      await escrow.connect(attacker).autoResolve(taskId);
      expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    });

    it("should auto resolve with FirstSubmission (ERC20)", async function () {
      const taskId = await setupAutoResolve(await token.getAddress(), 2);
      const balP1 = await token.balanceOf(participant1.address);
      await escrow.connect(attacker).autoResolve(taskId);
      const fee = REWARD * 200n / 10000n;
      const payout = REWARD - fee;
      expect(await token.balanceOf(participant1.address)).to.equal(balP1 + payout);
    });

    it("should revert autoResolve before review deadline", async function () {
      const taskId = await createTask({
        winnerSelection: 3,
        rewardConfig: autoTimeoutConfig(0),
      });
      await fundTask(taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await expect(escrow.connect(attacker).autoResolve(taskId))
        .to.be.revertedWith("Review deadline not yet passed");
    });
  });

  describe("9. Fee Snapshots & Admin", function () {
    it("should snapshot fee at task creation", async function () {
      const taskIdA = await createTask({ rewardAsset: ZERO_ADDRESS });
      await fundTask(taskIdA);
      await acceptTask(escrow, participant1, taskIdA);
      await submitWork(escrow, participant1, taskIdA);
      await escrow.connect(admin).setFeeBps(500);
      const taskIdB = await createTask({ rewardAsset: ZERO_ADDRESS });
      expect((await escrow.tasks(taskIdA)).feeBps).to.equal(200);
      expect((await escrow.tasks(taskIdB)).feeBps).to.equal(500);
    });

    it("should use snapshotted fee on release", async function () {
      const taskId = await createTask({ rewardAsset: ZERO_ADDRESS });
      await fundTask(taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await escrow.connect(admin).setFeeBps(500);
      await selectWinners(escrow, creator, taskId, [participant1.address]);
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);
      await release(escrow, creator, taskId);
      const fee = REWARD * 200n / 10000n;
      expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore + fee);
    });

    it("should enforce maxFeeBps ceiling", async function () {
      await expect(escrow.connect(admin).setFeeBps(1001)).to.be.revertedWith("Fee exceeds max");
    });

    it("should revert zero treasury address", async function () {
      await expect(escrow.connect(admin).setFeeTreasury(ethers.ZeroAddress))
        .to.be.revertedWith("Treasury cannot be zero");
    });

    it("should revert non-admin setting fee", async function () {
      await expect(escrow.connect(creator).setFeeBps(300)).to.be.revertedWith("Only admin");
    });
  });

  describe("10. Edge Cases & Security", function () {
    it("should handle zero fee correctly", async function () {
      await escrow.connect(admin).setFeeBps(0);
      const taskId = await createTask({ rewardAsset: ZERO_ADDRESS });
      await fundTask(taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);
      const balBefore = await ethers.provider.getBalance(participant1.address);
      await release(escrow, creator, taskId);
      expect(await ethers.provider.getBalance(participant1.address)).to.equal(balBefore + REWARD);
    });

    it("should handle minimum reward (1 wei) for native", async function () {
      const minReward = 1n;
      const taskId = await createTask({ rewardTotal: minReward, rewardAsset: ZERO_ADDRESS });
      await escrow.connect(creator).deposit(taskId, { value: minReward });
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);
      const balBefore = await ethers.provider.getBalance(participant1.address);
      await release(escrow, creator, taskId);
      expect(await ethers.provider.getBalance(participant1.address)).to.equal(balBefore + minReward);
    });

    it("should handle minimum reward (1 unit) for ERC20", async function () {
      const minReward = 1n;
      const taskId = await createTask({ rewardTotal: minReward, rewardAsset: await token.getAddress() });
      await token.connect(creator).approve(await escrow.getAddress(), minReward);
      await escrow.connect(creator).deposit(taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await selectWinners(escrow, creator, taskId, [participant1.address]);
      const balBefore = await token.balanceOf(participant1.address);
      await release(escrow, creator, taskId);
      expect(await token.balanceOf(participant1.address)).to.equal(balBefore + minReward);
    });

    it("should reject duplicate winner addresses", async function () {
      const taskId = await createTask({
        rewardModel: 1,
        rewardConfig: multiEqualConfig(2),
      });
      await fundTask(taskId);
      await acceptTask(escrow, participant1, taskId);
      await acceptTask(escrow, participant2, taskId);
      await submitWork(escrow, participant1, taskId);
      await submitWork(escrow, participant2, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await expect(selectWinners(escrow, creator, taskId, [participant1.address, participant1.address]))
        .to.be.revertedWith("Duplicate winner");
    });

    it("should reject release on disputed task", async function () {
      const taskId = await createTask({ rewardAsset: ZERO_ADDRESS });
      await fundTask(taskId);
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

    it("should allow contract to hold both native and ERC20 funds simultaneously", async function () {
      const task1 = await createTask({ rewardAsset: ZERO_ADDRESS });
      const task2 = await createTask({ rewardAsset: await token.getAddress() });
      await fundTask(task1);
      await fundTask(task2);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(REWARD);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(REWARD);
    });

    it("should select winners in native task then release (ERC20 task separate)", async function () {
      const nativeTask = await createTask({ rewardAsset: ZERO_ADDRESS });
      const usdcTask = await createTask({ rewardAsset: await token.getAddress() });
      await fundTask(nativeTask);
      await fundTask(usdcTask);
      await acceptTask(escrow, participant1, nativeTask);
      await acceptTask(escrow, participant1, usdcTask);
      await submitWork(escrow, participant1, nativeTask);
      await submitWork(escrow, participant1, usdcTask);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, nativeTask);
      await startReview(escrow, creator, usdcTask);
      await selectWinners(escrow, creator, nativeTask, [participant1.address]);
      await selectWinners(escrow, creator, usdcTask, [participant1.address]);

      const nativeBalBefore = await ethers.provider.getBalance(participant1.address);
      const usdcBalBefore = await token.balanceOf(participant1.address);

      await release(escrow, creator, nativeTask);
      await release(escrow, creator, usdcTask);

      const fee = REWARD * 200n / 10000n;
      const payout = REWARD - fee;
      expect(await ethers.provider.getBalance(participant1.address)).to.equal(nativeBalBefore + payout);
      expect(await token.balanceOf(participant1.address)).to.equal(usdcBalBefore + payout);
    });

    it("should allow admin transfer", async function () {
      await escrow.connect(admin).transferAdmin(creator.address);
      expect(await escrow.admin()).to.equal(creator.address);
    });

    it("should revert selectWinners with empty array", async function () {
      const taskId = await createTask({ rewardAsset: ZERO_ADDRESS });
      await fundTask(taskId);
      await acceptTask(escrow, participant1, taskId);
      await submitWork(escrow, participant1, taskId);
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");
      await startReview(escrow, creator, taskId);
      await expect(selectWinners(escrow, creator, taskId, [])).to.be.revertedWith("Must select at least one winner");
    });
  });
});

async function acceptTask(escrow, participant, taskId) {
  await escrow.connect(participant).accept(taskId);
}

async function submitWork(escrow, participant, taskId, contentHash) {
  if (!contentHash) contentHash = ethers.keccak256(ethers.toUtf8Bytes("work"));
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
