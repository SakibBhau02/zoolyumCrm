/**
 * Task status vocabulary for the API.
 *
 * The Prisma enum is `TODO | IN_PROGRESS | REVIEW | DONE | BLOCKED`. The web app
 * used to also send `BACKLOG` and `IN_REVIEW`, which reached Prisma and threw a
 * validation error — cards moved into "In Review" simply failed. Old saved
 * views and bookmarks still carry those strings, so every entry point folds
 * them onto a real status instead of rejecting the request.
 */
export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "REVIEW", "BLOCKED", "DONE"] as const;
export type TaskStatusValue = (typeof TASK_STATUSES)[number];

export function normalizeTaskStatus(value?: string | null): TaskStatusValue {
  const v = String(value ?? "").toUpperCase().replace(/[\s-]/g, "_");
  if (v === "IN_REVIEW" || v === "REVIEW") return "REVIEW";
  if (v === "BACKLOG" || v === "TODO" || v === "OPEN") return "TODO";
  if (v === "IN_PROGRESS" || v === "PROGRESS" || v === "DOING") return "IN_PROGRESS";
  if (v === "BLOCKED") return "BLOCKED";
  if (v === "DONE" || v === "COMPLETED" || v === "CLOSED") return "DONE";
  return "TODO";
}
