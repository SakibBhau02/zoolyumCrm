"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OverviewTab } from "./_components/tab-loader";
import { useCapital } from "./_components/capital-context";
import { LEGACY_TAB_ROUTE } from "./_components/constants";

/**
 * Canonical route: /capital (Overview).
 * Also handles legacy links (/capital?tab=xxx, /capital?inv=xxx, /capital?clientId=xxx)
 * by redirecting to the new per-tab routes.
 */
function OverviewContent() {
  const { overview, invoices, expenses, aging, installmentsDue } = useCapital();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get("tab");
    const inv = searchParams.get("inv");
    const clientId = searchParams.get("clientId");
    if (tab && LEGACY_TAB_ROUTE[tab] && LEGACY_TAB_ROUTE[tab] !== "/capital") {
      const params = new URLSearchParams();
      if (inv) params.set("inv", inv);
      if (clientId) params.set("clientId", clientId);
      router.replace(`${LEGACY_TAB_ROUTE[tab]}${params.toString() ? `?${params.toString()}` : ""}`);
    } else if (!tab && (inv || clientId)) {
      const params = new URLSearchParams();
      if (inv) params.set("inv", inv);
      if (clientId) params.set("clientId", clientId);
      router.replace(`/capital/invoices?${params.toString()}`);
    }
  }, [router, searchParams]);

  return <OverviewTab overview={overview} invoices={invoices} expenses={expenses} aging={aging} installmentsDue={installmentsDue} />;
}

export default function CapitalOverviewPage() {
  return (
    <Suspense>
      <OverviewContent />
    </Suspense>
  );
}
