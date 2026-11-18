"use client";

import { ProfitabilityTab } from "../_components/tab-loader";
import { useCapital } from "../_components/capital-context";

export default function CapitalProfitabilityPage() {
  const { profitability } = useCapital();
  return <ProfitabilityTab data={profitability} />;
}
