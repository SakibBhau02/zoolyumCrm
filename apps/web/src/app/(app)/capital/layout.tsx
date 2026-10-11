import { PageHeader } from "@/components/shared";
import { CapitalProvider } from "./_components/capital-context";
import CapitalTabNav from "./_components/tab-nav";
import { CapitalFlash, CapitalGlobalModals, CapitalHeaderActions } from "./_components/capital-shell";

export default function CapitalLayout({ children }: { children: React.ReactNode }) {
  return (
    <CapitalProvider>
      <CapitalFlash />
      <PageHeader
        title="Capital — Finance"
        subtitle="Invoicing, expenses, payments and real-time profitability."
        actions={<CapitalHeaderActions />}
      />
      <div className="mb-5 overflow-x-auto pb-1">
        <CapitalTabNav />
      </div>
      <div className="mt-5">{children}</div>
      <CapitalGlobalModals />
    </CapitalProvider>
  );
}
