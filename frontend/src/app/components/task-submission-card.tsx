"use client";

import { useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { useWriteContract, useReadContract } from "wagmi";
import { keccak256, stringToHex } from "viem";
import { iNeedEscrowV2Abi } from "@/lib/abi";
import { ESCROW_ADDRESS, EXPLORER_URL, CHAIN_ID } from "@/lib/contract";
import { useTaskDetails } from "@/lib/hooks/use-escrow";

interface TaskSubmissionCardProps {
  taskId: bigint;
}

type Step = "idle" | "submitting" | "confirmed" | "error";

export function TaskSubmissionCard({ taskId }: TaskSubmissionCardProps) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { task, isLoading, refetch } = useTaskDetails(taskId);

  const { data: hasAccepted } = useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS,
    functionName: "hasAccepted",
    args: address ? [taskId, address] : undefined,
  } as any);

  const { data: hasSubmitted } = useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS,
    functionName: "hasSubmitted",
    args: address ? [taskId, address] : undefined,
  } as any);

  const [step, setStep] = useState<Step>("idle");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [content, setContent] = useState("");

  const onWrongNetwork = isConnected && chainId !== CHAIN_ID;
  const deadline = task ? Number(task.deadline) : 0;
  const deadlinePassed = deadline > 0 && Math.floor(Date.now() / 1000) > deadline;

  async function handleSubmit() {
    if (!address || !content.trim()) return;
    setErrorMsg(null);
    setStep("submitting");

    try {
      const contentHash = keccak256(stringToHex(content.trim()));
      const hash = await writeContractAsync({
        abi: iNeedEscrowV2Abi,
        address: ESCROW_ADDRESS,
        functionName: "submit",
        args: [taskId, contentHash],
      } as any);

      setTxHash(hash);
      const { waitForTransactionReceipt } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");
      await waitForTransactionReceipt(wagmiConfig, { hash });

      refetch();
      setStep("confirmed");
    } catch (err: any) {
      setErrorMsg(err?.message || err?.shortMessage || "Submit failed");
      setStep("error");
    }
  }

  if (isLoading || !task) return null;
  if (!hasAccepted) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Submit Work
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

      {hasSubmitted ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          You have submitted your work for this task.
        </div>
      ) : deadlinePassed ? (
        <p className="text-sm text-zinc-500">Submission deadline has passed.</p>
      ) : step === "idle" ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Your Work
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Describe your submission or paste content here..."
              rows={4}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder-zinc-500"
            />
            <p className="mt-1 text-xs text-zinc-400">
              Your content will be hashed and stored on-chain as proof of submission.
            </p>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!content.trim()}
            className="w-full rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Submit Work
          </button>
        </div>
      ) : step === "submitting" ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-center dark:border-zinc-700 dark:bg-zinc-800">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-white" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Submitting work to the chain...</p>
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
      ) : step === "confirmed" ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          Work submitted successfully. The hash is recorded on-chain.
        </div>
      ) : step === "error" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{errorMsg}</p>
          <button
            onClick={() => setStep("idle")}
            className="mt-2 rounded bg-red-700 px-3 py-1 text-sm text-white hover:bg-red-600"
          >
            Try Again
          </button>
        </div>
      ) : null}
    </div>
  );
}
