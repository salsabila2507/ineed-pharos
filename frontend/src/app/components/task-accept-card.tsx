"use client";

import { useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { useWriteContract, useReadContract } from "wagmi";
import { iNeedEscrowV2Abi } from "@/lib/abi";
import { ESCROW_ADDRESS, EXPLORER_URL, CHAIN_ID } from "@/lib/contract";
import { useTaskDetails } from "@/lib/hooks/use-escrow";

interface TaskAcceptCardProps {
  taskId: bigint;
}

type Step = "idle" | "accepting" | "confirmed" | "error";

export function TaskAcceptCard({ taskId }: TaskAcceptCardProps) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { task, statusCode, isLoading, refetch } = useTaskDetails(taskId);

  const { data: hasAccepted } = useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS,
    functionName: "hasAccepted",
    args: address ? [taskId, address] : undefined,
  } as any);

  const [step, setStep] = useState<Step>("idle");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isCreator =
    task &&
    address &&
    (task.creator as string).toLowerCase() === address.toLowerCase();
  const onWrongNetwork = isConnected && chainId !== CHAIN_ID;
  const canAccept = statusCode === 2 || statusCode === 3;

  async function handleAccept() {
    if (!address) return;
    setErrorMsg(null);
    setStep("accepting");

    try {
      const hash = await writeContractAsync({
        abi: iNeedEscrowV2Abi,
        address: ESCROW_ADDRESS,
        functionName: "accept",
        args: [taskId],
      } as any);

      setTxHash(hash);
      const { waitForTransactionReceipt } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");
      await waitForTransactionReceipt(wagmiConfig, { hash });

      refetch();
      setStep("confirmed");
    } catch (err: any) {
      setErrorMsg(err?.message || err?.shortMessage || "Accept failed");
      setStep("error");
    }
  }

  if (isLoading || !task) return null;
  if (isCreator) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Participation
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

      {hasAccepted ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          You have accepted this task.
        </div>
      ) : !canAccept ? (
        <p className="text-sm text-zinc-500">Task is not open for acceptance.</p>
      ) : !isConnected ? (
        <p className="text-sm text-zinc-500">Connect your wallet to accept this task.</p>
      ) : step === "idle" ? (
        <button
          onClick={handleAccept}
          className="w-full rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Accept Task
        </button>
      ) : step === "accepting" ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-center dark:border-zinc-700 dark:bg-zinc-800">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-white" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Accepting task...</p>
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
          You are now a participant. You can submit your work.
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
