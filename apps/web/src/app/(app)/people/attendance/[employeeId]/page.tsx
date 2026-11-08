import { redirect } from "next/navigation";

/**
 * Legacy route. The per-employee attendance view now lives inside Team 360
 * (`/people/team?id=…`), which also carries tasks, meetings and leave. Any old
 * link — bookmarks, the directory page, exported CSVs — still lands correctly.
 */
export default async function LegacyEmployeeAttendance({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const { employeeId } = await params;
  redirect(`/people/team?id=${employeeId}`);
}
