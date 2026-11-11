"use client";
import { useAuth } from "@/lib/auth";

/**
 * Single source of truth for "what may this person do in People?".
 *
 * The API gates writes on `PEOPLE` edit plus `@Roles("Owner","HR/Admin")`.
 * Without a matching client check, every manager (PEOPLE view-only) was shown
 * Add / Record / Import / Approve buttons that always answered 403.
 */
export function usePeopleAccess() {
  const { user } = useAuth();
  const role = String(user?.role ?? user?.roleName ?? "");
  const perms = user?.permissions?.PEOPLE;
  const isHr = /^(owner|admin|hr\/admin)$/i.test(role) || /(^|[\s/])(owner|admin|hr)([\s/]|$)/i.test(role);
  const canView = isHr || perms?.view === true;
  const canEdit = isHr || perms?.edit === true;
  const canApprove = isHr || perms?.approve === true;
  /** Compensation (salary, deductions, payslips) is Owner / HR only. */
  const canSeePay = isHr;
  /** Marking meeting attendance goes through the PULSE module guard. */
  const canManagePulse = user?.permissions?.PULSE?.edit === true || isHr;
  /** Leave decisions mirror LeaveService.APPROVER_ROLES. */
  const canDecideLeave = isHr || /project\s*manager/i.test(role) || canApprove;

  return { user, role, isHr, canView, canEdit, canApprove, canSeePay, canManagePulse, canDecideLeave };
}
