import TabNav from "./_components/tab-nav";
import { PayrollStatusBadge } from "./_components/payroll-status";

/**
 * People chrome is deliberately slimmer than the other modules: the tabs carry
 * their own compact hero, so a big page header here would only push the actual
 * numbers below the fold.
 */
export default function PeopleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h1 className="font-heading text-title font-bold tracking-tight">People</h1>
          <span className="hidden text-meta text-muted-foreground sm:inline">
            HRM · attendance, leave, payroll
          </span>
        </div>
        <PayrollStatusBadge />
      </div>
      <TabNav />
      <div className="mt-2">{children}</div>
    </div>
  );
}
