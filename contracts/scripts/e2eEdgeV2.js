const hre = require("hardhat");
const { ethers } = hre;

const ZERO_ADDR = ethers.ZeroAddress;
const ESCROW_ADDR = "0x27D17774B2aeCe56C41140cFf99894Be36Ac661e";
const MOCK_USDC_ADDR = "0x396b9B29E9D98EC8630dCEa9B528c785AFE916FA";
const EXPLORER = "https://atlantic.pharosscan.xyz/tx";

const DAY = 86400;
const FEE_200 = 200;
const MAX_FEE = 1000;
const GAS_LIMIT = 2000000n;

const erc20ErrorIface = new ethers.Interface([
  "error ERC20InsufficientAllowance(address spender,uint256 allowance,uint256 needed)",
  "error ERC20InsufficientBalance(address sender,uint256 balance,uint256 needed)",
]);

function fmt(amount, decimals = 18) {
  return ethers.formatUnits(amount, decimals);
}

function extractReason(err) {
  if (!err) return "unknown";
  const direct = err?.reason || err?.info?.error?.reason || err?.revert?.reason;
  if (direct && direct !== "UNPREDICTABLE_GAS_LIMIT") return String(direct);
  const msg = err.message || String(err);
  let m = msg.match(/reason string '([^']+)'/);
  if (m) return m[1];
  m = msg.match(/custom error '([A-Za-z0-9_]+)/);
  if (m) return m[1];
  m = msg.match(/execution reverted: ([^'"\n]+)/);
  if (m) return m[1].trim();
  const data = err?.data || err?.info?.error?.data;
  if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
    try {
      const frag = erc20ErrorIface.getError(data.slice(0, 10));
      if (frag) return frag.name;
    } catch {}
  }
  return msg.split("\n")[0];
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function readRetry(getter, expected, attempts = 10) {
  const norm = (v) =>
    typeof v === "bigint" || typeof v === "number" ? BigInt(v).toString() : String(v).toLowerCase();
  const e = norm(expected);
  for (let i = 0; i < attempts; i++) {
    try {
      const v = await getter();
      if (norm(v) === e) return v;
    } catch {}
    await sleep(1200);
  }
  return getter();
}

async function readRetryUntil(check, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return true;
    await sleep(1200);
  }
  return false;
}

function w(overrides = {}) {
  return { ...overrides, gasLimit: GAS_LIMIT };
}

async function expectRevert(fn, expectedReason, attempts = 12) {
  let last = "";
  for (let i = 0; i < attempts; i++) {
    try {
      await fn();
    } catch (err) {
      last = extractReason(err);
      if (expectedReason) {
        if (last === expectedReason) return { reverted: true, reason: last };
      } else {
        return { reverted: true, reason: last };
      }
    }
    await sleep(1200);
  }
  if (last) return { reverted: true, reason: last };
  return { reverted: false, reason: "" };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  console.log(`Network: Pharos Atlantic Testnet (chain ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Deployer PHRS: ${fmt(await ethers.provider.getBalance(deployer.address))}\n`);

  const escrow = await ethers.getContractAt("iNeedEscrowV2", ESCROW_ADDR);
  const mockUsdc = await ethers.getContractAt("MockUSDC", MOCK_USDC_ADDR);
  const usdcDec = Number(await mockUsdc.decimals());

  const p1 = ethers.Wallet.createRandom().connect(ethers.provider);
  const p2 = ethers.Wallet.createRandom().connect(ethers.provider);
  const p3 = ethers.Wallet.createRandom().connect(ethers.provider);

  const gasSeed = ethers.parseEther("0.03");
  for (const [label, p] of [["P1", p1], ["P2", p2], ["P3", p3]]) {
    console.log(`Funding ${label} (${p.address.slice(0, 10)}...) with ${fmt(gasSeed)} PHRS`);
    const fx = await deployer.sendTransaction({ to: p.address, value: gasSeed, gasLimit: GAS_LIMIT });
    await fx.wait();
  }

  const mintAmount = ethers.parseUnits("50", usdcDec);
  console.log(`Minting ${fmt(mintAmount, usdcDec)} MockUSDC to deployer`);
  const mtx = await mockUsdc.mint(deployer.address, mintAmount, w());
  await mtx.wait();
  console.log(`Deployer MockUSDC: ${fmt(await mockUsdc.balanceOf(deployer.address), usdcDec)}\n`);

  const singleConfig = ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [true]);
  const multipleConfig = (num, eq, weights) =>
    ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "bool", "uint256[]"], [num, eq, weights]);

  const now = () => Math.floor(Date.now() / 1000);

  const results = [];

  const record = (r) => {
    results.push(r);
  };

  async function runCase(name, group, fn) {
    try {
      const res = (await fn()) || {};
      const pass = res.pass !== false;
      console.log(`  ${pass ? "✅" : "❌"} ${name}${res.reason ? ` — ${res.reason}` : ""}${res.tx ? ` (${EXPLORER}/${res.tx})` : ""}`);
      record({ name, group, pass, reason: res.reason || "", tx: res.tx || "", expected: res.expected || "" });
    } catch (err) {
      const reason = extractReason(err);
      console.log(`  ❌ ${name} — unexpected error: ${reason}`);
      record({ name, group, pass: false, reason, tx: "", expected: "" });
    }
  }

  async function revertCase(name, group, fn, expectedReason) {
    return runCase(name, group, async () => {
      const r = await expectRevert(fn, expectedReason);
      if (!r.reverted) return { pass: false, reason: "NO REVERT (tx would succeed)", expected: expectedReason };
      return { pass: r.reason === expectedReason, reason: r.reason, expected: expectedReason };
    });
  }

  async function createTask(signer, rewardTotal, asset, model, config, winnerSel, deadline, reviewDeadline, maxP) {
    const tx = await escrow.connect(signer).createTask(rewardTotal, asset, model, config, winnerSel, deadline, reviewDeadline, maxP, w());
    const rc = await tx.wait();
    const log = escrow.interface.parseLog({ topics: rc.logs[0].topics, data: rc.logs[0].data });
    return { id: log.args.taskId, tx: tx.hash };
  }

  async function fundNative(id, value, signer) {
    const tx = await escrow.connect(signer).deposit(id, w({ value }));
    await tx.wait();
    return tx.hash;
  }

  async function fundErc20(id, signer) {
    const tx = await escrow.connect(signer).deposit(id, w());
    await tx.wait();
    return tx.hash;
  }

  async function approveUsdc(amount, signer) {
    const tx = await mockUsdc.connect(signer).approve(ESCROW_ADDR, amount, w());
    await tx.wait();
    return tx.hash;
  }

  // ════════════════════════════════════════════════════════════════
  // GROUP 1 — CREATE TASK INPUT VALIDATION
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════");
  console.log("GROUP 1: CreateTask input validation");
  console.log("═══════════════════════════════════════════\n");

  await revertCase("EC1 zero reward", "G1-input", () =>
    escrow.connect(deployer).createTask.estimateGas(0n, ZERO_ADDR, 0, singleConfig, 0, now() + DAY, now() + 2 * DAY, 1),
    "Reward must be > 0");

  await revertCase("EC2 past deadline", "G1-input", () =>
    escrow.connect(deployer).createTask.estimateGas(ethers.parseEther("0.01"), ZERO_ADDR, 0, singleConfig, 0, now() - 100, now() + DAY, 1),
    "Deadline must be in the future");

  await revertCase("EC3 reviewDeadline <= deadline", "G1-input", () =>
    escrow.connect(deployer).createTask.estimateGas(ethers.parseEther("0.01"), ZERO_ADDR, 0, singleConfig, 0, now() + DAY, now() + DAY, 1),
    "Review deadline must be after submission deadline");

  // ════════════════════════════════════════════════════════════════
  // GROUP 2 — DEPOSIT VALIDATION
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════");
  console.log("GROUP 2: Deposit validation");
  console.log("═══════════════════════════════════════════\n");

  const t4 = (await createTask(deployer, ethers.parseEther("0.01"), ZERO_ADDR, 0, singleConfig, 0, now() + DAY, now() + 2 * DAY, 1)).id;
  await revertCase("EC4 deposit by non-creator", "G2-deposit", () =>
    escrow.connect(p1).deposit.estimateGas(t4),
    "Only creator");

  const t5 = (await createTask(deployer, ethers.parseEther("0.01"), ZERO_ADDR, 0, singleConfig, 0, now() + DAY, now() + 2 * DAY, 1)).id;
  await revertCase("EC5 native deposit wrong msg.value", "G2-deposit", () =>
    escrow.connect(deployer).deposit.estimateGas(t5, { value: ethers.parseEther("0.02") }),
    "msg.value must equal rewardTotal");

  const t6 = (await createTask(deployer, ethers.parseUnits("5", usdcDec), MOCK_USDC_ADDR, 0, singleConfig, 0, now() + DAY, now() + 2 * DAY, 1)).id;
  await runCase("EC6 ERC20 deposit with msg.value", "G2-deposit", async () => {
    const appTx = await approveUsdc(ethers.parseUnits("5", usdcDec), deployer);
    const r = await expectRevert(() => escrow.connect(deployer).deposit.estimateGas(t6, { value: 1n }), "msg.value must be 0 for ERC20 deposit");
    return { pass: r.reverted && r.reason === "msg.value must be 0 for ERC20 deposit", reason: r.reason, tx: appTx };
  });

  // ════════════════════════════════════════════════════════════════
  // GROUP 3 — REFUND EDGE CASES
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════");
  console.log("GROUP 3: Refund edge cases");
  console.log("═══════════════════════════════════════════\n");

  const t7 = (await createTask(deployer, ethers.parseEther("0.01"), ZERO_ADDR, 0, singleConfig, 0, now() + DAY, now() + 2 * DAY, 1)).id;
  await revertCase("EC7 refund on Created (unfunded)", "G3-refund", () =>
    escrow.connect(deployer).refund.estimateGas(t7),
    "Cannot refund at current state");

  const t8 = (await createTask(deployer, ethers.parseEther("0.001"), ZERO_ADDR, 0, singleConfig, 0, now() + DAY, now() + 2 * DAY, 1)).id;
  await runCase("EC8 refund blocked after accept", "G3-refund", async () => {
    const fTx = await fundNative(t8, ethers.parseEther("0.001"), deployer);
    const aTx = await escrow.connect(p1).accept(t8, w());
    await aTx.wait();
    const r = await expectRevert(() => escrow.connect(deployer).refund.estimateGas(t8), "Cannot refund at current state");
    return { pass: r.reverted && r.reason === "Cannot refund at current state", reason: r.reason, tx: fTx };
  });

  const t9 = (await createTask(deployer, ethers.parseEther("0.01"), ZERO_ADDR, 0, singleConfig, 0, now() + DAY, now() + 2 * DAY, 1)).id;
  await runCase("EC9 refund success then double refund blocked", "G3-refund", async () => {
    await fundNative(t9, ethers.parseEther("0.01"), deployer);
    const escrowBalBefore = await ethers.provider.getBalance(ESCROW_ADDR);
    const balBefore = await ethers.provider.getBalance(deployer.address);
    const tx = await escrow.connect(deployer).refund(t9, w());
    const rc = await tx.wait();
    const gasCost = rc.gasUsed * rc.gasPrice;
    const balAfter = await readRetry(() => ethers.provider.getBalance(deployer.address), balBefore + ethers.parseEther("0.01") - gasCost);
    const escrowData = await escrow.getEscrow(t9);
    const task = await escrow.tasks(t9);
    const escrowBalAfter = await readRetry(() => ethers.provider.getBalance(ESCROW_ADDR), escrowBalBefore - ethers.parseEther("0.01"));
    const refundOk =
      Number(task.status) === 9 &&
      escrowData.refundedAmount === ethers.parseEther("0.01") &&
      balAfter - balBefore + gasCost === ethers.parseEther("0.01") &&
      escrowBalAfter === escrowBalBefore - ethers.parseEther("0.01");
    const r = await expectRevert(() => escrow.connect(deployer).refund.estimateGas(t9), "Cannot refund at current state");
    const doubleBlocked = r.reverted && r.reason === "Cannot refund at current state";
    return { pass: refundOk && doubleBlocked, reason: `refunded=${fmt(escrowData.refundedAmount)} doubleRefund=${r.reason}`, tx: tx.hash };
  });

  const t10 = (await createTask(deployer, ethers.parseUnits("5", usdcDec), MOCK_USDC_ADDR, 0, singleConfig, 0, now() + DAY, now() + 2 * DAY, 1)).id;
  await runCase("EC11 ERC20 refund returns full amount", "G3-refund", async () => {
    const appTx = await approveUsdc(ethers.parseUnits("5", usdcDec), deployer);
    await fundErc20(t10, deployer);
    const escrowMockBefore = await mockUsdc.balanceOf(ESCROW_ADDR);
    const balBefore = await mockUsdc.balanceOf(deployer.address);
    const tx = await escrow.connect(deployer).refund(t10, w());
    await tx.wait();
    const expected = ethers.parseUnits("5", usdcDec);
    const balAfter = await readRetry(() => mockUsdc.balanceOf(deployer.address), balBefore + expected);
    const escrowMockAfter = await readRetry(() => mockUsdc.balanceOf(ESCROW_ADDR), escrowMockBefore - expected);
    const escrowData = await escrow.getEscrow(t10);
    const task = await escrow.tasks(t10);
    const ok =
      Number(task.status) === 9 &&
      balAfter - balBefore === expected &&
      escrowMockAfter === escrowMockBefore - expected &&
      escrowData.refundedAmount === expected;
    return { pass: ok, reason: `creatorDelta=+${fmt(balAfter - balBefore, usdcDec)} refunded=${fmt(escrowData.refundedAmount, usdcDec)}`, tx: `${appTx},${tx.hash}` };
  });

  // ════════════════════════════════════════════════════════════════
  // GROUP 4 — UNAUTHORIZED ACCESS
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════");
  console.log("GROUP 4: Unauthorized access (creator/admin gates)");
  console.log("═══════════════════════════════════════════\n");

  await revertCase("EC12 release by non-creator", "G4-authz", () =>
    escrow.connect(p1).release.estimateGas(t8),
    "Only creator");

  const t11 = (await createTask(deployer, ethers.parseEther("0.05"), ZERO_ADDR, 0, singleConfig, 0, now() + DAY, now() + 2 * DAY, 1)).id;
  await runCase("EC29 release before winners selected", "G4-authz", async () => {
    await fundNative(t11, ethers.parseEther("0.05"), deployer);
    const aTx = await escrow.connect(p1).accept(t11, w());
    await aTx.wait();
    const sTx = await escrow.connect(p1).submit(t11, ethers.keccak256(ethers.toUtf8Bytes("t11 " + Date.now())), w());
    await sTx.wait();
    const rvTx = await escrow.connect(deployer).startReview(t11, w());
    await rvTx.wait();
    const r = await expectRevert(() => escrow.connect(deployer).release.estimateGas(t11), "Winners not selected");
    return { pass: r.reverted && r.reason === "Winners not selected", reason: r.reason, tx: rvTx.hash };
  });

  await revertCase("EC13 selectWinners by non-creator", "G4-authz", () =>
    escrow.connect(p1).selectWinners.estimateGas(t11, [p1.address]),
    "Only creator");

  await revertCase("EC14 setFeeBps by non-admin", "G4-authz", () =>
    escrow.connect(p1).setFeeBps.estimateGas(100),
    "Only admin");

  await revertCase("EC15 setFeeTreasury by non-admin", "G4-authz", () =>
    escrow.connect(p1).setFeeTreasury.estimateGas(p1.address),
    "Only admin");

  await revertCase("EC16 transferAdmin by non-admin", "G4-authz", () =>
    escrow.connect(p1).transferAdmin.estimateGas(p1.address),
    "Only admin");

  await revertCase("EC17 resolveDispute by non-admin", "G4-authz", () =>
    escrow.connect(p1).resolveDispute.estimateGas(t11, 1, [], []),
    "Only admin");

  // ════════════════════════════════════════════════════════════════
  // GROUP 5 — DOUBLE CLAIM PREVENTION + RELEASE GATES
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════");
  console.log("GROUP 5: Double claim prevention & release gates");
  console.log("═══════════════════════════════════════════\n");

  const t12 = (await createTask(deployer, ethers.parseEther("0.001"), ZERO_ADDR, 0, singleConfig, 0, now() + DAY, now() + 2 * DAY, 1)).id;
  await runCase("EC18 accept twice blocked", "G5-double", async () => {
    const fTx = await fundNative(t12, ethers.parseEther("0.001"), deployer);
    const aTx = await escrow.connect(p1).accept(t12, w());
    await aTx.wait();
    const r = await expectRevert(() => escrow.connect(p1).accept.estimateGas(t12), "Already accepted");
    return { pass: r.reverted && r.reason === "Already accepted", reason: r.reason, tx: fTx };
  });

  await runCase("EC19 submit twice blocked", "G5-double", async () => {
    const sTx = await escrow.connect(p1).submit(t12, ethers.keccak256(ethers.toUtf8Bytes("t12 " + Date.now())), w());
    await sTx.wait();
    const r = await expectRevert(() => escrow.connect(p1).submit.estimateGas(t12, ethers.keccak256(ethers.toUtf8Bytes("dup"))), "Already submitted");
    return { pass: r.reverted && r.reason === "Already submitted", reason: r.reason, tx: sTx.hash };
  });

  await runCase("ECx raiseDispute outside Review", "G5-double", async () => {
    const r = await expectRevert(() => escrow.connect(p1).raiseDispute.estimateGas(t12, "0x"), "Task not in Review state");
    return { pass: r.reverted && r.reason === "Task not in Review state", reason: r.reason };
  });

  await runCase("EC21 selectWinners twice blocked", "G5-double", async () => {
    const selTx = await escrow.connect(deployer).selectWinners(t11, [p1.address], w());
    await selTx.wait();
    const r = await expectRevert(() => escrow.connect(deployer).selectWinners.estimateGas(t11, [p1.address]), "Winners already selected");
    return { pass: r.reverted && r.reason === "Winners already selected", reason: r.reason, tx: selTx.hash };
  });

  await runCase("EC12b release by non-creator (t11)", "G5-double", async () => {
    const r = await expectRevert(() => escrow.connect(p1).release.estimateGas(t11), "Only creator");
    return { pass: r.reverted && r.reason === "Only creator", reason: r.reason };
  });

  await runCase("EC20 release twice blocked (t11 completed)", "G5-double", async () => {
    const p1BalBefore = await ethers.provider.getBalance(p1.address);
    const treasury = await escrow.feeTreasury();
    const tBefore = await ethers.provider.getBalance(treasury);
    const tx = await escrow.connect(deployer).release(t11, w());
    const rc = await tx.wait();
    const gasCost = rc.gasUsed * rc.gasPrice;
    const fee = ethers.parseEther("0.05") * BigInt(FEE_200) / 10000n;
    const payout = ethers.parseEther("0.05") - fee;
    const p1BalAfter = await readRetry(() => ethers.provider.getBalance(p1.address), p1BalBefore + payout);
    const tAfter = await readRetry(() => ethers.provider.getBalance(treasury), tBefore + fee - gasCost);
    const escrowData = await escrow.getEscrow(t11);
    const task = await escrow.tasks(t11);
    const ok =
      Number(task.status) === 6 &&
      p1BalAfter - p1BalBefore === payout &&
      tAfter - tBefore === fee - gasCost &&
      escrowData.releasedAmount === payout &&
      escrowData.feeCollected === fee;
    const r = await expectRevert(() => escrow.connect(deployer).release.estimateGas(t11), "Task not in Review state");
    const twiceBlocked = r.reverted && r.reason === "Task not in Review state";
    return { pass: ok && twiceBlocked, reason: `release2=${r.reason} status=${Number(task.status)}`, tx: tx.hash };
  });

  // ════════════════════════════════════════════════════════════════
  // GROUP 6 — STATE TRANSITION / WINNER SELECTION / DISPUTE GATES
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════");
  console.log("GROUP 6: State transitions, winner selection & dispute");
  console.log("═══════════════════════════════════════════\n");

  const t13 = (await createTask(deployer, ethers.parseEther("0.001"), ZERO_ADDR, 0, singleConfig, 0, now() + DAY, now() + 2 * DAY, 1)).id;
  await runCase("EC22a submit on Open task", "G6-state", async () => {
    const fTx = await fundNative(t13, ethers.parseEther("0.001"), deployer);
    const r = await expectRevert(() => escrow.connect(p3).submit.estimateGas(t13, ethers.keccak256(ethers.toUtf8Bytes("x"))), "Task not accepting submissions");
    return { pass: r.reverted && r.reason === "Task not accepting submissions", reason: r.reason, tx: fTx };
  });

  await runCase("EC23 startReview outside Submitted", "G6-state", async () => {
    const aTx = await escrow.connect(p1).accept(t13, w());
    await aTx.wait();
    const r = await expectRevert(() => escrow.connect(deployer).startReview.estimateGas(t13), "Task not in Submitted state");
    return { pass: r.reverted && r.reason === "Task not in Submitted state", reason: r.reason, tx: aTx.hash };
  });

  await revertCase("EC22b submit by non-accepted participant", "G6-state", () =>
    escrow.connect(p3).submit.estimateGas(t13, ethers.keccak256(ethers.toUtf8Bytes("y"))),
    "Not an accepted participant");

  await runCase("EC25 raiseDispute by non-participant", "G6-state", async () => {
    const sTx = await escrow.connect(p1).submit(t13, ethers.keccak256(ethers.toUtf8Bytes("t13 " + Date.now())), w());
    await sTx.wait();
    const rvTx = await escrow.connect(deployer).startReview(t13, w());
    await rvTx.wait();
    const r = await expectRevert(() => escrow.connect(p3).raiseDispute.estimateGas(t13, "0x"), "Not a participant");
    return { pass: r.reverted && r.reason === "Not a participant", reason: r.reason, tx: sTx.hash };
  });

  await runCase("EC26 raiseDispute by winner blocked", "G6-state", async () => {
    const selTx = await escrow.connect(deployer).selectWinners(t13, [p1.address], w());
    await selTx.wait();
    const r = await expectRevert(() => escrow.connect(p1).raiseDispute.estimateGas(t13, "0x"), "Winner cannot dispute");
    return { pass: r.reverted && r.reason === "Winner cannot dispute", reason: r.reason, tx: selTx.hash };
  });

  const t14 = (await createTask(deployer, ethers.parseEther("0.001"), ZERO_ADDR, 0, singleConfig, 0, now() + DAY, now() + 2 * DAY, 2)).id;
  await runCase("G6 setup: fund T14 + accept p1,p2 + submit p1 + review", "G6-state", async () => {
    await fundNative(t14, ethers.parseEther("0.001"), deployer);
    await (await escrow.connect(p1).accept(t14, w())).wait();
    await (await escrow.connect(p2).accept(t14, w())).wait();
    await (await escrow.connect(p1).submit(t14, ethers.keccak256(ethers.toUtf8Bytes("t14 " + Date.now())), w())).wait();
    const rv = await escrow.connect(deployer).startReview(t14, w());
    await rv.wait();
    return { pass: true, reason: `participants=${(await escrow.getParticipants(t14)).length} submissions=${Number((await escrow.tasks(t14)).submissionCount)}`, tx: rv.hash };
  });

  await revertCase("EC29b selectWinners empty list", "G6-state", () =>
    escrow.connect(deployer).selectWinners.estimateGas(t14, []),
    "Must select at least one winner");

  await revertCase("ECx selectWinners single-model >1 winner", "G6-state", () =>
    escrow.connect(deployer).selectWinners.estimateGas(t14, [p1.address, p2.address]),
    "Single winner: must select exactly 1");

  await revertCase("EC27 selectWinners non-participant", "G6-state", () =>
    escrow.connect(deployer).selectWinners.estimateGas(t14, [p3.address]),
    "Winner not a participant");

  await revertCase("EC28 selectWinners participant without submission", "G6-state", () =>
    escrow.connect(deployer).selectWinners.estimateGas(t14, [p2.address]),
    "Winner has not submitted");

  await runCase("EC29c selectWinners valid (p1)", "G6-state", async () => {
    const tx = await escrow.connect(deployer).selectWinners(t14, [p1.address], w());
    await tx.wait();
    const settled = await readRetryUntil(async () => (await escrow.tasks(t14)).winnersSelected === true);
    return { pass: settled, reason: "winnersSelected=true", tx: tx.hash };
  });

  // T15: dispute lifecycle
  const t15 = (await createTask(deployer, ethers.parseEther("0.02"), ZERO_ADDR, 0, singleConfig, 0, now() + DAY, now() + 2 * DAY, 1)).id;
  await runCase("G6 setup: fund T15 + accept/submit/review", "G6-state", async () => {
    await fundNative(t15, ethers.parseEther("0.02"), deployer);
    await (await escrow.connect(p1).accept(t15, w())).wait();
    await (await escrow.connect(p1).submit(t15, ethers.keccak256(ethers.toUtf8Bytes("t15 " + Date.now())), w())).wait();
    const rv = await escrow.connect(deployer).startReview(t15, w());
    await rv.wait();
    return { pass: true, reason: "status=Review", tx: rv.hash };
  });

  await runCase("ECd raiseDispute by participant (success)", "G6-state", async () => {
    const tx = await escrow.connect(p1).raiseDispute(t15, ethers.toUtf8Bytes("evidence"), w());
    await tx.wait();
    const settled = await readRetryUntil(async () => {
      const disputed = await escrow.isDisputed(t15);
      const st = Number((await escrow.tasks(t15)).status);
      return disputed === true && st === 7;
    });
    return { pass: settled, reason: "status=Disputed", tx: tx.hash };
  });

  await revertCase("EC30 release on disputed task", "G6-state", () =>
    escrow.connect(deployer).release.estimateGas(t15),
    "Task is disputed");

  await runCase("EC17b resolveDispute in favor of creator (success)", "G6-state", async () => {
    const balBefore = await ethers.provider.getBalance(deployer.address);
    const tx = await escrow.connect(deployer).resolveDispute(t15, 1, [], [], w());
    const rc = await tx.wait();
    const gasCost = rc.gasUsed * rc.gasPrice;
    const balAfter = await readRetry(() => ethers.provider.getBalance(deployer.address), balBefore + ethers.parseEther("0.02") - gasCost);
    const escrowData = await escrow.getEscrow(t15);
    const task = await escrow.tasks(t15);
    const ok =
      Number(task.status) === 8 &&
      balAfter - balBefore + gasCost === ethers.parseEther("0.02") &&
      escrowData.refundedAmount === ethers.parseEther("0.02");
    return { pass: ok, reason: `status=${Number(task.status)} refunded=${fmt(escrowData.refundedAmount)}`, tx: tx.hash };
  });

  // Multiple winner model — duplicate winner detection + weighted zero
  const t20 = (await createTask(deployer, ethers.parseEther("0.02"), ZERO_ADDR, 1, multipleConfig(2, true, []), 0, now() + DAY, now() + 2 * DAY, 2)).id;
  await runCase("G6 setup: multiple model T20", "G6-state", async () => {
    await fundNative(t20, ethers.parseEther("0.02"), deployer);
    await (await escrow.connect(p1).accept(t20, w())).wait();
    await (await escrow.connect(p2).accept(t20, w())).wait();
    await (await escrow.connect(p1).submit(t20, ethers.keccak256(ethers.toUtf8Bytes("t20a " + Date.now())), w())).wait();
    await (await escrow.connect(p2).submit(t20, ethers.keccak256(ethers.toUtf8Bytes("t20b " + Date.now())), w())).wait();
    const rv = await escrow.connect(deployer).startReview(t20, w());
    await rv.wait();
    return { pass: true, reason: "status=Review", tx: rv.hash };
  });

  await revertCase("ECx selectWinners duplicate winner", "G6-state", () =>
    escrow.connect(deployer).selectWinners.estimateGas(t20, [p1.address, p1.address]),
    "Duplicate winner");

  await runCase("ECm multiple model select+release split equal", "G6-state", async () => {
    const sel = await escrow.connect(deployer).selectWinners(t20, [p1.address, p2.address], w());
    await sel.wait();
    const b1 = await ethers.provider.getBalance(p1.address);
    const b2 = await ethers.provider.getBalance(p2.address);
    const tx = await escrow.connect(deployer).release(t20, w());
    await tx.wait();
    const fee = ethers.parseEther("0.02") * BigInt(FEE_200) / 10000n;
    const payout = ethers.parseEther("0.02") - fee;
    const half = payout / 2n;
    const last = payout - half;
    let a1 = await ethers.provider.getBalance(p1.address);
    let a2 = await ethers.provider.getBalance(p2.address);
    const settled = await readRetryUntil(async () => {
      a1 = await ethers.provider.getBalance(p1.address);
      a2 = await ethers.provider.getBalance(p2.address);
      return (a1 - b1) + (a2 - b2) === payout;
    });
    const ok =
      settled &&
      Number((await escrow.tasks(t20)).status) === 6 &&
      (a1 - b1 === half || a1 - b1 === last) &&
      (a2 - b2 === half || a2 - b2 === last) &&
      (a1 - b1) + (a2 - b2) === payout;
    return { pass: ok, reason: `p1=+${fmt(a1 - b1)} p2=+${fmt(a2 - b2)}`, tx: `${sel.hash},${tx.hash}` };
  });

  const t21 = (await createTask(deployer, ethers.parseEther("0.001"), ZERO_ADDR, 1, multipleConfig(2, false, [0, 0]), 0, now() + DAY, now() + 2 * DAY, 2)).id;
  await runCase("G6 setup: weighted multiple model T21", "G6-state", async () => {
    await fundNative(t21, ethers.parseEther("0.001"), deployer);
    await (await escrow.connect(p1).accept(t21, w())).wait();
    await (await escrow.connect(p2).accept(t21, w())).wait();
    await (await escrow.connect(p1).submit(t21, ethers.keccak256(ethers.toUtf8Bytes("t21a " + Date.now())), w())).wait();
    await (await escrow.connect(p2).submit(t21, ethers.keccak256(ethers.toUtf8Bytes("t21b " + Date.now())), w())).wait();
    await (await escrow.connect(deployer).startReview(t21, w())).wait();
    const sel = await escrow.connect(deployer).selectWinners(t21, [p1.address, p2.address], w());
    await sel.wait();
    return { pass: true, reason: "status=Review winnersSelected=true", tx: sel.hash };
  });

  await revertCase("ECx release weighted with zero weight sum", "G6-state", () =>
    escrow.connect(deployer).release.estimateGas(t21),
    "Weight sum must be > 0");

  // ════════════════════════════════════════════════════════════════
  // GROUP 7 — ERC20 EDGE CASES
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════");
  console.log("GROUP 7: ERC20 edge cases");
  console.log("═══════════════════════════════════════════\n");

  const t17 = (await createTask(deployer, ethers.parseUnits("5", usdcDec), MOCK_USDC_ADDR, 0, singleConfig, 0, now() + DAY, now() + 2 * DAY, 1)).id;
  await revertCase("EC31 ERC20 deposit without approval", "G7-erc20", () =>
    escrow.connect(deployer).deposit.estimateGas(t17),
    "ERC20InsufficientAllowance");

  const t18 = (await createTask(p2, ethers.parseUnits("5", usdcDec), MOCK_USDC_ADDR, 0, singleConfig, 0, now() + DAY, now() + 2 * DAY, 1)).id;
  await runCase("EC32 ERC20 deposit insufficient balance", "G7-erc20", async () => {
    await approveUsdc(ethers.parseUnits("5", usdcDec), p2);
    const r = await expectRevert(() => escrow.connect(p2).deposit.estimateGas(t18), "ERC20InsufficientBalance");
    return { pass: r.reverted && r.reason === "ERC20InsufficientBalance", reason: r.reason };
  });

  // ════════════════════════════════════════════════════════════════
  // GROUP 8 — SUBMISSION DEADLINE (time-based, waits ~30s)
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════");
  console.log("GROUP 8: Submission deadline (waits for deadline to pass)");
  console.log("═══════════════════════════════════════════\n");

  const t16 = (await createTask(deployer, ethers.parseEther("0.001"), ZERO_ADDR, 0, singleConfig, 0, now() + 25, now() + DAY + 25, 1)).id;
  await runCase("EC24 setup: fund + accept before short deadline", "G8-deadline", async () => {
    const fTx = await fundNative(t16, ethers.parseEther("0.001"), deployer);
    await (await escrow.connect(p1).accept(t16, w())).wait();
    return { pass: true, reason: "waiting for deadline to pass...", tx: fTx };
  });

  console.log("  ⏳ Waiting 27s for submission deadline to pass...");
  await sleep(27000);

  await revertCase("EC24 submit after deadline", "G8-deadline", () =>
    escrow.connect(p1).submit.estimateGas(t16, ethers.keccak256(ethers.toUtf8Bytes("late"))),
    "Submission deadline passed");

  // ════════════════════════════════════════════════════════════════
  // GROUP 9 — FEE & ADMIN (positives + restore)
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════");
  console.log("GROUP 9: Fee & admin restrictions (with restore)");
  console.log("═══════════════════════════════════════════\n");

  await revertCase("EC34 setFeeBps above max", "G9-admin", () =>
    escrow.connect(deployer).setFeeBps.estimateGas(MAX_FEE + 1),
    "Fee exceeds max");

  await revertCase("EC35 setFeeTreasury to zero", "G9-admin", () =>
    escrow.connect(deployer).setFeeTreasury.estimateGas(ZERO_ADDR),
    "Treasury cannot be zero");

  await revertCase("EC36 transferAdmin to zero", "G9-admin", () =>
    escrow.connect(deployer).transferAdmin.estimateGas(ZERO_ADDR),
    "Admin cannot be zero");

  await runCase("EC37 setFeeBps(100) + restore(200)", "G9-admin", async () => {
    const tx = await escrow.connect(deployer).setFeeBps(100, w());
    await tx.wait();
    const v1 = Number(await readRetry(() => escrow.feeBps(), 100n));
    const tx2 = await escrow.connect(deployer).setFeeBps(FEE_200, w());
    await tx2.wait();
    const v2 = Number(await readRetry(() => escrow.feeBps(), BigInt(FEE_200)));
    return { pass: v1 === 100 && v2 === FEE_200, reason: `feeBps: 200→100→${v2}`, tx: `${tx.hash},${tx2.hash}` };
  });

  await runCase("EC38 setFeeTreasury(p2) + restore(deployer)", "G9-admin", async () => {
    const tx = await escrow.connect(deployer).setFeeTreasury(p2.address, w());
    await tx.wait();
    const v1 = await readRetry(() => escrow.feeTreasury(), p2.address);
    const tx2 = await escrow.connect(deployer).setFeeTreasury(deployer.address, w());
    await tx2.wait();
    const v2 = await readRetry(() => escrow.feeTreasury(), deployer.address);
    return { pass: v1 === p2.address && v2 === deployer.address, reason: `treasury: deployer→p2→${v2}`, tx: `${tx.hash},${tx2.hash}` };
  });

  await runCase("EC39 transferAdmin(p2) + restore(deployer)", "G9-admin", async () => {
    const tx = await escrow.connect(deployer).transferAdmin(p2.address, w());
    await tx.wait();
    const v1 = await readRetry(() => escrow.admin(), p2.address);
    const tx2 = await escrow.connect(p2).transferAdmin(deployer.address, w());
    await tx2.wait();
    const v2 = await readRetry(() => escrow.admin(), deployer.address);
    return { pass: v1 === p2.address && v2 === deployer.address, reason: `admin: deployer→p2→${v2}`, tx: `${tx.hash},${tx2.hash}` };
  });

  // ════════════════════════════════════════════════════════════════
  // FINAL STATE RESTORE VERIFICATION
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════");
  console.log("FINAL STATE RESTORE VERIFICATION");
  console.log("═══════════════════════════════════════════\n");

  const finalFeeBps = Number(await readRetry(() => escrow.feeBps(), BigInt(FEE_200)));
  const finalTreasury = await readRetry(() => escrow.feeTreasury(), deployer.address);
  const finalAdmin = await readRetry(() => escrow.admin(), deployer.address);
  const feeOk = finalFeeBps === FEE_200;
  const treasuryOk = finalTreasury === deployer.address;
  const adminOk = finalAdmin === deployer.address;
  console.log(`  feeBps:        ${finalFeeBps} ${feeOk ? "✅" : "❌"} (expected ${FEE_200})`);
  console.log(`  feeTreasury:   ${finalTreasury} ${treasuryOk ? "✅" : "❌"} (expected deployer)`);
  console.log(`  admin:         ${finalAdmin} ${adminOk ? "✅" : "❌"} (expected deployer)`);
  console.log(`  escrow PHRS:   ${fmt(await ethers.provider.getBalance(ESCROW_ADDR))} (locked funds in intentionally-abandoned tasks)`);
  console.log(`  deployer PHRS: ${fmt(await ethers.provider.getBalance(deployer.address))}`);

  // ════════════════════════════════════════════════════════════════
  // SUMMARY TABLE
  // ════════════════════════════════════════════════════════════════
  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;

  console.log("\n═══════════════════════════════════════════");
  console.log(`EDGE CASE TEST SUMMARY (${passCount}/${results.length} passed)`);
  console.log("═══════════════════════════════════════════\n");

  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("#", 4) + pad("CASE", 46) + pad("GROUP", 12) + pad("STATUS", 8) + "DETAIL");
  console.log("-".repeat(130));
  let i = 0;
  for (const r of results) {
    i++;
    const detail = r.pass
      ? (r.tx ? `tx: ${r.tx}` : "ok")
      : `expected: ${r.expected || "n/a"} | got: ${r.reason}`;
    console.log(pad(String(i), 4) + pad(r.name, 46) + pad(r.group, 12) + pad(r.pass ? "PASS" : "FAIL", 8) + detail);
  }
  console.log("-".repeat(130));
  console.log(`\n${failCount === 0 ? "✅ ALL EDGE CASES PASSED" : `❌ ${failCount} CASE(S) FAILED`}`);
  console.log(`Global state restored: ${feeOk && treasuryOk && adminOk ? "✅" : "❌"}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
