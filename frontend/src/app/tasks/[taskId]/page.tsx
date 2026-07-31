"use client";

import Link from "next/link";
import { use } from "react";
import { SiteHeader } from "@/app/components/site-header";
import { TaskFundingCard } from "@/app/components/task-funding-card";
import { TaskAcceptCard } from "@/app/components/task-accept-card";
import { TaskSubmissionCard } from "@/app/components/task-submission-card";
import { TaskWinnersCard } from "@/app/components/task-winners-card";

export default function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params);
  const taskIdBigInt = BigInt(taskId);

  return (
    <div className="flex flex-col flex-1">
      <SiteHeader />

      <main className="flex flex-1 flex-col items-center px-6 py-12">
        <div className="w-full max-w-xl space-y-6">
          <TaskFundingCard taskId={taskIdBigInt} />
          <TaskAcceptCard taskId={taskIdBigInt} />
          <TaskSubmissionCard taskId={taskIdBigInt} />
          <TaskWinnersCard taskId={taskIdBigInt} />

          <Link
            href="/"
            className="block text-center text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}
