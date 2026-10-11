"use client";

import { ActivityTab } from "../_components/tabs";
import { useCapital } from "../_components/capital-context";

export default function CapitalActivityPage() {
  const { activity, reload } = useCapital();
  return <ActivityTab activity={activity} refresh={reload} />;
}
