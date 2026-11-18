"use client";

import dynamic from "next/dynamic";
import { TabSkeleton } from "./tab-skeleton";

/**
 * Lazy handles for the capital tabs.
 *
 * `tabs.tsx` is a single 146 KB module that statically imports recharts, the
 * modal set and the PDF helpers. Before this file every capital route imported
 * it eagerly, so `/capital/vendors` (a 0.4 KB page) downloaded the entire
 * finance module — and the sidebar's prefetch did it in the background for all
 * twelve nav targets.
 *
 * A dynamic import per tab keeps the route chunk tiny; the shared chunk loads
 * once and is then served from the browser cache for every other capital tab.
 *
 * The options are written out per call on purpose: this Next version rejects a
 * shared options object ("next/dynamic options must be an object literal") and
 * fails the whole route at compile time.
 */
export const OverviewTab = dynamic(() => import("./tabs").then((m) => m.OverviewTab), {
  ssr: false,
  loading: () => <TabSkeleton />,
});
export const InvoicesTab = dynamic(() => import("./tabs").then((m) => m.InvoicesTab), {
  ssr: false,
  loading: () => <TabSkeleton />,
});
export const ExpensesTab = dynamic(() => import("./tabs").then((m) => m.ExpensesTab), {
  ssr: false,
  loading: () => <TabSkeleton />,
});
export const IncomeTab = dynamic(() => import("./tabs").then((m) => m.IncomeTab), {
  ssr: false,
  loading: () => <TabSkeleton />,
});
export const ReportsTab = dynamic(() => import("./tabs").then((m) => m.ReportsTab), {
  ssr: false,
  loading: () => <TabSkeleton />,
});
export const ProfitabilityTab = dynamic(() => import("./tabs").then((m) => m.ProfitabilityTab), {
  ssr: false,
  loading: () => <TabSkeleton />,
});
export const AccountsTab = dynamic(() => import("./tabs").then((m) => m.AccountsTab), {
  ssr: false,
  loading: () => <TabSkeleton />,
});
export const VendorsTab = dynamic(() => import("./tabs").then((m) => m.VendorsTab), {
  ssr: false,
  loading: () => <TabSkeleton />,
});
export const ActivityTab = dynamic(() => import("./tabs").then((m) => m.ActivityTab), {
  ssr: false,
  loading: () => <TabSkeleton />,
});
