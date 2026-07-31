"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletConnect } from "@/app/components/wallet-connect";

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
          iNeed <span className="font-normal text-zinc-500">Pharos</span>
        </Link>
        <nav className="hidden sm:flex items-center gap-4 text-sm">
          <Link
            href="/"
            className={`${pathname === "/" ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
          >
            Dashboard
          </Link>
          <Link
            href="/create"
            className={`${pathname === "/create" ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
          >
            Create Task
          </Link>
        </nav>
      </div>
      <WalletConnect />
    </header>
  );
}
