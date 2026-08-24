import { PageHeader } from "@/components/shared";
import TabNav from "./_components/tab-nav";

export default function PeopleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader
        title="People — HRM"
        subtitle="Attendance through payroll, with utilization intelligence."
        actions={<span className="rounded-full border border-border bg-card px-3 py-1.5 text-[11.5px] text-muted-foreground">Payroll: July finalized</span>}
      />
      <div className="overflow-x-auto pb-1">
        <TabNav />
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}