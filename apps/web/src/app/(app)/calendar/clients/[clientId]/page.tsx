"use client";

import { useParams } from "next/navigation";
import { CalendarWorkspace } from "@/components/calendar/workspace";

export default function ClientCalendarPage() {
  const params = useParams<{ clientId: string }>();
  const clientId = typeof params?.clientId === "string" ? params.clientId : undefined;
  return <CalendarWorkspace fixedClientId={clientId} />;
}
