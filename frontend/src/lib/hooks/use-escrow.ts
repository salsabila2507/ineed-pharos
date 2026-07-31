"use client";

import { useReadContract, useWriteContract } from "wagmi";
import { iNeedEscrowV2Abi } from "@/lib/abi";
import { ESCROW_ADDRESS, ZERO_ADDRESS } from "@/lib/contract";

export function useEscrowRead(functionName: string, args: unknown[] = []) {
  return useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS as `0x${string}`,
    functionName: functionName as any,
    args: args as any,
  });
}

export function useEscrowWrite() {
  return useWriteContract();
}

export function useTask(taskId: number) {
  return useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS as `0x${string}`,
    functionName: "tasks",
    args: [BigInt(taskId)],
  } as any);
}

export function useEscrow(taskId: number) {
  return useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS as `0x${string}`,
    functionName: "getEscrow",
    args: [BigInt(taskId)],
  } as any);
}

export function useNextTaskId() {
  return useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS as `0x${string}`,
    functionName: "nextTaskId",
    args: [],
  } as any);
}

export function useFeeBps() {
  return useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS as `0x${string}`,
    functionName: "feeBps",
    args: [],
  } as any);
}

export function useAdmin() {
  return useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS as `0x${string}`,
    functionName: "admin",
    args: [],
  } as any);
}

export function useHasAccepted(taskId: number, address: string | undefined) {
  return useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS as `0x${string}`,
    functionName: "hasAccepted",
    args: address ? [BigInt(taskId), address as `0x${string}`] : undefined,
  } as any);
}

export function useHasSubmitted(taskId: number, address: string | undefined) {
  return useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS as `0x${string}`,
    functionName: "hasSubmitted",
    args: address ? [BigInt(taskId), address as `0x${string}`] : undefined,
  } as any);
}

export function useIsDisputed(taskId: number) {
  return useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS as `0x${string}`,
    functionName: "isDisputed",
    args: [BigInt(taskId)],
  } as any);
}

export function useGetParticipants(taskId: number) {
  return useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS as `0x${string}`,
    functionName: "getParticipants",
    args: [BigInt(taskId)],
  } as any);
}

export function useGetSubmissions(taskId: number) {
  return useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS as `0x${string}`,
    functionName: "getSubmissions",
    args: [BigInt(taskId)],
  } as any);
}

const STATUS_NAMES = [
  "Created", "Funded", "Open", "Accepted", "Submitted",
  "Review", "Completed", "Disputed", "Resolved", "Cancelled",
] as const;

export function useTaskDetails(taskId: bigint) {
  const taskResult = useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS as `0x${string}`,
    functionName: "tasks",
    args: [taskId],
    query: { enabled: !!taskId },
  } as any);

  const escrowResult = useReadContract({
    abi: iNeedEscrowV2Abi,
    address: ESCROW_ADDRESS as `0x${string}`,
    functionName: "getEscrow",
    args: [taskId],
    query: { enabled: !!taskId },
  } as any);

  const task: any = taskResult.data;
  const escrow: any = escrowResult.data;

  const statusCode = task ? Number(task.status) : -1;
  const statusName = statusCode >= 0 && statusCode < STATUS_NAMES.length
    ? STATUS_NAMES[statusCode as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9]
    : "Unknown";
  const isFunded = statusCode >= 1;
  const ZERO = BigInt(0);
  const rewardTotal = task ? (task.rewardTotal as bigint) : ZERO;
  const fundedAmount = escrow ? (escrow.totalAmount as bigint) : ZERO;
  const remainingToDeposit = rewardTotal - fundedAmount;
  const isFullyFunded = remainingToDeposit <= ZERO;
  const rewardAsset = task ? (task.rewardAsset as string) : ZERO_ADDRESS;
  const isNativeReward = rewardAsset === ZERO_ADDRESS;

  return {
    task,
    escrow,
    statusCode,
    statusName,
    isFunded,
    isFullyFunded,
    rewardTotal,
    fundedAmount,
    remainingToDeposit,
    rewardAsset,
    isNativeReward,
    isLoading: taskResult.isLoading || escrowResult.isLoading,
    refetch: () => {
      taskResult.refetch();
      escrowResult.refetch();
    },
  } as const;
}
