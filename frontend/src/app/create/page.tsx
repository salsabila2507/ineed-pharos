"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useAccount, useSwitchChain } from "wagmi";
import { useWriteContract } from "wagmi";
import { decodeEventLog, parseUnits } from "viem";
import { iNeedEscrowV2Abi, erc20Abi } from "@/lib/abi";
import { ESCROW_ADDRESS, EXPLORER_URL, CHAIN_ID, ZERO_ADDRESS, USDC_ADDRESS } from "@/lib/contract";
import { SiteHeader } from "@/app/components/site-header";

type Step = "form" | "creating" | "deposit-ready" | "approving" | "approved" | "depositing" | "success" | "error";

const ASSET_OPTIONS = [
  { label: "PHRS (Native)", value: ZERO_ADDRESS, decimals: 18, symbol: "PHRS" },
  { label: "USDC", value: USDC_ADDRESS, decimals: 6, symbol: "USDC" },
] as const;

export default function CreateTaskPage() {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState<Step>("form");
  const [taskId, setTaskId] = useState<bigint | null>(null);
  const [createTxHash, setCreateTxHash] = useState<`0x${string}` | null>(null);
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | null>(null);
  const [depositTxHash, setDepositTxHash] = useState<`0x${string}` | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [rewardTotal, setRewardTotal] = useState("");
  const [rewardAsset, setRewardAsset] = useState<string>(ZERO_ADDRESS);
  const [rewardModel, setRewardModel] = useState<0 | 1>(0);
  const [winnerSelection, setWinnerSelection] = useState<0 | 3>(0);
  const [maxParticipants, setMaxParticipants] = useState("3");
  const [deadlineDays, setDeadlineDays] = useState("7");
  const [reviewDays, setReviewDays] = useState("7");
  const [numWinners, setNumWinners] = useState("2");
  const [timeoutAction, setTimeoutAction] = useState<0 | 1 | 2>(0);

  const selectedAsset = ASSET_OPTIONS.find(a => a.value === rewardAsset) ?? ASSET_OPTIONS[0];

  const onWrongNetwork = isConnected && chainId !== CHAIN_ID;

  const reset = useCallback(() => {
    setStep("form");
    setTaskId(null);
    setCreateTxHash(null);
    setApproveTxHash(null);
    setDepositTxHash(null);
    setErrorMsg(null);
  }, []);

  function encodeRewardConfig(): `0x${string}` {
    const { encodeAbiParameters } = require("viem") as typeof import("viem");
    if (winnerSelection === 3) {
      return encodeAbiParameters([{ type: "uint8" }], [timeoutAction]);
    }
    if (rewardModel === 0) {
      return encodeAbiParameters([{ type: "bool" }], [true]);
    }
    return encodeAbiParameters(
      [{ type: "uint256" }, { type: "bool" }, { type: "uint256[]" }],
      [BigInt(numWinners), true, []]
    );
  }

  function parseReward(value: string): bigint {
    return parseUnits(value, selectedAsset.decimals);
  }

  async function handleCreate() {
    if (!address) return;
    setErrorMsg(null);
    setStep("creating");

    try {
      const rewardTotalWei = parseReward(rewardTotal);
      const now = Math.floor(Date.now() / 1000);
      const deadline = BigInt(now + Number(deadlineDays) * 86400);
      const reviewDeadline = deadline + BigInt(Number(reviewDays) * 86400);
      const maxPart = BigInt(maxParticipants || "0");
      const rewardConfig = encodeRewardConfig();

      const hash = await writeContractAsync({
        abi: iNeedEscrowV2Abi,
        address: ESCROW_ADDRESS,
        functionName: "createTask",
        args: [
          rewardTotalWei,
          rewardAsset as `0x${string}`,
          rewardModel,
          rewardConfig,
          winnerSelection,
          deadline,
          reviewDeadline,
          maxPart,
        ],
      } as any);

      setCreateTxHash(hash);
      const { waitForTransactionReceipt } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });

      const createEvent = receipt.logs.find((log) => {
        try {
          const decoded = decodeEventLog({
            abi: iNeedEscrowV2Abi,
            data: log.data,
            topics: log.topics,
          });
          return decoded.eventName === "TaskCreated";
        } catch { return false; }
      });

      if (!createEvent) throw new Error("Could not find TaskCreated event");

      const decoded = decodeEventLog({
        abi: iNeedEscrowV2Abi,
        data: createEvent.data,
        topics: createEvent.topics,
      });
      const tid = (decoded.args as any).taskId as bigint;
      setTaskId(tid);
      setStep("deposit-ready");
    } catch (err: any) {
      setErrorMsg(err?.message || err?.shortMessage || "Create task failed");
      setStep("error");
    }
  }

  async function handleApprove() {
    if (!taskId) return;
    setErrorMsg(null);
    setStep("approving");

    try {
      const amount = parseReward(rewardTotal);
      const hash = await writeContractAsync({
        abi: erc20Abi,
        address: rewardAsset as `0x${string}`,
        functionName: "approve",
        args: [ESCROW_ADDRESS, amount],
      });

      setApproveTxHash(hash);
      const { waitForTransactionReceipt } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");
      await waitForTransactionReceipt(wagmiConfig, { hash });

      setStep("approved");
    } catch (err: any) {
      setErrorMsg(err?.message || err?.shortMessage || "Approve failed");
      setStep("error");
    }
  }

  async function handleDepositERC20() {
    if (!taskId) return;
    setErrorMsg(null);
    setStep("depositing");

    try {
      const hash = await writeContractAsync({
        abi: iNeedEscrowV2Abi,
        address: ESCROW_ADDRESS,
        functionName: "deposit",
        args: [taskId],
      } as any);

      setDepositTxHash(hash);
      const { waitForTransactionReceipt } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");
      await waitForTransactionReceipt(wagmiConfig, { hash });

      setStep("success");
    } catch (err: any) {
      setErrorMsg(err?.message || err?.shortMessage || "Deposit failed");
      setStep("error");
    }
  }

  async function handleDepositNative() {
    if (!taskId) return;
    setErrorMsg(null);
    setStep("depositing");

    try {
      const amount = parseReward(rewardTotal);
      const hash = await writeContractAsync({
        abi: iNeedEscrowV2Abi,
        address: ESCROW_ADDRESS,
        functionName: "deposit",
        args: [taskId],
        value: amount,
      });

      setDepositTxHash(hash);
      const { waitForTransactionReceipt } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");
      await waitForTransactionReceipt(wagmiConfig, { hash });

      setStep("success");
    } catch (err: any) {
      setErrorMsg(err?.message || err?.shortMessage || "Deposit failed");
      setStep("error");
    }
  }

  const formValid =
    rewardTotal &&
    Number(rewardTotal) > 0 &&
    maxParticipants !== "" &&
    deadlineDays &&
    reviewDays;

  return (
    <div className="flex flex-col flex-1">
      <SiteHeader />

      <main className="flex flex-1 flex-col items-center px-6 py-12">
        <div className="w-full max-w-xl space-y-8">
          <div>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              Create Task
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Fund a bounty and publish it to the marketplace.
            </p>
          </div>

          {onWrongNetwork && (
            <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-5 py-3 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <span className="text-sm">Wrong network</span>
              <button
                onClick={() => switchChain({ chainId: CHAIN_ID })}
                className="rounded-md bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700"
              >
                Switch to Pharos Testnet
              </button>
            </div>
          )}

          {!isConnected ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-zinc-500 dark:text-zinc-400">
                Connect your wallet to create a task.
              </p>
            </div>
          ) : step === "form" ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="space-y-5">

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Reward Asset
                    </label>
                    <select
                      value={rewardAsset}
                      onChange={(e) => setRewardAsset(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                    >
                      {ASSET_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Reward Total ({selectedAsset.symbol})
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={rewardTotal}
                      onChange={(e) => setRewardTotal(e.target.value)}
                      placeholder={selectedAsset.symbol === "PHRS" ? "e.g. 100" : "e.g. 50"}
                      className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder-zinc-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Reward Model
                    </label>
                    <select
                      value={rewardModel}
                      onChange={(e) => setRewardModel(Number(e.target.value) as 0 | 1)}
                      className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                    >
                      <option value={0}>Single Winner</option>
                      <option value={1}>Multiple Winners</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Winner Selection
                    </label>
                    <select
                      value={winnerSelection}
                      onChange={(e) => setWinnerSelection(Number(e.target.value) as 0 | 3)}
                      className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                    >
                      <option value={0}>Creator Select</option>
                      <option value={3}>Auto Timeout</option>
                    </select>
                  </div>
                </div>

                {rewardModel === 1 && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Number of Winners
                    </label>
                    <input
                      type="number"
                      min="2"
                      value={numWinners}
                      onChange={(e) => setNumWinners(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                    />
                  </div>
                )}

                {winnerSelection === 3 && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Timeout Action
                    </label>
                    <select
                      value={timeoutAction}
                      onChange={(e) => setTimeoutAction(Number(e.target.value) as 0 | 1 | 2)}
                      className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                    >
                      <option value={0}>Pay All Submitters</option>
                      <option value={1}>Refund to Creator</option>
                      <option value={2}>Reward First Submission</option>
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Submission Deadline (days)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={deadlineDays}
                      onChange={(e) => setDeadlineDays(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Review Window (days)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={reviewDays}
                      onChange={(e) => setReviewDays(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Max Participants (0 = unlimited)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={maxParticipants}
                    onChange={(e) => setMaxParticipants(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                  />
                </div>
              </div>

              <div className="mt-6 flex items-center gap-3">
                <button
                  onClick={handleCreate}
                  disabled={!formValid}
                  className="rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Create Task
                </button>
                <Link
                  href="/"
                  className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  Cancel
                </Link>
              </div>
            </div>
          ) : step === "creating" ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-white" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Creating task on Pharos...
              </p>
              {createTxHash && (
                <a
                  href={`${EXPLORER_URL}/tx/${createTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  View transaction
                </a>
              )}
            </div>
          ) : step === "deposit-ready" ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                Task #{taskId?.toString()} created. Now deposit the reward to activate it.
              </div>

              <div className="mb-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Task ID</span>
                  <span className="font-mono text-zinc-800 dark:text-zinc-200">{taskId?.toString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Reward</span>
                  <span className="text-zinc-800 dark:text-zinc-200">{rewardTotal} {selectedAsset.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Platform Fee (2%)</span>
                  <span className="text-zinc-800 dark:text-zinc-200">{Number(rewardTotal) * 0.02} {selectedAsset.symbol}</span>
                </div>
              </div>

              {selectedAsset.value === ZERO_ADDRESS ? (
                <button
                  onClick={handleDepositNative}
                  className="w-full rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Deposit {rewardTotal} {selectedAsset.symbol}
                </button>
              ) : (
                <button
                  onClick={handleApprove}
                  className="w-full rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Approve {selectedAsset.symbol}
                </button>
              )}
            </div>
          ) : step === "approving" ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-white" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Approving {selectedAsset.symbol} spending...
              </p>
              {approveTxHash && (
                <a
                  href={`${EXPLORER_URL}/tx/${approveTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  View transaction
                </a>
              )}
            </div>
          ) : step === "approved" ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                Approved! Now deposit the {selectedAsset.symbol}.
              </div>
              <button
                onClick={handleDepositERC20}
                className="w-full rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Deposit {rewardTotal} {selectedAsset.symbol}
              </button>
            </div>
          ) : step === "depositing" ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-white" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Depositing funds to escrow...
              </p>
              {depositTxHash && (
                <a
                  href={`${EXPLORER_URL}/tx/${depositTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  View transaction
                </a>
              )}
            </div>
          ) : step === "success" ? (
            <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-950">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400">
                ✓
              </div>
              <h3 className="text-lg font-semibold text-green-800 dark:text-green-200">
                Task Created & Funded
              </h3>
              <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                Task #{taskId?.toString()} is now live on Pharos Atlantic Testnet.
              </p>
              <div className="mt-4 space-y-1 text-sm">
                {createTxHash && (
                  <a
                    href={`${EXPLORER_URL}/tx/${createTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Create transaction →
                  </a>
                )}
                {depositTxHash && (
                  <a
                    href={`${EXPLORER_URL}/tx/${depositTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Deposit transaction →
                  </a>
                )}
              </div>
              <div className="mt-6 flex items-center justify-center gap-3">
                <Link
                  href={`/tasks/${taskId?.toString()}`}
                  className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  View Task
                </Link>
                <button
                  onClick={reset}
                  className="rounded-lg border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Create Another
                </button>
                <Link
                  href="/"
                  className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  Dashboard
                </Link>
              </div>
            </div>
          ) : step === "error" ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-950">
              <h3 className="text-sm font-semibold text-red-800 dark:text-red-200">
                Error
              </h3>
              <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                {errorMsg}
              </p>
              <button
                onClick={reset}
                className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
              >
                Try Again
              </button>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
