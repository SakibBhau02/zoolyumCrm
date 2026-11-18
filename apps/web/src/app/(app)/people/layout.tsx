import { PageHeader } from "@/components/shared";
import TabNav from "./_components/tab-nav";
import { PayrollStatusBadge } from "./_components/payroll-status";

/**
 * People chrome follows the same shape as the other modules: one standard
 * page header, then a sticky tab strip. The module used to render a bespoke
 * 17px heading with no subtitle, which made it look like a different product
 * next to Tasks, Capital and Clients.
 */
export default function PeopleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader
        title="People"
        subtitle="HRM — attendance, leave, payroll and performance."
        actions={<PayrollStatusBadge />}
      />
      <div className="sticky top-0 z-30 -mx-4 mb-4 border-b border-border/60 bg-background/90 bg-mesh px-4 py-2.5 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <TabNav />
      </div>
      <div>{children}</div>
    </div>
  );
}
