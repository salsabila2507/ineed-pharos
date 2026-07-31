"use client";

import { useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { useReadContract, useWriteContract } from "wagmi";
import { formatEther, formatUnits } from "viem";
import { iNeedEscrowV2Abi, erc20Abi } from "@/lib/abi";
import { ESCROW_ADDRESS, EXPLORER_URL, CHAIN_ID, ZERO_ADDRESS } from "@/lib/contract";
import { useTaskDetails } from "@/lib/hooks/use-escrow";

interface TaskFundingCardProps {
  taskId: bigint;
}

type Step = "idle" | "approving" | "approved" | "depositing" | "refunding" | "confirmed" | "error";

export function TaskFundingCard({ taskId }: TaskFundingCardProps) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const {
    task,
    escrow,
    statusCode,
    statusName,
    rewardTotal,
    fundedAmount,
    remainingToDeposit,
    isFullyFunded,
    isLoading,
    rewardAsset,
    isNativeReward,
    refetch,
  } = useTaskDetails(taskId);

  const [step, setStep] = useState<Step>("idle");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: allowance } = useReadContract({
    abi: erc20Abi,
    address: rewardAsset as `0x${string}`,
    functionName: "allowance",
    args: [address, ESCROW_ADDRESS],
    query: { enabled: !!address && !isNativeReward && !isFullyFunded },
  } as any);

  const { data: tokenDecimals } = useReadContract({
    abi: erc20Abi,
    address: rewardAsset as `0x${string}`,
    functionName: "decimals",
    args: [],
    query: { enabled: !!address && !isNativeReward && !isFullyFunded },
  } as any);

  const symbol = isNativeReward ? "PHRS" : "USDC";
  const hasAllowance = !isNativeReward && allowance !== undefined && (allowance as bigint) >= remainingToDeposit;

  const isCreator =
    task &&
    address &&
    (task.creator as string).toLowerCase() === address.toLowerCase();

  const onWrongNetwork = isConnected && chainId !== CHAIN_ID;

  const canRefund =
    isCreator &&
    isFullyFunded &&
    (statusCode === 1 || statusCode === 2) &&
    Number(task?.participantCount ?? 0) === 0;

  async function handleApprove() {
    if (!address) return;
    setErrorMsg(null);
    setStep("approving");

    try {
      const hash = await writeContractAsync({
        abi: erc20Abi,
        address: rewardAsset as `0x${string}`,
        functionName: "approve",
        args: [ESCROW_ADDRESS, remainingToDeposit],
      });

      setTxHash(hash);
      const { waitForTransactionReceipt } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");
      await waitForTransactionReceipt(wagmiConfig, { hash });

      setStep("approved");
    } catch (err: any) {
      setErrorMsg(err?.message || err?.shortMessage || "Approve failed");
      setStep("error");
    }
  }

  async function handleDeposit() {
    if (!address) return;
    setErrorMsg(null);
    setStep("depositing");

    try {
      const hash = await writeContractAsync({
        abi: iNeedEscrowV2Abi,
        address: ESCROW_ADDRESS,
        functionName: "deposit",
        args: [taskId],
        ...(isNativeReward ? { value: remainingToDeposit } : {}),
      } as any);

      setTxHash(hash);
      const { waitForTransactionReceipt } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");
      await waitForTransactionReceipt(wagmiConfig, { hash });

      refetch();
      setStep("confirmed");
    } catch (err: any) {
      setErrorMsg(err?.message || err?.shortMessage || "Deposit failed");
      setStep("error");
    }
  }

  function formatAmount(value: bigint): string {
    if (isNativeReward) return formatEther(value);
    return formatUnits(value, Number(tokenDecimals ?? 6));
  }

  async function handleRefund() {
    if (!address) return;
    setErrorMsg(null);
    setStep("refunding");

    try {
      const hash = await writeContractAsync({
        abi: iNeedEscrowV2Abi,
        address: ESCROW_ADDRESS,
        functionName: "refund",
        args: [taskId],
      } as any);

      setTxHash(hash);
      const { waitForTransactionReceipt } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");
      await waitForTransactionReceipt(wagmiConfig, { hash });

      refetch();
      setStep("idle");
    } catch (err: any) {
      setErrorMsg(err?.message || err?.shortMessage || "Refund failed");
      setStep("error");
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-white" />
        <p className="text-sm text-zinc-500">Loading task...</p>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-950">
        <p className="text-sm text-red-700 dark:text-red-300">Task not found</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Task #{taskId.toString()}
      </h2>

      <div className="mb-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-zinc-500">Status</span>
          <span className="font-medium text-zinc-800 dark:text-zinc-200">{statusName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Reward Total</span>
          <span className="font-mono text-zinc-800 dark:text-zinc-200">{formatAmount(rewardTotal)} {symbol}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Funded</span>
          <span className="font-mono text-zinc-800 dark:text-zinc-200">{formatAmount(fundedAmount)} {symbol}</span>
        </div>
        {remainingToDeposit > BigInt(0) && (
          <div className="flex justify-between">
            <span className="text-zinc-500">Remaining</span>
            <span className="font-mono text-amber-600 dark:text-amber-400">{formatAmount(remainingToDeposit)} {symbol}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-zinc-500">Reward Asset</span>
          <span className="font-mono text-zinc-800 dark:text-zinc-200">{symbol}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Creator</span>
          <span className="font-mono text-zinc-800 dark:text-zinc-200">
            {(task.creator as string).slice(0, 6)}...{(task.creator as string).slice(-4)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Participants</span>
          <span className="text-zinc-800 dark:text-zinc-200">
            {Number(task.participantCount)} / {Number(task.maxParticipants) === 0 ? "∞" : String(task.maxParticipants)}
          </span>
        </div>
      </div>

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

      {statusCode === 9 ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          Task cancelled. Funds have been refunded to the creator.
        </div>
      ) : isFullyFunded ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          Task is fully funded.
        </div>
      ) : !isConnected ? (
        <p className="text-sm text-zinc-500">Connect your wallet to deposit.</p>
      ) : !isCreator ? (
        <p className="text-sm text-zinc-500">Only the task creator can deposit.</p>
      ) : step === "idle" && (isNativeReward || hasAllowance) ? (
        <button
          onClick={handleDeposit}
          className="w-full rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Deposit {formatAmount(remainingToDeposit)} {symbol}
        </button>
      ) : step === "idle" && !isNativeReward && !hasAllowance ? (
        <button
          onClick={handleApprove}
          className="w-full rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Approve {symbol}
        </button>
      ) : step === "approving" ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-center dark:border-zinc-700 dark:bg-zinc-800">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-white" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Approving {symbol} spending...
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
      ) : step === "approved" ? (
        <div>
          <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
            Approved! Now deposit the {symbol}.
          </div>
          <button
            onClick={handleDeposit}
            className="w-full rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Deposit {formatAmount(remainingToDeposit)} {symbol}
          </button>
        </div>
      ) : step === "depositing" ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-center dark:border-zinc-700 dark:bg-zinc-800">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-white" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Depositing funds to escrow...
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
      ) : step === "confirmed" ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          Deposit confirmed. Task is now funded and active on the marketplace.
        </div>
      ) : null}

      {step === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{errorMsg}</p>
          <button
            onClick={() => setStep("idle")}
            className="mt-2 rounded bg-red-700 px-3 py-1 text-sm text-white hover:bg-red-600"
          >
            Try Again
          </button>
        </div>
      )}

      {canRefund && step === "idle" && (
        <button
          onClick={handleRefund}
          className="mt-4 w-full rounded-lg border border-red-300 px-6 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
        >
          Refund &amp; Cancel Task
        </button>
      )}

      {canRefund && step === "refunding" && (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-center dark:border-zinc-700 dark:bg-zinc-800">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-white" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Refunding funds to your wallet...
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
      )}
    </div>
  );
}
