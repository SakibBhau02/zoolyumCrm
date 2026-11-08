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
      <div className="sticky top-0 z-30 -mx-4 mb-4 border-b border-border/60 bg-background/90 bg-mesh px-4 py-2.5 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <CapitalTabNav />
      </div>
      <div className="mt-4">{children}</div>
      <CapitalGlobalModals />
    </CapitalProvider>
  );
}
