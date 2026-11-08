"use client";

/**
 * Task setup — templates, automation, workload and estimation accuracy.
 *
 * Split out of the daily board so the work screen stays focused: configuration
 * lives here, execution lives on /tasks.
 */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { PageHeader } from "@/components/shared";
import {
  AutomationPanel,
  EstimationAccuracyPanel,
  TaskTypeRulesPanel,
  TemplatesPanel,
  WorkloadPanel,
  type UserLite,
} from "@/components/tasks/setup";
import { useToast } from "@/app/(app)/people/_components/hooks";
import { Toast } from "@/app/(app)/people/_components/hooks";

export default function TaskSetupPage() {
  const { flash, notify } = useToast();
  const { data: employees } = useApi<UserLite[]>("/people/employees");
  const users = employees ?? [];

  return (
    <div>
      <Toast flash={flash} />
      <PageHeader
        title="Task setup"
        subtitle="Templates, automation rules, workload capacity and estimation accuracy."
        actions={
          <Link
            href="/tasks"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Back to board
          </Link>
        }
      />

      <WorkloadPanel onNotify={notify} />

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TemplatesPanel onNotify={notify} />
        <TaskTypeRulesPanel onNotify={notify} />
      </div>

      <div className="mt-6">
        <AutomationPanel users={users} onNotify={notify} />
      </div>

      <div className="mt-6">
        <EstimationAccuracyPanel users={users} />
      </div>
    </div>
  );
}
