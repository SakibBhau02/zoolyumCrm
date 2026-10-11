"use client";

import { ProfitabilityTab } from "../_components/tabs";
import { useCapital } from "../_components/capital-context";

export default function CapitalProfitabilityPage() {
  const { profitability } = useCapital();
  return <ProfitabilityTab data={profitability} />;
}
