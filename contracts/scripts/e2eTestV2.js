const hre = require("hardhat");
const { ethers } = hre;

const ZERO_ADDR = ethers.ZeroAddress;
const ESCROW_ADDR = "0x27D17774B2aeCe56C41140cFf99894Be36Ac661e";
const MOCK_USDC_ADDR = "0x396b9B29E9D98EC8630dCEa9B528c785AFE916FA";
const EXPLORER = "https://atlantic.pharosscan.xyz/tx";

function fmt(amount, decimals = 18) {
  return ethers.formatUnits(amount, decimals);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  console.log(`Network: Pharos Atlantic Testnet (chain ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Deployer PHRS: ${fmt(await ethers.provider.getBalance(deployer.address))}\n`);

  const escrow = await ethers.getContractAt("iNeedEscrowV2", ESCROW_ADDR);
  const mockUsdc = await ethers.getContractAt("MockUSDC", MOCK_USDC_ADDR);
  const mockUsdcDec = await mockUsdc.decimals();

  const p1 = ethers.Wallet.createRandom().connect(ethers.provider);
  const p2 = ethers.Wallet.createRandom().connect(ethers.provider);

  const gasSeed = ethers.parseEther("0.02");
  console.log(`Funding participant 1 (${p1.address.slice(0, 10)}...) with ${fmt(gasSeed)} PHRS`);
  await deployer.sendTransaction({ to: p1.address, value: gasSeed });
  console.log(`Funding participant 2 (${p2.address.slice(0, 10)}...) with ${fmt(gasSeed)} PHRS`);
  await deployer.sendTransaction({ to: p2.address, value: gasSeed });

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const singleConfig = abiCoder.encode(["bool"], [true]);
  const now = Math.floor(Date.now() / 1000);
  const DAY = 86400;

  const results = { flows: {}, errors: [] };

  // ════════════════════════════════════════════════════════════════
  // FLOW 1: NATIVE PHRS
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════");
  console.log("FLOW 1: Native PHRS — Create → Fund → Accept → Submit → Select → Release");
  console.log("═══════════════════════════════════════════\n");

  try {
    const rewardPHRS = ethers.parseEther("0.5");
    const deadline = now + 7 * DAY;
    const reviewDeadline = deadline + 7 * DAY;

    console.log("[1.1] Creating native task...");
    const createTx1 = await escrow.connect(deployer).createTask(
      rewardPHRS, ZERO_ADDR, 0, singleConfig, 0, deadline, reviewDeadline, 3
    );
    const createReceipt1 = await createTx1.wait();
    const taskId1 = escrow.interface.parseLog({
      topics: createReceipt1.logs[0].topics,
      data: createReceipt1.logs[0].data,
    }).args.taskId;
    console.log(`  Task #${taskId1} created`);
    console.log(`  Tx: ${EXPLORER}/${createTx1.hash}`);

    console.log("[1.2] Funding task with 0.5 PHRS...");
    const fundTx1 = await escrow.connect(deployer).deposit(taskId1, { value: rewardPHRS });
    await fundTx1.wait();
    const task1AfterFund = await escrow.tasks(taskId1);
    console.log(`  Status: ${Number(task1AfterFund.status)} (expected 2=Open)`);
    console.log(`  Tx: ${EXPLORER}/${fundTx1.hash}`);

    console.log("[1.3] Participant 1 accepting...");
    const acceptTx1 = await escrow.connect(p1).accept(taskId1);
    await acceptTx1.wait();
    console.log(`  hasAccepted: ${await escrow.hasAccepted(taskId1, p1.address)}`);
    console.log(`  Tx: ${EXPLORER}/${acceptTx1.hash}`);

    console.log("[1.4] Participant 1 submitting work...");
    const content1 = ethers.keccak256(ethers.toUtf8Bytes("native e2e work " + Date.now()));
    const submitTx1 = await escrow.connect(p1).submit(taskId1, content1);
    await submitTx1.wait();
    console.log(`  Submission count: ${Number((await escrow.tasks(taskId1)).submissionCount)}`);
    console.log(`  Tx: ${EXPLORER}/${submitTx1.hash}`);

    console.log("[1.5] Starting review...");
    const reviewTx1 = await escrow.connect(deployer).startReview(taskId1);
    await reviewTx1.wait();
    console.log(`  Status: ${Number((await escrow.tasks(taskId1)).status)} (expected 5=Review)`);
    console.log(`  Tx: ${EXPLORER}/${reviewTx1.hash}`);

    console.log("[1.6] Selecting winner...");
    const selectTx1 = await escrow.connect(deployer).selectWinners(taskId1, [p1.address]);
    await selectTx1.wait();
    console.log(`  Winners: ${(await escrow.tasks(taskId1)).winnersSelected}`);
    console.log(`  Tx: ${EXPLORER}/${selectTx1.hash}`);

    const p1BalBefore = await ethers.provider.getBalance(p1.address);
    const treasuryBefore1 = await ethers.provider.getBalance(await escrow.feeTreasury());
    console.log("[1.7] Releasing reward...");
    const releaseTx1 = await escrow.connect(deployer).release(taskId1);
    await releaseTx1.wait();
    const taskFinal1 = await escrow.tasks(taskId1);
    const escrowData1 = await escrow.getEscrow(taskId1);
    const p1BalAfter = await ethers.provider.getBalance(p1.address);
    const treasuryAfter1 = await ethers.provider.getBalance(await escrow.feeTreasury());

    const expectedFee = rewardPHRS * 200n / 10000n;
    const expectedPayout = rewardPHRS - expectedFee;
    console.log(`  Status: ${Number(taskFinal1.status)} (expected 6=Completed)`);
    console.log(`  Released: ${fmt(escrowData1.releasedAmount)} (expected ${fmt(expectedPayout)})`);
    console.log(`  Fee: ${fmt(escrowData1.feeCollected)} (expected ${fmt(expectedFee)})`);
    console.log(`  P1 PHRS delta: +${fmt(p1BalAfter - p1BalBefore)} (expected +${fmt(expectedPayout)})`);
    console.log(`  Treasury PHRS delta: +${fmt(treasuryAfter1 - treasuryBefore1)} (expected +${fmt(expectedFee)})`);
    console.log(`  Tx: ${EXPLORER}/${releaseTx1.hash}`);

    results.flows.native = {
      taskId: taskId1.toString(),
      status: "ok",
      createTx: createTx1.hash,
      depositTx: fundTx1.hash,
      acceptTx: acceptTx1.hash,
      submitTx: submitTx1.hash,
      reviewTx: reviewTx1.hash,
      selectTx: selectTx1.hash,
      releaseTx: releaseTx1.hash,
      payout: expectedPayout.toString(),
      fee: expectedFee.toString(),
    };
  } catch (err) {
    console.error(`[ERROR] Native flow: ${err.message}`);
    results.flows.native = { status: "error", error: err.message };
    results.errors.push({ flow: "native", error: err.message });
  }

  // ════════════════════════════════════════════════════════════════
  // FLOW 2: MockUSDC ERC20
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════");
  console.log("FLOW 2: MockUSDC ERC20 — Create → Approve → Deposit → Accept → Submit → Select → Release");
  console.log("═══════════════════════════════════════════\n");

  try {
    const rewardUSDC = ethers.parseUnits("50", mockUsdcDec);
    const deadline2 = now + 7 * DAY;
    const reviewDeadline2 = deadline2 + 7 * DAY;

    const deployerMockBal = await mockUsdc.balanceOf(deployer.address);
    if (deployerMockBal < rewardUSDC) {
      console.log(`  Minting MockUSDC to deployer...`);
      await mockUsdc.mint(deployer.address, rewardUSDC);
    }
    console.log(`  Deployer MockUSDC: ${fmt(await mockUsdc.balanceOf(deployer.address), mockUsdcDec)}`);

    console.log("[2.1] Creating ERC20 task...");
    const createTx2 = await escrow.connect(deployer).createTask(
      rewardUSDC, MOCK_USDC_ADDR, 0, singleConfig, 0, deadline2, reviewDeadline2, 3
    );
    const createReceipt2 = await createTx2.wait();
    const taskId2 = escrow.interface.parseLog({
      topics: createReceipt2.logs[0].topics,
      data: createReceipt2.logs[0].data,
    }).args.taskId;
    console.log(`  Task #${taskId2} created`);
    console.log(`  Tx: ${EXPLORER}/${createTx2.hash}`);

    console.log("[2.2] Approving escrow to spend MockUSDC...");
    const approveTx2 = await mockUsdc.connect(deployer).approve(ESCROW_ADDR, rewardUSDC);
    await approveTx2.wait();
    const allowance = await mockUsdc.allowance(deployer.address, ESCROW_ADDR);
    console.log(`  Allowance: ${fmt(allowance, mockUsdcDec)}`);
    console.log(`  Tx: ${EXPLORER}/${approveTx2.hash}`);

    const escrowMockBefore = await mockUsdc.balanceOf(ESCROW_ADDR);
    console.log("[2.3] Depositing ERC20 (no msg.value)...");
    const fundTx2 = await escrow.connect(deployer).deposit(taskId2);
    await fundTx2.wait();
    const escrowMockAfter = await mockUsdc.balanceOf(ESCROW_ADDR);
    console.log(`  Escrow MockUSDC: ${fmt(escrowMockBefore, mockUsdcDec)} → ${fmt(escrowMockAfter, mockUsdcDec)}`);
    console.log(`  Status: ${Number((await escrow.tasks(taskId2)).status)} (expected 2=Open)`);
    console.log(`  Tx: ${EXPLORER}/${fundTx2.hash}`);

    console.log("[2.4] Participant 2 accepting...");
    const acceptTx2 = await escrow.connect(p2).accept(taskId2);
    await acceptTx2.wait();
    console.log(`  hasAccepted: ${await escrow.hasAccepted(taskId2, p2.address)}`);
    console.log(`  Tx: ${EXPLORER}/${acceptTx2.hash}`);

    console.log("[2.5] Participant 2 submitting work...");
    const content2 = ethers.keccak256(ethers.toUtf8Bytes("erc20 e2e work " + Date.now()));
    const submitTx2 = await escrow.connect(p2).submit(taskId2, content2);
    await submitTx2.wait();
    console.log(`  Tx: ${EXPLORER}/${submitTx2.hash}`);

    console.log("[2.6] Starting review...");
    const reviewTx2 = await escrow.connect(deployer).startReview(taskId2);
    await reviewTx2.wait();
    console.log(`  Tx: ${EXPLORER}/${reviewTx2.hash}`);

    console.log("[2.7] Selecting winner...");
    const selectTx2 = await escrow.connect(deployer).selectWinners(taskId2, [p2.address]);
    await selectTx2.wait();
    console.log(`  Tx: ${EXPLORER}/${selectTx2.hash}`);

    const p2MockBefore = await mockUsdc.balanceOf(p2.address);
    const treasuryBefore2 = await mockUsdc.balanceOf(await escrow.feeTreasury());
    console.log("[2.8] Releasing ERC20 reward...");
    const releaseTx2 = await escrow.connect(deployer).release(taskId2);
    await releaseTx2.wait();
    const taskFinal2 = await escrow.tasks(taskId2);
    const escrowData2 = await escrow.getEscrow(taskId2);
    const p2MockAfter = await mockUsdc.balanceOf(p2.address);
    const treasuryAfter2 = await mockUsdc.balanceOf(await escrow.feeTreasury());

    const expectedFee2 = rewardUSDC * 200n / 10000n;
    const expectedPayout2 = rewardUSDC - expectedFee2;
    console.log(`  Status: ${Number(taskFinal2.status)} (expected 6=Completed)`);
    console.log(`  Released: ${fmt(escrowData2.releasedAmount, mockUsdcDec)} (expected ${fmt(expectedPayout2, mockUsdcDec)})`);
    console.log(`  Fee: ${fmt(escrowData2.feeCollected, mockUsdcDec)} (expected ${fmt(expectedFee2, mockUsdcDec)})`);
    console.log(`  P2 USDC delta: +${fmt(p2MockAfter - p2MockBefore, mockUsdcDec)} (expected +${fmt(expectedPayout2, mockUsdcDec)})`);
    console.log(`  Treasury USDC delta: +${fmt(treasuryAfter2 - treasuryBefore2, mockUsdcDec)} (expected +${fmt(expectedFee2, mockUsdcDec)})`);
    console.log(`  Tx: ${EXPLORER}/${releaseTx2.hash}`);

    results.flows.erc20 = {
      taskId: taskId2.toString(),
      status: "ok",
      createTx: createTx2.hash,
      approveTx: approveTx2.hash,
      depositTx: fundTx2.hash,
      acceptTx: acceptTx2.hash,
      submitTx: submitTx2.hash,
      reviewTx: reviewTx2.hash,
      selectTx: selectTx2.hash,
      releaseTx: releaseTx2.hash,
      payout: expectedPayout2.toString(),
      fee: expectedFee2.toString(),
    };
  } catch (err) {
    console.error(`[ERROR] ERC20 flow: ${err.message}`);
    if (err.transaction) console.error(`  Failed tx: ${EXPLORER}/${err.transaction.hash}`);
    results.flows.erc20 = { status: "error", error: err.message };
    results.errors.push({ flow: "erc20", error: err.message });
  }

  // ════════════════════════════════════════════════════════════════
  // FLOW 3: REFUND (Native)
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════");
  console.log("FLOW 3: Refund (Native) — Create → Fund → Refund");
  console.log("═══════════════════════════════════════════\n");

  try {
    const rewardRefund = ethers.parseEther("0.3");
    const deadline3 = now + 7 * DAY;
    const reviewDeadline3 = deadline3 + 7 * DAY;

    console.log("[3.1] Creating refund task...");
    const createTx3 = await escrow.connect(deployer).createTask(
      rewardRefund, ZERO_ADDR, 0, singleConfig, 0, deadline3, reviewDeadline3, 3
    );
    const createReceipt3 = await createTx3.wait();
    const taskId3 = escrow.interface.parseLog({
      topics: createReceipt3.logs[0].topics,
      data: createReceipt3.logs[0].data,
    }).args.taskId;
    console.log(`  Task #${taskId3} created`);
    console.log(`  Tx: ${EXPLORER}/${createTx3.hash}`);

    console.log("[3.2] Funding refund task...");
    const fundTx3 = await escrow.connect(deployer).deposit(taskId3, { value: rewardRefund });
    await fundTx3.wait();
    const escrowBalBeforeRefund = await ethers.provider.getBalance(ESCROW_ADDR);
    console.log(`  Escrow balance: ${fmt(escrowBalBeforeRefund)} PHRS`);
    console.log(`  Tx: ${EXPLORER}/${fundTx3.hash}`);

    const creatorBalBefore = await ethers.provider.getBalance(deployer.address);
    console.log("[3.3] Refunding...");
    const refundTx = await escrow.connect(deployer).refund(taskId3);
    const refundReceipt = await refundTx.wait();
    const gasCost = refundReceipt.gasUsed * refundReceipt.gasPrice;
    const creatorBalAfter = await ethers.provider.getBalance(deployer.address);
    const escrowBalAfterRefund = await ethers.provider.getBalance(ESCROW_ADDR);
    const taskFinal3 = await escrow.tasks(taskId3);
    const escrowData3 = await escrow.getEscrow(taskId3);

    console.log(`  Status: ${Number(taskFinal3.status)} (expected 9=Cancelled)`);
    console.log(`  Refunded: ${fmt(escrowData3.refundedAmount)} PHRS (expected ${fmt(rewardRefund)})`);
    console.log(`  Escrow after: ${fmt(escrowBalAfterRefund)} PHRS (expected 0)`);
    console.log(`  Creator gross refund: +${fmt(creatorBalAfter - creatorBalBefore + gasCost)} PHRS (expected +${fmt(rewardRefund)})`);
    console.log(`  Fee charged: ${fmt(escrowData3.feeCollected)} (expected 0)`);
    console.log(`  Tx: ${EXPLORER}/${refundTx.hash}`);

    results.flows.refund = {
      taskId: taskId3.toString(),
      status: "ok",
      createTx: createTx3.hash,
      depositTx: fundTx3.hash,
      refundTx: refundTx.hash,
      refundedAmount: escrowData3.refundedAmount.toString(),
    };
  } catch (err) {
    console.error(`[ERROR] Refund flow: ${err.message}`);
    results.flows.refund = { status: "error", error: err.message };
    results.errors.push({ flow: "refund", error: err.message });
  }

  // ════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════");
  console.log("E2E TEST SUMMARY");
  console.log("═══════════════════════════════════════════\n");

  for (const [name, flow] of Object.entries(results.flows)) {
    const icon = flow.status === "ok" ? "✅" : "❌";
    console.log(`${icon} ${name}: ${flow.status}`);
    if (flow.taskId) console.log(`   Task ID: ${flow.taskId}`);
    for (const [key, val] of Object.entries(flow)) {
      if (key.endsWith("Tx") && typeof val === "string" && val.startsWith("0x")) {
        console.log(`   ${key}: ${EXPLORER}/${val}`);
      }
    }
  }

  if (results.errors.length > 0) {
    console.log(`\n⚠️  ${results.errors.length} error(s) encountered:`);
    for (const e of results.errors) {
      console.log(`   - [${e.flow}] ${e.error}`);
    }
  } else {
    console.log("\n✅ All E2E flows completed successfully.");
  }

  const finalBal = await ethers.provider.getBalance(deployer.address);
  console.log(`\nDeployer final PHRS: ${fmt(finalBal)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
