"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ArrowLeft, Briefcase, CalendarClock, FileText, Fingerprint, GraduationCap, ListTodo, Pencil, Phone, Target, Trash2, Users, Wallet } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatBDT, formatDate, formatDay } from "@/lib/format";
import { Avatar, CardShell, EmptyState, SectionTitle, SkeletonBlock, StatusBadge, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { label, monthNow, skillsOf, fmtTime } from "../../_components/constants";
import { LoadOrError, Toast, useList, useToast } from "../../_components/hooks";
import EmployeeProfileModal from "../../_components/modals/employee-profile";

const isHr = (user: any) => /owner|hr|admin/i.test(`${user?.role ?? ""} ${user?.roleName ?? ""}`);

function Fact({ label: l, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{l}</p>
      <p className={cn("mt-0.5 text-[12.5px]", mono && "font-mono font-semibold tabular-nums")}>{value ?? "—"}</p>
    </div>
  );
}

function tenure(joinDate?: string | null) {
  if (!joinDate) return null;
  const months = Math.max(0, Math.floor((Date.now() - new Date(joinDate).getTime()) / (30 * 86400000)));
  if (months < 1) return "< 1 mo";
  if (months < 12) return `${months} mo`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${y}y${m ? ` ${m}mo` : ""}`;
}

export default function EmployeeProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((r) => r + 1), []);
  const { data: detail, loading, error } = useList<any>(`/people/employees/${params.id}`, refresh);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { flash, notify } = useToast();
  const canSeePay = isHr(user);

  const doDelete = async () => {
    if (!detail) return;
    if (!window.confirm(`Delete ${detail.name}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/people/employees/${detail.id}`, { method: "DELETE" });
      router.back();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const monthKey = monthNow();
  const monthAtt = (detail?.attendance ?? []).filter((a: any) => String(a.date).slice(0, 7) === monthKey);
  const attCount = (s: string) => monthAtt.filter((a: any) => a.status === s).length;
  const openTasks: any[] = detail?.tasks ?? [];
  const pendingLeaves = (detail?.leaveRequests ?? []).filter((l: any) => l.status === "PENDING");
  const payroll: any[] = detail?.payrollRecords ?? [];
  const balances: any[] = detail?.leaveBalances ?? [];
  const reviews: any[] = detail?.performanceReviews ?? [];
  const career: any[] = Array.isArray(detail?.careerHistory) ? detail.careerHistory : [];
  const docs: any[] = Array.isArray(detail?.documents) ? detail.documents : [];

  return (
    <div>
      <Toast flash={flash} />
      <div className="mb-4">
        <Link href="/people/directory" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Directory
        </Link>
      </div>
      <LoadOrError loading={loading} error={error} onRetry={reload} skeleton={8} />
      {!loading && !error && detail && (
        <div className="flex flex-col gap-4">
          {/* Header */}
          <CardShell>
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name={detail.name} size="size-12" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-heading text-[19px] font-bold">{detail.name}</p>
                  <StatusBadge status={detail.employmentStatus} />
                </div>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {detail.roleTitle}{detail.department ? ` · ${detail.department}` : ""}{detail.reportingManager ? ` · reports to ${detail.reportingManager.name}` : ""}
                  {tenure(detail.joinDate) ? ` · ${tenure(detail.joinDate)} tenure` : ""}
                </p>
              </div>
              <Btn variant="outline" onClick={() => setEditOpen(true)}><Pencil className="size-3.5" /> Edit profile</Btn>
              <Btn variant="ghost" className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-400" onClick={doDelete} disabled={deleting}>
                <Trash2 className="size-3.5" /> {deleting ? "Deleting…" : "Delete"}
              </Btn>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Present (mo)", monthAtt.filter((a: any) => a.status === "PRESENT").length, "text-emerald-500"],
                ["Late (mo)", monthAtt.filter((a: any) => a.status === "LATE").length, "text-amber-500"],
                ["Absent (mo)", monthAtt.filter((a: any) => a.status === "ABSENT").length, "text-rose-500"],
                ["Open tasks", openTasks.length, ""],
              ].map(([k, v, tone]) => (
                <div key={k as string} className="rounded-xl bg-muted/40 px-3 py-2 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{k}</p>
                  <p className={cn("mt-0.5 font-heading text-[16px] font-bold tabular-nums", tone as string)}>{v}</p>
                </div>
              ))}
            </div>
          </CardShell>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="flex flex-col gap-4">
              {/* Contact & job */}
              <CardShell>
                <SectionTitle title="Contact & job" />
                <div className="grid grid-cols-2 gap-3">
                  <Fact label="Email" value={detail.email} />
                  <Fact label="Phone" value={detail.phone} />
                  <Fact label="Department" value={detail.department} />
                  <Fact label="Location" value={detail.workLocation} />
                  <Fact label="Type" value={<span className="capitalize">{label(detail.employmentType ?? "full-time")}</span>} />
                  <Fact label="Joined" value={formatDate(detail.joinDate)} />
                  <Fact label="Shift" value={detail.shiftStart || detail.shiftEnd ? `${detail.shiftStart ?? "—"} → ${detail.shiftEnd ?? "—"}` : "Per company policy"} />
                  <Fact label="Late grace" value={detail.graceMinutes != null ? `${detail.graceMinutes} min` : "Per company policy"} />
                  <Fact label="Weekly off" value={detail.weeklyOffDays?.length ? detail.weeklyOffDays.join(", ") : "Per company policy"} />
                  <Fact label="Device ID" value={<span className="font-mono font-semibold">{detail.deviceId ?? "—"}</span>} />
                </div>
                {skillsOf(detail).length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Skills</p>
                    <span className="flex flex-wrap gap-1">
                      {skillsOf(detail).map((s: string) => <span key={s} className="rounded-full bg-brand-gradient-soft px-2 py-0.5 text-[10px] font-medium text-primary dark:text-primary">{s}</span>)}
                    </span>
                  </div>
                )}
              </CardShell>

              {/* Compensation (restricted) */}
              {canSeePay ? (
                <CardShell>
                  <SectionTitle title="Compensation" subtitle="Visible to Owner / HR only" icon={<Wallet className="size-3.5" />} />
                  <div className="grid grid-cols-2 gap-3">
                    <Fact label="Monthly salary" value={<span className="font-semibold tabular-nums">{formatBDT(detail.salary != null ? Number(detail.salary) : null)}</span>} />
                    <Fact label="Pay frequency" value={<span className="capitalize">{label(detail.payFrequency ?? "monthly")}</span>} />
                  </div>
                </CardShell>
              ) : null}

              {/* Emergency contact */}
              {(detail.emergencyContactName || detail.emergencyContactPhone) && (
                <CardShell>
                  <SectionTitle title="Emergency contact" icon={<Phone className="size-3.5" />} />
                  <div className="grid grid-cols-3 gap-3">
                    <Fact label="Name" value={detail.emergencyContactName} />
                    <Fact label="Phone" value={detail.emergencyContactPhone} />
                    <Fact label="Relation" value={detail.emergencyContactRelation} />
                  </div>
                </CardShell>
              )}

              {/* Education & career */}
              {(detail.education || career.length > 0) && (
                <CardShell>
                  <SectionTitle title="Education & career" icon={<Briefcase className="size-3.5" />} />
                  {detail.education && <p className="text-[12.5px] font-medium">{detail.education}</p>}
                  <div className="mt-2 flex flex-col gap-1.5">
                    {career.map((c: any, i: number) => (
                      <div key={i} className="rounded-xl bg-muted/40 px-3 py-2">
                        <p className="text-[12px] font-semibold">{c.title || "—"}{c.company ? <span className="font-normal text-muted-foreground"> · {c.company}</span> : null}</p>
                        {c.period && <p className="text-[10.5px] text-muted-foreground">{c.period}</p>}
                      </div>
                    ))}
                  </div>
                </CardShell>
              )}
            </div>

            <div className="flex flex-col gap-4">
              {/* Reporting chain */}
              <CardShell>
                <SectionTitle title="Reporting chain" icon={<Users className="size-3.5" />} />
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Manager</span>
                    {detail.reportingManager ? (
                      <Link href={`/people/directory/${detail.reportingManager.id}`} className="text-[12.5px] font-semibold text-primary hover:underline">{detail.reportingManager.name}</Link>
                    ) : <span className="text-[12px] text-muted-foreground">—</span>}
                  </div>
                  <div className="rounded-xl bg-muted/40 px-3 py-2">
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Direct reports ({(detail.reports ?? []).length})</p>
                    {(detail.reports ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">None</p>}
                    <div className="flex flex-wrap gap-1.5">
                      {(detail.reports ?? []).map((r: any) => (
                        <Link key={r.id} href={`/people/directory/${r.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-[11.5px] font-medium hover:border-primary/40 hover:text-primary">
                          <Avatar name={r.name} size="size-5" />{r.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </CardShell>

              {/* Attendance */}
              <CardShell>
                <SectionTitle
                  title="Attendance"
                  subtitle={`${attCount("PRESENT")} present · ${attCount("LATE")} late · ${attCount("ABSENT")} absent this month`}
                  action={<Link href={`/people/attendance/${detail.id}`} className="text-[11.5px] font-semibold text-primary hover:underline">Full log →</Link>}
                />
                <div className="flex flex-col gap-1.5">
                  {(detail.attendance ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">No attendance logged.</p>}
                  {(detail.attendance ?? []).slice(0, 5).map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
                      <span className="text-[12px] font-medium">{formatDay(a.date)}</span>
                      <div className="flex items-center gap-2"><span className="text-[10.5px] tabular-nums text-muted-foreground">{fmtTime(a.checkInTime)} → {fmtTime(a.checkOutTime)}</span><StatusBadge status={a.status} /></div>
                    </div>
                  ))}
                </div>
              </CardShell>

              {/* Payroll */}
              <CardShell>
                <SectionTitle title="Payroll history" subtitle={canSeePay ? "Recent payslips" : "Recent payslips (amounts hidden)"} icon={<Wallet className="size-3.5" />} />
                <div className="flex flex-col gap-1.5">
                  {(payroll ?? []).length === 0 && <p className="text-[11.5px] text-muted-foreground">No payroll records yet.</p>}
                  {payroll.slice(0, 6).map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2">
                      <Link href={`/people/payroll/payslip/${p.id}`} className="text-[12px] font-semibold text-primary hover:underline">{p.period}</Link>
                      <div className="flex items-center gap-2">
                        {canSeePay && <span className="text-[12px] font-bold tabular-nums">{formatBDT(p.netPay != null ? Number(p.netPay) : null)}</span>}
                        <StatusBadge status={p.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </CardShell>

              {/* Leave */}
              <CardShell>
                <SectionTitle title="Leave" subtitle="Balances + recent requests" icon={<CalendarClock className="size-3.5" />} />
                {balances.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {balances.map((b: any) => (
                      <span key={b.id ?? b.leaveType} className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold tabular-nums">{b.leaveType}: {Number(b.balanceDays)}d</span>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  {((detail.leaveRequests ?? []).length === 0) && <p className="text-[11.5px] text-muted-foreground">No leave taken.</p>}
                  {(detail.leaveRequests ?? []).slice(0, 4).map((l: any) => (
                    <div key={l.id} className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
                      <div><p className="text-[12px] font-medium">{l.leaveType}</p><p className="text-[10.5px] text-muted-foreground">{formatDay(l.startDate)} → {formatDay(l.endDate)}</p></div>
                      <StatusBadge status={l.status} />
                    </div>
                  ))}
                </div>
              </CardShell>

              {/* Tasks */}
              <CardShell>
                <SectionTitle title={`Open tasks (${openTasks.length})`} icon={<ListTodo className="size-3.5" />} />
                {openTasks.length === 0 && <p className="text-[11.5px] text-muted-foreground">Nothing open.</p>}
                <div className="flex flex-col gap-1.5">
                  {openTasks.slice(0, 6).map((t: any) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2">
                      <p className="min-w-0 truncate text-[12px] font-medium">{t.title}</p>
                      <span className="shrink-0 text-[10.5px] text-muted-foreground">{t.project?.name ?? t.status}</span>
                    </div>
                  ))}
                </div>
              </CardShell>

              {/* Documents */}
              {docs.length > 0 && (
                <CardShell>
                  <SectionTitle title={`Documents (${docs.length})`} icon={<FileText className="size-3.5" />} />
                  <div className="flex flex-col gap-1.5">
                    {docs.map((d: any, i: number) => (
                      <a key={d.id ?? i} href={d.url} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2 text-[12px] font-medium hover:text-primary">
                        {d.name ?? `Document ${i + 1}`}
                        <span className="text-[10.5px] text-muted-foreground">{d.type ?? ""}</span>
                      </a>
                    ))}
                  </div>
                </CardShell>
              )}

              {/* Performance */}
              {(reviews.length > 0 || (detail.utilizationLogs ?? []).length > 0) && (
                <CardShell>
                  <SectionTitle title="Performance" icon={<Target className="size-3.5" />} />
                  {reviews.length > 0 && (
                    <p className="text-[12px] text-muted-foreground">Latest review: <span className="font-semibold text-foreground">{reviews[0].overallScore ?? reviews[0].status ?? "—"}</span> · {formatDate(reviews[0].createdAt)}</p>
                  )}
                  {(detail.utilizationLogs ?? []).length > 0 && (
                    <p className="mt-1 text-[12px] text-muted-foreground">Utilization (latest week): <span className="font-semibold tabular-nums text-foreground">{Math.round(Number(detail.utilizationLogs[0].utilizationRate ?? 0) * 100)}%</span></p>
                  )}
                </CardShell>
              )}
            </div>
          </div>
        </div>
      )}
      <EmployeeProfileModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        detail={detail}
        loading={loading}
        initialEditing
        onSave={async (payload) => {
          await apiFetch(`/people/employees/${params.id}`, { method: "PATCH", body: JSON.stringify(payload) });
          notify("Employee updated");
          setEditOpen(false);
          reload();
        }}
        onDelete={async () => {}}
      />
    </div>
  );
}
