"use client";

import Link from "next/link";
import { ESCROW_ADDRESS, EXPLORER_URL, CHAIN_ID } from "@/lib/contract";
import {
  useNextTaskId,
  useFeeBps,
  useAdmin,
} from "@/lib/hooks/use-escrow";
import { useAccount, useSwitchChain } from "wagmi";
import { SiteHeader } from "@/app/components/site-header";

export default function Home() {
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  const { data: nextTaskId, isLoading: loadingTaskId } = useNextTaskId();
  const { data: feeBps } = useFeeBps();
  const { data: admin } = useAdmin();

  const onWrongNetwork = isConnected && chainId !== CHAIN_ID;

  return (
    <div className="flex flex-col flex-1">
      <SiteHeader />

      <main className="flex flex-1 flex-col items-center gap-8 px-6 py-12">
        {onWrongNetwork && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-5 py-3 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <span className="text-sm">Wrong network — please switch to Pharos Atlantic Testnet</span>
            <button
              onClick={() => switchChain({ chainId: CHAIN_ID })}
              className="rounded-md bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700"
            >
              Switch
            </button>
          </div>
        )}

        <div className="w-full max-w-2xl space-y-6">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Contract Status
            </h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Contract</span>
                <a
                  href={`${EXPLORER_URL}/address/${ESCROW_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-blue-600 hover:underline dark:text-blue-400"
                >
                  {ESCROW_ADDRESS.slice(0, 10)}...{ESCROW_ADDRESS.slice(-6)}
                </a>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Network</span>
                <span className="text-zinc-800 dark:text-zinc-200">
                  Pharos Atlantic Testnet (Chain {CHAIN_ID})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Admin</span>
                <span className="font-mono text-zinc-800 dark:text-zinc-200">
                  {admin ? `${(admin as string).slice(0, 6)}...${(admin as string).slice(-4)}` : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Platform Fee</span>
                <span className="text-zinc-800 dark:text-zinc-200">
                  {feeBps !== undefined ? `${Number(feeBps) / 100}%` : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Tasks Created</span>
                <span className="text-zinc-800 dark:text-zinc-200">
                  {loadingTaskId ? "..." : nextTaskId !== undefined ? Number(nextTaskId) - 1 : "—"}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Wallet
            </h2>
            {isConnected ? (
              <div className="space-y-3">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Wallet connected. You can now interact with the iNeedEscrow
                  contract on Pharos Atlantic Testnet.
                </p>
                <Link
                  href="/create"
                  className="inline-block rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Create Task
                </Link>
              </div>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Connect your wallet to interact with the iNeed marketplace.
              </p>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-200 px-6 py-4 text-center text-sm text-zinc-500 dark:border-zinc-800">
        iNeed Agent Marketplace — Pharos Atlantic Testnet
      </footer>
    </div>
  );
}
