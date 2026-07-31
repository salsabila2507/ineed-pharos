"use client";

import { useState, useMemo } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { useWriteContract, useReadContract } from "wagmi";
import { decodeAbiParameters } from "viem";
import { iNeedEscrowV2Abi } from "@/lib/abi";
import { ESCROW_ADDRESS, EXPLORER_URL, CHAIN_ID } from "@/lib/contract";
import { useTaskDetails } from "@/lib/hooks/use-escrow";

interface TaskWinnersCardProps {
  taskId: bigint;
}

type Step = "idle" | "reviewing" | "selecting" | "releasing" | "confirmed" | "error";

export function TaskWinnersCard({ taskId }: TaskWinnersCardProps) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { task, statusCode, isLoading, refetch } = useTaskDetails(taskId);

  const { data: submissions, refetch: refetchSubmissions } = useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS,
    functionName: "getSubmissions",
    args: [taskId],
  } as any);

  const rawSubmissions: any[] = (submissions as any[]) || [];

  const [step, setStep] = useState<Step>("idle");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const isCreator =
    task &&
    address &&
    (task.creator as string).toLowerCase() === address.toLowerCase();
  const onWrongNetwork = isConnected && chainId !== CHAIN_ID;
  const winnersSelected = task ? (task.winnersSelected as boolean) : false;
  const rewardModel = task ? Number(task.rewardModel) : -1;
  const isSingleWinner = rewardModel === 0;

  const numWinners = useMemo(() => {
    if (!task) return 0;
    if (rewardModel === 0) return 1;
    try {
      const decoded = decodeAbiParameters(
        [{ type: "uint256" }, { type: "bool" }, { type: "uint256[]" }],
        task.rewardConfig as `0x${string}`,
      );
      return Number(decoded[0]);
    } catch {
      return 0;
    }
  }, [task, rewardModel]);

  const isCompleted = statusCode === 6;
  const canStartReview =
    isCreator && statusCode === 4 && rawSubmissions.length > 0 && !winnersSelected;
  const canSelect =
    isCreator && statusCode === 5 && rawSubmissions.length > 0 && !winnersSelected;
  const canRelease = isCreator && statusCode === 5 && winnersSelected;
  const selectionReady =
    canSelect && (isSingleWinner ? selected.size === 1 : selected.size === numWinners);

  function toggleSubmitter(addr: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (isSingleWinner) {
        if (next.has(addr)) next.delete(addr);
        else {
          next.clear();
          next.add(addr);
        }
      } else {
        if (next.has(addr)) next.delete(addr);
        else next.add(addr);
      }
      return next;
    });
  }

  async function handleStartReview() {
    if (!address) return;
    setErrorMsg(null);
    setStep("reviewing");

    try {
      const hash = await writeContractAsync({
        abi: iNeedEscrowV2Abi,
        address: ESCROW_ADDRESS,
        functionName: "startReview",
        args: [taskId],
      } as any);

      setTxHash(hash);
      const { waitForTransactionReceipt } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");
      await waitForTransactionReceipt(wagmiConfig, { hash });

      refetch();
      setStep("idle");
    } catch (err: any) {
      setErrorMsg(err?.message || err?.shortMessage || "Start review failed");
      setStep("error");
    }
  }

  async function handleSelectWinners() {
    if (!address || selected.size === 0) return;
    setErrorMsg(null);
    setStep("selecting");

    try {
      const winnerAddresses = Array.from(selected) as `0x${string}`[];
      const hash = await writeContractAsync({
        abi: iNeedEscrowV2Abi,
        address: ESCROW_ADDRESS,
        functionName: "selectWinners",
        args: [taskId, winnerAddresses],
      } as any);

      setTxHash(hash);
      const { waitForTransactionReceipt } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");
      await waitForTransactionReceipt(wagmiConfig, { hash });

      refetch();
      refetchSubmissions();
      setStep("idle");
    } catch (err: any) {
      setErrorMsg(err?.message || err?.shortMessage || "Select winners failed");
      setStep("error");
    }
  }

  async function handleRelease() {
    if (!address) return;
    setErrorMsg(null);
    setStep("releasing");

    try {
      const hash = await writeContractAsync({
        abi: iNeedEscrowV2Abi,
        address: ESCROW_ADDRESS,
        functionName: "release",
        args: [taskId],
      } as any);

      setTxHash(hash);
      const { waitForTransactionReceipt } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");
      await waitForTransactionReceipt(wagmiConfig, { hash });

      refetch();
      setStep("idle");
    } catch (err: any) {
      setErrorMsg(err?.message || err?.shortMessage || "Release failed");
      setStep("error");
    }
  }

  if (isLoading || !task) return null;

  if (!canStartReview && !canSelect && !canRelease && !isCompleted) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Winners
      </h2>

      {onWrongNetwork && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span className="text-sm">Wrong network</span>
          <button
            onClick={() => switchChain({ chainId: CHAIN_ID })}
            className="rounded-md bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700"
          >
            Switch
          </button>
        </div>
      )}

      {step === "error" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{errorMsg}</p>
          <button
            onClick={() => setStep("idle")}
            className="mt-2 rounded bg-red-700 px-3 py-1 text-sm text-white hover:bg-red-600"
          >
            Try Again
          </button>
        </div>
      ) : isCompleted ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          Rewards have been released. This task is completed.
        </div>
      ) : canStartReview ? (
        <>
          <p className="mb-4 text-sm text-zinc-500">
            All submissions received. Start the review to select winners.
          </p>
          <div className="mb-4 space-y-2">
            {rawSubmissions.map((sub: any, i: number) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-700"
              >
                <span className="font-mono text-zinc-800 dark:text-zinc-200">
                  {(sub.submitter as string).slice(0, 6)}...{(sub.submitter as string).slice(-4)}
                </span>
                <span className="text-xs text-zinc-400">Submission #{i + 1}</span>
              </div>
            ))}
          </div>
          {step === "reviewing" ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-center dark:border-zinc-700 dark:bg-zinc-800">
              <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-white" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Starting review...
              </p>
              {txHash && (
                <a
                  href={`${EXPLORER_URL}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  View transaction
                </a>
              )}
            </div>
          ) : (
            <button
              onClick={handleStartReview}
              className="w-full rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Start Review
            </button>
          )}
        </>
      ) : canSelect ? (
        <>
          <p className="mb-4 text-sm text-zinc-500">
            {isSingleWinner
              ? "Select the winning submission."
              : `Select exactly ${numWinners} winner${numWinners > 1 ? "s" : ""} from ${rawSubmissions.length} submission${rawSubmissions.length > 1 ? "s" : ""}.`}
          </p>

          <div className="mb-4 space-y-2">
            {rawSubmissions.map((sub: any, i: number) => {
              const addr = sub.submitter as string;
              return (
                <label
                  key={addr}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  <input
                    type={isSingleWinner ? "radio" : "checkbox"}
                    name="winner"
                    checked={selected.has(addr)}
                    onChange={() => toggleSubmitter(addr)}
                    className="h-4 w-4 accent-zinc-900 dark:accent-white"
                  />
                  <div className="flex flex-1 items-center justify-between">
                    <span className="font-mono text-zinc-800 dark:text-zinc-200">
                      {addr.slice(0, 6)}...{addr.slice(-4)}
                    </span>
                    <span className="text-xs text-zinc-400">
                      Submission #{i + 1}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>

          {step === "selecting" ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-center dark:border-zinc-700 dark:bg-zinc-800">
              <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-white" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Selecting winners on-chain...
              </p>
              {txHash && (
                <a
                  href={`${EXPLORER_URL}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  View transaction
                </a>
              )}
            </div>
          ) : (
            <button
              onClick={handleSelectWinners}
              disabled={!selectionReady}
              className="w-full rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {isSingleWinner
                ? "Select Winner"
                : `Select Winners (${selected.size}/${numWinners})`}
            </button>
          )}
        </>
      ) : canRelease ? (
        <>
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
            Winners have been selected. Release the rewards to pay them.
          </div>
          {step === "releasing" ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-center dark:border-zinc-700 dark:bg-zinc-800">
              <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-white" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Releasing rewards...
              </p>
              {txHash && (
                <a
                  href={`${EXPLORER_URL}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  View transaction
                </a>
              )}
            </div>
          ) : (
            <button
              onClick={handleRelease}
              className="w-full rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Release Rewards
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}
