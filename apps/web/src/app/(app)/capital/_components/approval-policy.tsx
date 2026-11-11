"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { CardShell, SectionTitle, SkeletonBlock, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Field, Input, Modal, Select } from "@/components/ui";

type Rule = { role: string; limit: number };
type Policy = { enabled: boolean; rules: Rule[]; requireDifferentApprover: boolean; availableRoles?: string[] };

// Fallback only — the API returns the real Role table names, so the matrix can
// never offer "Manager"/"Admin"/"CONTROL" again (none of them is a real role).
const ROLE_OPTIONS = ["Owner", "Finance", "HR/Admin", "Project Manager", "Sales/BD", "Team Member"];
const money = (n: number) => `৳${Number(n).toLocaleString("en-US")}`;

/**
 * Expense approval matrix editor.
 *
 * The limits are real: the server refuses an APPROVED transition above the
 * actor's ceiling (see ApprovalPolicyService), so this modal is the only way to
 * change who can wave what through. `0` is displayed as "unlimited" because
 * that is how the backend reads it.
 */
export function ApprovalPolicyModal({ open, onClose, notify }: { open: boolean; onClose: () => void; notify: (m: string) => void }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const p = await apiFetch<Policy>("/capital/approval-policy");
      setPolicy(p);
      setErr(null);
    } catch (e: any) {
      setErr(e.message ?? "Could not load the approval policy");
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const save = async () => {
    if (!policy) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/capital/approval-policy", {
        method: "PATCH",
        body: JSON.stringify({ enabled: policy.enabled, rules: policy.rules, requireDifferentApprover: policy.requireDifferentApprover }),
      });
      notify("Approval policy saved");
      onClose();
    } catch (e: any) {
      setErr(e.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const setRule = (i: number, patch: Partial<Rule>) => {
    if (!policy) return;
    setPolicy({ ...policy, rules: policy.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  };

  return (
    <Modal open={open} onClose={onClose} title="Expense approval matrix" size="lg">
      {!policy ? (
        <div className="flex flex-col gap-2">{[...Array(4)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-xl border border-sky-500/25 bg-sky-500/5 px-3 py-2.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-sky-500" />
            <p className="text-meta leading-relaxed text-muted-foreground">
              A role can approve up to its limit. <b className="text-foreground">0 means unlimited.</b> Above a role&apos;s limit the
              server rejects the approval, so nobody can quietly pass a large expense.
            </p>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5">
            <span>
              <span className="block text-body font-semibold">Enforce limits</span>
              <span className="block text-meta text-muted-foreground">Off = any finance role may approve any amount (old behaviour)</span>
            </span>
            <input
              type="checkbox"
              checked={policy.enabled}
              onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })}
              className="size-4 cursor-pointer accent-violet-600"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5">
            <span>
              <span className="block text-body font-semibold">Require a different approver</span>
              <span className="block text-meta text-muted-foreground">The person who submitted an expense cannot approve it</span>
            </span>
            <input
              type="checkbox"
              checked={policy.requireDifferentApprover}
              onChange={(e) => setPolicy({ ...policy, requireDifferentApprover: e.target.checked })}
              className="size-4 cursor-pointer accent-violet-600"
            />
          </label>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">
              <Lock className="size-3.5" /> Role limits
            </p>
            <div className="flex flex-col gap-2">
              {policy.rules.length === 0 && (
                <p className="text-meta text-muted-foreground">No roles configured — nobody can approve while limits are enforced.</p>
              )}
              {policy.rules.map((r, i) => (
                <div key={`${r.role}-${i}`} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-36 flex-1">
                  <Field label="Role">
                    <Select value={r.role} onChange={(e) => setRule(i, { role: e.target.value })}>
                      {[...new Set([...(policy.availableRoles?.length ? policy.availableRoles : ROLE_OPTIONS), r.role])].filter(Boolean).map((role) => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </Select>
                  </Field>
                  </div>
                  <div className="w-40">
                  <Field label="Up to (BDT)" hint="0 = unlimited">
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      value={r.limit}
                      onChange={(e) => setRule(i, { limit: Number(e.target.value) || 0 })}
                    />
                  </Field>
                  </div>
                  <span className={cn("mb-2 text-meta font-semibold", r.limit === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                    {r.limit === 0 ? "unlimited" : money(r.limit)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPolicy({ ...policy, rules: policy.rules.filter((_, j) => j !== i) })}
                    aria-label={`Remove ${r.role}`}
                    className="mb-1.5 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const options = policy.availableRoles?.length ? policy.availableRoles : ROLE_OPTIONS;
                  const used = new Set(policy.rules.map((r) => r.role.toLowerCase()));
                  const free = options.find((role) => !used.has(role.toLowerCase())) ?? options[0] ?? "Finance";
                  setPolicy({ ...policy, rules: [...policy.rules, { role: free, limit: 10000 }] });
                }}
                className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-meta font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <Plus className="size-3.5" /> Add role
              </button>
            </div>
          </div>

          {err && <p className="text-body font-medium text-rose-500">{err}</p>}
          <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save policy"}</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Small read-only summary used on the Expenses tab header. */
export function ApprovalPolicySummary({ policy }: { policy: Policy | null }) {
  if (!policy) return null;
  if (!policy.enabled) {
    return (
      <CardShell className="mb-1">
        <div className="flex items-center gap-2 px-1 py-1 text-meta text-muted-foreground">
          <ShieldCheck className="size-3.5 text-amber-500" />
          Approval limits are <b className="text-foreground">off</b> — any finance role can approve any amount.
        </div>
      </CardShell>
    );
  }
  return (
    <CardShell className="mb-1">
      <SectionTitle title="Approval matrix" subtitle="Who can approve how much" icon={<ShieldCheck className="size-4" />} />
      <div className="flex flex-wrap gap-1.5">
        {policy.rules.map((r) => (
          <span key={r.role} className="rounded-full border border-border bg-card px-2.5 py-1 text-meta font-semibold">
            {r.role} <span className="text-muted-foreground">{r.limit === 0 ? "unlimited" : `≤ ${money(r.limit)}`}</span>
          </span>
        ))}
        {policy.requireDifferentApprover && (
          <span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-meta font-semibold text-sky-600 dark:text-sky-300">
            no self-approval
          </span>
        )}
      </div>
    </CardShell>
  );
}
