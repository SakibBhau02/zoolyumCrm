"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, Bell, Building2, Crown, Download, FileText, Globe2,
  HeartPulse, Kanban, KeyRound, ListChecks, Mail, Palette, Pencil, Plug,
  Plus, Power, RefreshCw, Search, ShieldCheck, Tags, Trash2, UserPlus,
  Wallet, X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchFormData, API_URL } from "@/lib/api";
import { useBranding } from "@/lib/branding-context";
import { formatDate, timeAgo } from "@/lib/format";
import {
  Avatar, CardShell, EmptyState, FadeIn, PageHeader, SectionTitle,
  SkeletonBlock, StatusBadge, cn,
} from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { Field, FormActions, Input, Modal, Segmented, Select, Textarea } from "@/components/ui";

type Tab = "settings" | "users" | "roles" | "integrations" | "data";

const SECTIONS = [
  { id: "companyProfile", label: "Company Profile", icon: Building2 },
  { id: "regional", label: "Regional", icon: Globe2 },
  { id: "invoiceTemplate", label: "Invoicing", icon: FileText },
  { id: "financeConfig", label: "Finance", icon: Wallet },
  { id: "pipelineStages", label: "Pipeline Stages", icon: Kanban },
  { id: "leadCategories", label: "Lead Categories", icon: Tags },
  { id: "clientTiers", label: "Client Tiers", icon: Crown },
  { id: "healthScoreWeights", label: "Health Score", icon: HeartPulse },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "emailTemplates", label: "Email Templates", icon: Mail },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "branding", label: "Branding", icon: Palette },
];

const TIMEZONES = [
  { value: "utc+6", label: "UTC+6 (Dhaka)" },
  { value: "utc+5:30", label: "UTC+5:30 (India)" },
  { value: "utc+4", label: "UTC+4 (Dubai)" },
  { value: "utc+8", label: "UTC+8 (Singapore)" },
  { value: "utc+10", label: "UTC+10 (Sydney)" },
  { value: "utc+0", label: "UTC+0 (London)" },
  { value: "utc+1", label: "UTC+1 (CET)" },
  { value: "utc-5", label: "UTC-5 (New York)" },
  { value: "utc-6", label: "UTC-6 (Chicago)" },
];

const CURRENCIES = [
  { value: "bdt", label: "BDT (৳)" },
  { value: "usd", label: "USD ($)" },
  { value: "eur", label: "EUR (€)" },
];

const DATE_FORMATS = [
  { value: "dmy", label: "DD/MM/YYYY" },
  { value: "mdy", label: "MM/DD/YYYY" },
  { value: "ymd", label: "YYYY-MM-DD" },
];

const FISCAL_STARTS = [
  { value: "jan", label: "January" },
  { value: "apr", label: "April" },
  { value: "jul", label: "July" },
  { value: "oct", label: "October" },
];

const PAYMENT_TERMS = [
  { value: "dueOnReceipt", label: "Due on receipt" },
  { value: "net7", label: "Net 7" },
  { value: "net15", label: "Net 15" },
  { value: "net30", label: "Net 30" },
  { value: "net45", label: "Net 45" },
  { value: "net60", label: "Net 60" },
];

const LOGO_POSITIONS = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "center", label: "Center" },
  { value: "top", label: "Top" },
];

const MODULES = ["CLIENTS", "LEADS", "PROJECTS", "TASKS", "FINANCE", "PEOPLE", "INSIGHTS", "CONTROL"];

const label = (v: string) => v.replace(/_/g, " ").toLowerCase();
const uid = () => Math.random().toString(36).slice(2, 10);
const PIPE_COLORS = ["#64748b", "#3b82f6", "#06b6d4", "#8b5cf6", "#f59e0b", "#22c55e", "#ef4444"];

function useRefetch<T = any>(path: string, refresh: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<T>(path)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [path, refresh]);
  return { data, error, loading };
}

function useDraft(source: any) {
  const [draft, setDraft] = useState<any>({});
  useEffect(() => {
    if (source) setDraft({ ...source });
  }, [source]);
  return [draft, setDraft] as const;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        checked ? "bg-brand-gradient" : "bg-muted ring-1 ring-border"
      )}
    >
      <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="color"
      value={value || "#7C3AED"}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-11 shrink-0 cursor-pointer rounded-lg border border-border bg-card p-0.5"
    />
  );
}

function DelBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

function SectionShell({
  title,
  subtitle,
  busy,
  onSave,
  onCancel,
  children,
}: {
  title: string;
  subtitle?: string;
  busy?: boolean;
  onSave: (e: React.FormEvent) => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <CardShell>
      <form onSubmit={onSave}>
        <SectionTitle title={title} subtitle={subtitle} />
        <div className="flex flex-col gap-3">{children}</div>
        <FormActions busy={busy} cancel={onCancel} submitLabel="Save settings" />
      </form>
    </CardShell>
  );
}

function RowListSection({
  title,
  subtitle,
  busy,
  rows,
  addLabel,
  renderRow,
  onAdd,
  onSave,
  onCancel,
  extra,
}: {
  title: string;
  subtitle?: string;
  busy?: boolean;
  rows: any[];
  addLabel: string;
  renderRow: (row: any, i: number) => React.ReactNode;
  onAdd: () => void;
  onSave: (e: React.FormEvent) => void;
  onCancel: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <SectionShell title={title} subtitle={subtitle} busy={busy} onSave={onSave} onCancel={onCancel}>
      <div className="flex flex-col gap-2">{rows.map(renderRow)}</div>
      {extra}
      <Btn type="button" variant="outline" className="!w-fit" onClick={onAdd}>
        <Plus className="size-3.5" /> {addLabel}
      </Btn>
    </SectionShell>
  );
}

function CompanyProfileSection({ settings, busy, onSave }: any) {
  const [draft, setDraft] = useDraft(settings?.companyProfile);
  if (!settings) return <SkeletonBlock className="h-64" />;
  const set = (k: string, v: any) => setDraft({ ...draft, [k]: v });
  return (
    <SectionShell
      title="Company Profile"
      subtitle="Identity used across invoices, emails and the client portal"
      busy={busy}
      onSave={(e) => {
        e.preventDefault();
        onSave({ companyProfile: draft });
      }}
      onCancel={() => setDraft({ ...settings.companyProfile })}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Company name"><Input value={draft.companyName ?? ""} onChange={(e) => set("companyName", e.target.value)} /></Field>
        <Field label="Company logo URL" hint="Path or hosted URL of the logo"><Input value={draft.companyLogo ?? ""} onChange={(e) => set("companyLogo", e.target.value)} placeholder="/brand/zoolyum-logo.svg" /></Field>
        <Field label="Website"><Input value={draft.website ?? ""} onChange={(e) => set("website", e.target.value)} placeholder="zoolyum.com" /></Field>
        <Field label="Business email"><Input type="email" value={draft.businessEmail ?? ""} onChange={(e) => set("businessEmail", e.target.value)} placeholder="support@company.com" /></Field>
        <Field label="Phone"><Input value={draft.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="+880 1712-000000" /></Field>
        <Field label="Tax ID"><Input value={draft.taxId ?? ""} onChange={(e) => set("taxId", e.target.value)} /></Field>
      </div>
      <Field label="Address"><Textarea value={draft.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field>
    </SectionShell>
  );
}

function RegionalSection({ settings, busy, onSave }: any) {
  const [draft, setDraft] = useDraft(settings?.regional);
  if (!settings) return <SkeletonBlock className="h-64" />;
  const set = (k: string, v: any) => setDraft({ ...draft, [k]: v });
  return (
    <SectionShell
      title="Regional"
      subtitle="Timezone, currency and date conventions for the workspace"
      busy={busy}
      onSave={(e) => {
        e.preventDefault();
        onSave({ regional: draft });
      }}
      onCancel={() => setDraft({ ...settings.regional })}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Timezone">
          <Select value={draft.timezone ?? "utc+6"} onChange={(e) => set("timezone", e.target.value)}>
            {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Currency">
          <Select value={draft.currency ?? "bdt"} onChange={(e) => set("currency", e.target.value)}>
            {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Date format">
          <Select value={draft.dateFormat ?? "dmy"} onChange={(e) => set("dateFormat", e.target.value)}>
            {DATE_FORMATS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </Select>
        </Field>
        <Field label="Fiscal year starts">
          <Select value={draft.fiscalYearStart ?? "jan"} onChange={(e) => set("fiscalYearStart", e.target.value)}>
            {FISCAL_STARTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </Select>
        </Field>
      </div>
    </SectionShell>
  );
}

function InvoicingSection({ settings, busy, onSave }: any) {
  const [draft, setDraft] = useDraft(settings?.invoiceTemplate);
  if (!settings) return <SkeletonBlock className="h-64" />;
  const set = (k: string, v: any) => setDraft({ ...draft, [k]: v });
  return (
    <SectionShell
      title="Invoicing"
      subtitle="Numbering, layout and default text on every invoice"
      busy={busy}
      onSave={(e) => {
        e.preventDefault();
        onSave({ invoiceTemplate: draft });
      }}
      onCancel={() => setDraft({ ...settings.invoiceTemplate })}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Invoice prefix"><Input value={draft.invoicePrefix ?? ""} onChange={(e) => set("invoicePrefix", e.target.value)} placeholder="ZLM" /></Field>
        <Field label="Starting number"><Input type="number" value={draft.invoiceStartNumber ?? 1001} onChange={(e) => set("invoiceStartNumber", Number(e.target.value))} /></Field>
        <Field label="Logo position">
          <Select value={draft.logoPosition ?? "left"} onChange={(e) => set("logoPosition", e.target.value)}>
            {LOGO_POSITIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Field label="Accent color"><ColorInput value={draft.accentColor ?? "#7C3AED"} onChange={(v) => set("accentColor", v)} /></Field>
        <p className="pt-6 text-[12px] text-muted-foreground">Accent used for headings and totals on generated PDFs</p>
      </div>
      <Field label="Payment terms text"><Textarea value={draft.paymentTermsText ?? ""} onChange={(e) => set("paymentTermsText", e.target.value)} /></Field>
      <Field label="Default notes"><Textarea value={draft.defaultNotes ?? ""} onChange={(e) => set("defaultNotes", e.target.value)} /></Field>
    </SectionShell>
  );
}

function FinanceSection({ settings, busy, onSave }: any) {
  const [draft, setDraft] = useDraft(settings?.financeConfig);
  if (!settings) return <SkeletonBlock className="h-64" />;
  const patch = (p: any) => setDraft({ ...draft, ...p });
  const patchMethod = (i: number, p: any) => patch({ paymentMethods: draft.paymentMethods.map((m: any, j: number) => (j === i ? { ...m, ...p } : m)) });
  const patchTax = (i: number, p: any) => patch({ taxConfigs: draft.taxConfigs.map((t: any, j: number) => (j === i ? { ...t, ...p } : t)) });
  return (
    <SectionShell
      title="Finance"
      subtitle="Payment terms, late fees, accepted methods and tax rates"
      busy={busy}
      onSave={(e) => {
        e.preventDefault();
        onSave({ financeConfig: draft });
      }}
      onCancel={() => setDraft({ ...settings.financeConfig })}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Default payment terms">
          <Select value={draft.defaultPaymentTerms ?? "net30"} onChange={(e) => patch({ defaultPaymentTerms: e.target.value })}>
            {PAYMENT_TERMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Late payment fee (%)"><Input type="number" step="0.5" value={draft.latePaymentFee ?? 0} onChange={(e) => patch({ latePaymentFee: Number(e.target.value) })} /></Field>
      </div>
      <div className="rounded-xl border border-border/60 p-3.5">
        <p className="mb-2.5 text-[11.5px] font-semibold text-muted-foreground">Payment methods</p>
        <div className="flex flex-col gap-2">
          {(draft.paymentMethods ?? []).map((m: any, i: number) => (
            <div key={i} className="flex items-center gap-2.5">
              <Input value={m.name} onChange={(e) => patchMethod(i, { name: e.target.value })} className="flex-1" />
              <Toggle checked={!!m.enabled} onChange={(v) => patchMethod(i, { enabled: v })} />
              <DelBtn onClick={() => patch({ paymentMethods: draft.paymentMethods.filter((_: any, j: number) => j !== i) })} />
            </div>
          ))}
        </div>
        <Btn variant="outline" className="mt-2.5" onClick={() => patch({ paymentMethods: [...draft.paymentMethods, { name: "", enabled: true }] })}>
          <Plus className="size-3.5" /> Add method
        </Btn>
      </div>
      <div className="rounded-xl border border-border/60 p-3.5">
        <p className="mb-2.5 text-[11.5px] font-semibold text-muted-foreground">Tax configurations</p>
        <div className="flex flex-col gap-2">
          {(draft.taxConfigs ?? []).map((t: any, i: number) => (
            <div key={t.id ?? i} className="flex items-center gap-2.5">
              <Input value={t.name} onChange={(e) => patchTax(i, { name: e.target.value })} className="flex-1" />
              <Input type="number" step="0.5" value={t.rate ?? 0} onChange={(e) => patchTax(i, { rate: Number(e.target.value) })} className="!w-24" />
              <div className="flex items-center gap-1.5">
                <Toggle checked={!!t.isDefault} onChange={(v) => patchTax(i, { isDefault: v })} />
                <span className="text-[10.5px] font-medium text-muted-foreground">default</span>
              </div>
              <DelBtn onClick={() => patch({ taxConfigs: draft.taxConfigs.filter((_: any, j: number) => j !== i) })} />
            </div>
          ))}
        </div>
        <Btn variant="outline" className="mt-2.5" onClick={() => patch({ taxConfigs: [...draft.taxConfigs, { id: uid(), name: "", rate: 0, isDefault: false }] })}>
          <Plus className="size-3.5" /> Add tax
        </Btn>
      </div>
    </SectionShell>
  );
}

function PipelineStagesSection({ stages, loading, error, onRefresh, notify }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => setRows(stages ?? []), [stages]);
  const create = async () => {
    setCreating(true);
    try {
      await apiFetch("/control/pipeline-stages", { method: "POST", body: JSON.stringify({ name: "New Stage", slaDays: 5 }) });
      notify("Stage added");
      onRefresh();
    } catch (e: any) {
      notify(e.message ?? "Create failed");
    } finally {
      setCreating(false);
    }
  };
  const saveRow = async (row: any) => {
    setBusyId(row.id);
    try {
      await apiFetch(`/control/pipeline-stages/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: row.name.trim(), slaDays: Number(row.slaDays), order: Number(row.order) }),
      });
      notify("Stage updated");
      onRefresh();
    } catch (e: any) {
      notify(e.message ?? "Update failed");
    } finally {
      setBusyId(null);
    }
  };
  const remove = async (id: string) => {
    try {
      await apiFetch(`/control/pipeline-stages/${id}`, { method: "DELETE" });
      notify("Stage deleted");
      onRefresh();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    }
  };
  const patch = (i: number, p: any) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <CardShell>
      <SectionTitle
        title="Pipeline Stages"
        subtitle="Stages, SLA days and ordering for the sales pipeline"
        action={
          <Btn variant="primary" onClick={create} className={creating ? "opacity-50" : ""}>
            <Plus className="size-3.5" /> Add stage
          </Btn>
        }
      />
      {loading ? (
        <SkeletonBlock className="h-40" />
      ) : error ? (
        <EmptyState title={error} />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={r.id} className="flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2.5">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: PIPE_COLORS[i % PIPE_COLORS.length] }} />
              <Input value={r.name} onChange={(e) => patch(i, { name: e.target.value })} className="flex-1" />
              <Input type="number" value={r.slaDays ?? 5} onChange={(e) => patch(i, { slaDays: Number(e.target.value) })} className="!w-20" placeholder="SLA" />
              <Input type="number" value={r.order ?? 0} onChange={(e) => patch(i, { order: Number(e.target.value) })} className="!w-16" placeholder="Order" />
              <Btn onClick={() => saveRow(r)} className={busyId === r.id ? "opacity-50" : ""}>Save</Btn>
              <DelBtn onClick={() => remove(r.id)} />
            </div>
          ))}
          {rows.length === 0 && <EmptyState title="No pipeline stages" hint="Add a stage to get started" />}
        </div>
      )}
    </CardShell>
  );
}

function LeadCategoriesSection({ settings, busy, onSave }: any) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => setRows(settings?.leadCategories?.map((c: any) => ({ ...c })) ?? []), [settings]);
  if (!settings) return <SkeletonBlock className="h-64" />;
  const patch = (i: number, p: any) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <RowListSection
      title="Lead Categories"
      subtitle="Categories used to bucket incoming leads"
      busy={busy}
      rows={rows}
      addLabel="Add category"
      onAdd={() => setRows([...rows, { id: uid(), name: "", color: "#7C3AED" }])}
      onSave={(e) => {
        e.preventDefault();
        onSave({ leadCategories: rows });
      }}
      onCancel={() => setRows(settings.leadCategories?.map((c: any) => ({ ...c })) ?? [])}
      renderRow={(r: any, i: number) => (
        <div key={r.id ?? i} className="flex items-center gap-2.5">
          <ColorInput value={r.color ?? "#7C3AED"} onChange={(v) => patch(i, { color: v })} />
          <Input value={r.name} onChange={(e) => patch(i, { name: e.target.value })} className="flex-1" />
          <DelBtn onClick={() => setRows(rows.filter((_: any, j: number) => j !== i))} />
        </div>
      )}
    />
  );
}

function ClientTiersSection({ settings, busy, onSave }: any) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => setRows(settings?.clientTiers?.map((t: any) => ({ ...t })) ?? []), [settings]);
  if (!settings) return <SkeletonBlock className="h-64" />;
  const patch = (i: number, p: any) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <RowListSection
      title="Client Tiers"
      subtitle="Tier thresholds based on lifetime value"
      busy={busy}
      rows={rows}
      addLabel="Add tier"
      onAdd={() => setRows([...rows, { name: "", minValue: 0, color: "#7C3AED" }])}
      onSave={(e) => {
        e.preventDefault();
        onSave({ clientTiers: rows });
      }}
      onCancel={() => setRows(settings.clientTiers?.map((t: any) => ({ ...t })) ?? [])}
      renderRow={(r: any, i: number) => (
        <div key={i} className="flex items-center gap-2.5">
          <ColorInput value={r.color ?? "#7C3AED"} onChange={(v) => patch(i, { color: v })} />
          <Input value={r.name} onChange={(e) => patch(i, { name: e.target.value })} className="flex-1" placeholder="Tier name" />
          <Input type="number" value={r.minValue ?? 0} onChange={(e) => patch(i, { minValue: Number(e.target.value) })} className="!w-32" placeholder="Min value" />
          <DelBtn onClick={() => setRows(rows.filter((_: any, j: number) => j !== i))} />
        </div>
      )}
    />
  );
}

function HealthScoreSection({ settings, busy, onSave }: any) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => setRows(settings?.healthScoreWeights?.map((w: any) => ({ ...w })) ?? []), [settings]);
  if (!settings) return <SkeletonBlock className="h-64" />;
  const patch = (i: number, p: any) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const total = rows.reduce((s, r) => s + Number(r.weight ?? 0), 0);
  return (
    <RowListSection
      title="Health Score"
      subtitle="Weighting factors that drive client health scores"
      busy={busy}
      rows={rows}
      addLabel="Add factor"
      onAdd={() => setRows([...rows, { factor: "", weight: 0 }])}
      onSave={(e) => {
        e.preventDefault();
        onSave({ healthScoreWeights: rows });
      }}
      onCancel={() => setRows(settings.healthScoreWeights?.map((w: any) => ({ ...w })) ?? [])}
      renderRow={(r: any, i: number) => (
        <div key={i} className="flex items-center gap-2.5">
          <Input value={r.factor} onChange={(e) => patch(i, { factor: e.target.value })} className="flex-1" placeholder="Factor" />
          <Input type="number" value={r.weight ?? 0} onChange={(e) => patch(i, { weight: Number(e.target.value) })} className="!w-24" placeholder="Weight" />
          <DelBtn onClick={() => setRows(rows.filter((_: any, j: number) => j !== i))} />
        </div>
      )}
      extra={
        <p className={cn("text-[11.5px] font-semibold", total === 100 ? "text-emerald-500" : "text-amber-500")}>
          Total weight: {total}% {total !== 100 && "— should add up to 100"}
        </p>
      }
    />
  );
}

function TasksSection({ settings, busy, onSave }: any) {
  const [statuses, setStatuses] = useState<string[]>([]);
  const [automation, setAutomation] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  useEffect(() => {
    if (settings) {
      setStatuses([...(settings.taskStatuses ?? [])]);
      setAutomation(!!settings.taskAutomation);
    }
  }, [settings]);
  if (!settings) return <SkeletonBlock className="h-64" />;
  const add = () => {
    const s = newStatus.trim();
    if (!s) return;
    setStatuses([...statuses, s]);
    setNewStatus("");
  };
  return (
    <SectionShell
      title="Tasks"
      subtitle="Custom statuses and automation behavior for task boards"
      busy={busy}
      onSave={(e) => {
        e.preventDefault();
        onSave({ taskStatuses: statuses, taskAutomation: automation });
      }}
      onCancel={() => setStatuses([...(settings.taskStatuses ?? [])])}
    >
      <div className="flex flex-wrap items-center gap-2">
        {statuses.map((s, i) => (
          <span key={`${s}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1.5 text-[12px] font-medium">
            {s}
            <button type="button" onClick={() => setStatuses(statuses.filter((_, j) => j !== i))} className="text-muted-foreground transition-colors hover:text-rose-400">
              <X className="size-3" />
            </button>
          </span>
        ))}
        {statuses.length === 0 && <p className="text-[12px] text-muted-foreground">No custom statuses</p>}
      </div>
      <div className="flex items-center gap-2">
        <Input value={newStatus} onChange={(e) => setNewStatus(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} placeholder="New status…" className="max-w-xs" />
        <Btn type="button" variant="outline" onClick={add}><Plus className="size-3.5" /> Add</Btn>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-border/60 px-3.5 py-3">
        <div>
          <p className="text-[12.5px] font-semibold">Auto-assign from templates</p>
          <p className="text-[11px] text-muted-foreground">Automatically generate tasks when a deal enters the pipeline</p>
        </div>
        <Toggle checked={automation} onChange={setAutomation} />
      </div>
    </SectionShell>
  );
}

function NotificationsSection({ settings, busy, onSave }: any) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => setRows(settings?.notifications?.map((n: any) => ({ ...n })) ?? []), [settings]);
  if (!settings) return <SkeletonBlock className="h-64" />;
  const patch = (i: number, p: any) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const chans = [
    { key: "email", label: "email" },
    { key: "push", label: "push" },
    { key: "sms", label: "sms" },
  ];
  return (
    <RowListSection
      title="Notifications"
      subtitle="Which events fire on which channels"
      busy={busy}
      rows={rows}
      addLabel="Add notification"
      onAdd={() => setRows([...rows, { id: uid(), title: "", email: true, push: true, sms: false }])}
      onSave={(e) => {
        e.preventDefault();
        onSave({ notifications: rows });
      }}
      onCancel={() => setRows(settings.notifications?.map((n: any) => ({ ...n })) ?? [])}
      renderRow={(r: any, i: number) => (
        <div key={r.id ?? i} className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5">
          <Input value={r.title} onChange={(e) => patch(i, { title: e.target.value })} className="flex-1" />
          {chans.map((c) => (
            <div key={c.key} className="flex items-center gap-1.5">
              <Toggle checked={!!r[c.key]} onChange={(v) => patch(i, { [c.key]: v })} />
              <span className="text-[10.5px] font-medium text-muted-foreground">{c.label}</span>
            </div>
          ))}
          <DelBtn onClick={() => setRows(rows.filter((_: any, j: number) => j !== i))} />
        </div>
      )}
    />
  );
}

function EmailTemplatesSection({ settings, busy, onSave, notify }: any) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<any>({ subject: "", body: "" });
  useEffect(() => setTemplates(settings?.emailTemplates?.map((t: any) => ({ ...t })) ?? []), [settings]);
  if (!settings) return <SkeletonBlock className="h-64" />;
  const persist = (list: any[]) => {
    setTemplates(list);
    onSave({ emailTemplates: list });
  };
  const openEdit = (i: number) => {
    setEditIdx(i);
    setDraft({ subject: templates[i].subject, body: templates[i].body });
  };
  const saveDraft = (e: React.FormEvent) => {
    e.preventDefault();
    if (editIdx == null) return;
    persist(templates.map((t, j) => (j === editIdx ? { ...t, ...draft } : t)));
    setEditIdx(null);
    notify("Template saved");
  };
  return (
    <CardShell>
      <SectionTitle
        title="Email Templates"
        subtitle="Reusable mailers with placeholder variables like {clientName}"
        action={
          <Btn variant="primary" onClick={() => {
            setTemplates([...templates, { id: uid(), name: "New Template", subject: "", body: "" }]);
            setEditIdx(templates.length);
            setDraft({ subject: "", body: "" });
          }}>
            <Plus className="size-3.5" /> New template
          </Btn>
        }
      />
      <div className="flex flex-col gap-2">
        {templates.map((t, i) => (
          <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border/60 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold">{t.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{t.subject || "No subject"}</p>
            </div>
            <Btn variant="ghost" onClick={() => openEdit(i)}><Pencil className="size-3.5" /> Edit</Btn>
            <DelBtn onClick={() => persist(templates.filter((_: any, j: number) => j !== i))} />
          </div>
        ))}
        {templates.length === 0 && <EmptyState title="No templates" hint="Create one to start sending" />}
      </div>
      <Modal open={editIdx != null} onClose={() => setEditIdx(null)} title="Edit email template" size="lg">
        <form onSubmit={saveDraft} className="flex flex-col gap-4">
          <Field label="Template name">
            <Input value={templates[editIdx!]?.name ?? ""} onChange={(e) => setTemplates(templates.map((t, j) => (j === editIdx ? { ...t, name: e.target.value } : t)))} />
          </Field>
          <Field label="Subject">
            <Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder="Invoice {invoiceNumber} from {companyName}" />
          </Field>
          <Field label="Body">
            <Textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="min-h-40" />
          </Field>
          <FormActions busy={busy} cancel={() => setEditIdx(null)} submitLabel="Save template" />
        </form>
      </Modal>
    </CardShell>
  );
}

function resolveBrandingImgUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/api/")) return `${API_URL}${url.slice(4)}`;
  return url;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function lightenHex(hex: string, percent: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  let r = (n >> 16) & 0xff;
  let g = (n >> 8) & 0xff;
  let b = n & 0xff;
  r = Math.round(r + (255 - r) * percent);
  g = Math.round(g + (255 - g) * percent);
  b = Math.round(b + (255 - b) * percent);
  return rgbToHex(r, g, b);
}

function suggestColorsFromImage(
  src: string,
  onSuggest: (primary: string, secondary: string) => void
) {
  const img = new window.Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const counts = new Map<string, number>();
      for (let i = 0; i < data.length; i += 40) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 128) continue;
        if (r > 250 && g > 250 && b > 250) continue;
        if (r < 8 && g < 8 && b < 8) continue;
        // quantize to reduce noise
        const qr = Math.round(r / 8) * 8;
        const qg = Math.round(g / 8) * 8;
        const qb = Math.round(b / 8) * 8;
        const key = `${qr},${qg},${qb}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let best: string | null = null;
      let bestCount = 0;
      for (const [k, c] of counts) {
        if (c > bestCount) {
          bestCount = c;
          best = k;
        }
      }
      if (!best) return;
      const [r, g, b] = best.split(",").map(Number);
      const primary = rgbToHex(r, g, b);
      const secondary = lightenHex(primary, 0.22);
      onSuggest(primary, secondary);
    } catch {
      // ignore canvas errors (e.g., tainted)
    }
  };
}

function BrandingSection({ notify }: { notify: (msg: string) => void }) {
  const { branding, refresh } = useBranding();
  const queryClient = useQueryClient();
  const [appName, setAppName] = useState("");
  const [logoDarkUrl, setLogoDarkUrl] = useState<string>("");
  const [logoLightUrl, setLogoLightUrl] = useState<string>("");
  const [primaryColor, setPrimaryColor] = useState("#7C3AED");
  const [secondaryColor, setSecondaryColor] = useState("#38BDF8");
  const [busy, setBusy] = useState(false);
  const [uploadingDark, setUploadingDark] = useState(false);
  const [uploadingLight, setUploadingLight] = useState(false);
  const [dragDark, setDragDark] = useState(false);
  const [dragLight, setDragLight] = useState(false);
  const darkInputRef = useRef<HTMLInputElement | null>(null);
  const lightInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!branding) return;
    setAppName(branding.appName ?? "");
    setLogoDarkUrl(branding.logoDarkUrl ?? "");
    setLogoLightUrl(branding.logoLightUrl ?? "");
    if (branding.primaryColor) setPrimaryColor(branding.primaryColor);
    if (branding.secondaryColor) setSecondaryColor(branding.secondaryColor);
  }, [branding]);

  const handleFile = async (file: File, variant: "dark" | "light") => {
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    const isImage = file.type.startsWith("image/");
    if (!isImage && !allowed.includes(file.type)) {
      notify("Only image files are allowed");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      notify("File too large — 5MB limit");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    const setUploading = variant === "dark" ? setUploadingDark : setUploadingLight;
    setUploading(true);
    try {
      const res = await apiFetchFormData<{ url: string }>("/control/branding/upload", fd);
      const url = res.url;
      if (variant === "dark") setLogoDarkUrl(url);
      else setLogoLightUrl(url);
      // preview via blob for canvas extraction
      const blobUrl = URL.createObjectURL(file);
      suggestColorsFromImage(blobUrl, (primary, secondary) => {
        setPrimaryColor(primary);
        setSecondaryColor(secondary);
        URL.revokeObjectURL(blobUrl);
      });
      // fallback revoke after 5s if onload never fires
      setTimeout(() => URL.revokeObjectURL(blobUrl), 6000);
      notify(variant === "dark" ? "Dark logo uploaded" : "Light logo uploaded");
    } catch (e: any) {
      notify(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/control/branding", {
        method: "PATCH",
        body: JSON.stringify({
          appName: appName.trim() || null,
          logoDarkUrl: logoDarkUrl || null,
          logoLightUrl: logoLightUrl || null,
          primaryColor,
          secondaryColor,
        }),
      });
      notify("Branding updated");
      await queryClient.invalidateQueries({ queryKey: ["branding"] });
      await refresh();
    } catch (e2: any) {
      notify(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const checkerboard = {
    backgroundImage:
      "linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)",
    backgroundSize: "16px 16px",
    backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
    backgroundColor: "#f8fafc",
  } as const;

  const darkPreview = resolveBrandingImgUrl(logoDarkUrl);
  const lightPreview = resolveBrandingImgUrl(logoLightUrl);

  return (
    <CardShell>
      <form onSubmit={onSave}>
        <SectionTitle title="Branding" subtitle="App name, logos (dark/light) and theme gradient — changes apply everywhere after save" />
        <div className="flex flex-col gap-5">
          <Field label="App name">
            <Input value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="Zoolyum OS" />
          </Field>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Dark Logo */}
            <div className="flex flex-col gap-2">
              <p className="text-[12px] font-semibold">Dark Logo</p>
              <p className="text-[11px] text-muted-foreground">Shown on light backgrounds</p>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragDark(true); }}
                onDragLeave={() => setDragDark(false)}
                onDrop={(e) => { e.preventDefault(); setDragDark(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f, "dark"); }}
                onClick={() => darkInputRef.current?.click()}
                className={cn(
                  "flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-3 transition-colors",
                  dragDark ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                )}
                style={darkPreview ? checkerboard : undefined}
              >
                {darkPreview ? (
                  <img src={darkPreview} alt="Dark Logo preview" className="max-h-20 max-w-full object-contain" />
                ) : (
                  <span className="text-[11.5px] text-muted-foreground">Drop image or click to upload</span>
                )}
                {uploadingDark && <span className="text-[11px] text-muted-foreground">Uploading…</span>}
              </div>
              <input
                ref={darkInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml,image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, "dark"); e.target.value = ""; }}
              />
              <Btn type="button" variant="outline" className="w-fit" onClick={() => darkInputRef.current?.click()}>
                {darkPreview ? "Replace" : "Upload"} Dark Logo
              </Btn>
            </div>

            {/* Light Logo */}
            <div className="flex flex-col gap-2">
              <p className="text-[12px] font-semibold">Light Logo</p>
              <p className="text-[11px] text-muted-foreground">Shown on dark / sidebar backgrounds</p>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragLight(true); }}
                onDragLeave={() => setDragLight(false)}
                onDrop={(e) => { e.preventDefault(); setDragLight(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f, "light"); }}
                onClick={() => lightInputRef.current?.click()}
                className={cn(
                  "flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-3 transition-colors",
                  dragLight ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                  lightPreview ? "bg-slate-900" : undefined
                )}
                style={lightPreview ? { backgroundColor: "#0f172a" } : undefined}
              >
                {lightPreview ? (
                  <img src={lightPreview} alt="Light Logo preview" className="max-h-20 max-w-full object-contain" />
                ) : (
                  <span className="text-[11.5px] text-muted-foreground">Drop image or click to upload</span>
                )}
                {uploadingLight && <span className="text-[11px] text-muted-foreground">Uploading…</span>}
              </div>
              <input
                ref={lightInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml,image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, "light"); e.target.value = ""; }}
              />
              <Btn type="button" variant="outline" className="w-fit" onClick={() => lightInputRef.current?.click()}>
                {lightPreview ? "Replace" : "Upload"} Light Logo
              </Btn>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Primary color">
              <div className="flex items-center gap-2">
                <ColorInput value={primaryColor} onChange={setPrimaryColor} />
                <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="flex-1" />
              </div>
            </Field>
            <Field label="Secondary color">
              <div className="flex items-center gap-2">
                <ColorInput value={secondaryColor} onChange={setSecondaryColor} />
                <Input value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} className="flex-1" />
              </div>
            </Field>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-semibold text-muted-foreground">Gradient preview</span>
            <div
              className="h-12 rounded-xl border border-border/60"
              style={{ background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` }}
            />
          </div>
        </div>
        <FormActions busy={busy} cancel={() => {
          if (branding) {
            setAppName(branding.appName ?? "");
            setLogoDarkUrl(branding.logoDarkUrl ?? "");
            setLogoLightUrl(branding.logoLightUrl ?? "");
            setPrimaryColor(branding.primaryColor ?? "#7C3AED");
            setSecondaryColor(branding.secondaryColor ?? "#38BDF8");
          }
        }} submitLabel="Save branding" />
      </form>
    </CardShell>
  );
}

function AppearanceSection({ settings, busy, onSave }: any) {
  const [draft, setDraft] = useDraft(settings?.appearance);
  if (!settings) return <SkeletonBlock className="h-64" />;
  const set = (k: string, v: any) => setDraft({ ...draft, [k]: v });
  const rows = [
    { key: "compactMode", title: "Compact mode", desc: "Tighter spacing across tables and cards" },
    { key: "animations", title: "Animations", desc: "Motion effects on page transitions and rows" },
    { key: "sidebarCollapsed", title: "Collapsed sidebar", desc: "Start with the navigation sidebar collapsed" },
  ];
  return (
    <SectionShell
      title="Appearance"
      subtitle="Interface behavior preferences for this workspace"
      busy={busy}
      onSave={(e) => {
        e.preventDefault();
        onSave({ appearance: draft });
      }}
      onCancel={() => setDraft({ ...settings.appearance })}
    >
      {rows.map((r) => (
        <div key={r.key} className="flex items-center justify-between rounded-xl border border-border/60 px-3.5 py-3">
          <div>
            <p className="text-[12.5px] font-semibold">{r.title}</p>
            <p className="text-[11px] text-muted-foreground">{r.desc}</p>
          </div>
          <Toggle checked={!!draft[r.key]} onChange={(v) => set(r.key, v)} />
        </div>
      ))}
    </SectionShell>
  );
}

function SettingsTab({ settings, settingsLoading, settingsError, saving, onSave, onRetry, stages, stagesLoading, stagesError, onStagesRefresh, notify }: any) {
  const getInitialSection = () => {
    if (typeof window === "undefined") return "companyProfile";
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get("section");
    if (q && SECTIONS.some((s) => s.id === q)) return q;
    return "companyProfile";
  };
  const [section, setSection] = useState(getInitialSection);
  useEffect(() => {
    const q = getInitialSection();
    if (q !== section) setSection(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const body = (
    <>
      {active.id === "companyProfile" && <CompanyProfileSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "regional" && <RegionalSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "invoiceTemplate" && <InvoicingSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "financeConfig" && <FinanceSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "pipelineStages" && (
        <PipelineStagesSection stages={stages} loading={stagesLoading} error={stagesError} onRefresh={onStagesRefresh} notify={notify} />
      )}
      {active.id === "leadCategories" && <LeadCategoriesSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "clientTiers" && <ClientTiersSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "healthScoreWeights" && <HealthScoreSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "tasks" && <TasksSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "notifications" && <NotificationsSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "emailTemplates" && <EmailTemplatesSection settings={settings} busy={!!saving} onSave={onSave} notify={notify} />}
      {active.id === "appearance" && <AppearanceSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "branding" && <BrandingSection notify={notify} />}
    </>
  );
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <CardShell className="h-fit p-2.5">
        <div className="flex flex-col gap-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12.5px] font-semibold transition-all",
                section === s.id ? "bg-brand-gradient text-white shadow-md shadow-violet-500/25" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <s.icon className="size-4 shrink-0" />
              {s.label}
            </button>
          ))}
        </div>
      </CardShell>
      <div>
        {settingsLoading && !settings ? (
          <SkeletonBlock className="h-56" />
        ) : settingsError && !settings ? (
          <CardShell>
            <EmptyState title={settingsError} hint="Could not load workspace settings" />
            <div className="mt-4 flex justify-center">
              <Btn variant="outline" onClick={onRetry}><RefreshCw className="size-3.5" /> Retry</Btn>
            </div>
          </CardShell>
        ) : (
          <FadeIn key={section}>{body}</FadeIn>
        )}
      </div>
    </div>
  );
}

function UserFormModal({ open, onClose, roles, initial, onSaved }: any) {
  const [f, setF] = useState({ name: "", email: "", password: "", roleId: "", isActive: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const editing = !!initial;
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(
      initial
        ? { name: initial.name, email: initial.email, password: "", roleId: initial.roleId ?? "", isActive: initial.isActive }
        : { name: "", email: "", password: "", roleId: roles?.[0]?.id ?? "", isActive: true }
    );
  }, [open, initial]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || !f.email.trim()) return setErr("Name and email are required");
    if (!editing && !f.password.trim()) return setErr("Password is required");
    setBusy(true);
    setErr(null);
    try {
      const body: any = { name: f.name.trim(), email: f.email.trim(), roleId: f.roleId };
      if (editing) {
        if (f.password) body.password = f.password;
        body.isActive = f.isActive;
      } else {
        body.password = f.password;
      }
      await apiFetch(editing ? `/control/users/${initial.id}` : "/control/users", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit user" : "Add user"}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Full name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="user@company.com" /></Field>
        <Field label="Role">
          <Select value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}>
            {(roles ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </Field>
        <Field label="Password" hint={editing ? "Leave blank to keep the current password" : "Minimum 8 characters recommended"}>
          <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="••••••••" />
        </Field>
        {editing && (
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium">
            <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="size-3.5 accent-violet-500" />
            Account active
          </label>
        )}
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Create user"} />
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: any) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (user) {
      setPw("");
      setErr(null);
    }
  }, [user]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/control/users/${user.id}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword: pw || undefined }) });
      onDone();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Reset failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!user} onClose={onClose} title={`Reset password — ${user?.name ?? ""}`}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="New password" hint="Leave blank to reset to the default (password123)">
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" autoFocus />
        </Field>
        {err && <p className="text-[12px] font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel="Reset password" />
      </form>
    </Modal>
  );
}

function UsersTab({ users, loading, error, roles, onRefresh, notify }: any) {
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<any | null>(null);
  const [resetUser, setResetUser] = useState<any | null>(null);
  const [deleteUser, setDeleteUser] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const filtered = (users ?? []).filter((u: any) => !q || u.name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase()));
  const changeRole = async (u: any, roleId: string) => {
    try {
      await apiFetch(`/users/${u.id}/role`, { method: "PATCH", body: JSON.stringify({ roleId }) });
      notify(`${u.name} role updated`);
      onRefresh();
    } catch (e: any) {
      notify(e.message ?? "Role update failed");
    }
  };
  const toggleActive = async (u: any) => {
    try {
      await apiFetch(`/users/${u.id}/active`, { method: "PATCH", body: JSON.stringify({ isActive: !u.isActive }) });
      notify(u.isActive ? `${u.name} deactivated` : `${u.name} activated`);
      onRefresh();
    } catch (e: any) {
      notify(e.message ?? "Update failed");
    }
  };
  const removeUser = async () => {
    if (!deleteUser) return;
    setDeleting(true);
    try {
      await apiFetch(`/control/users/${deleteUser.id}`, { method: "DELETE" });
      notify(`${deleteUser.name} deleted`);
      setDeleteUser(null);
      onRefresh();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    } finally {
      setDeleting(false);
    }
  };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search users…"
            className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <Btn variant="primary" onClick={() => setCreateOpen(true)}><UserPlus className="size-3.5" /> Add User</Btn>
      </div>
      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(5)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}
        </div>
      ) : error ? (
        <CardShell>
          <EmptyState title={error} />
          <div className="mt-4 flex justify-center">
            <Btn variant="outline" onClick={onRefresh}><RefreshCw className="size-3.5" /> Retry</Btn>
          </div>
        </CardShell>
      ) : (
        <FadeIn>
          <TableShell footer={<span className="text-[11.5px] text-muted-foreground">{filtered.length} users</span>}>
            <table className="w-full">
              <THead>
                <Th>User</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Joined</Th>
                <Th className="text-right">Actions</Th>
              </THead>
              <tbody>
                {filtered.map((u: any, i: number) => (
                  <Tr key={u.id} index={i}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name} />
                        <div>
                          <p className="font-medium">{u.name}</p>
                          {u.employee?.roleTitle && <p className="text-[10.5px] text-muted-foreground">{u.employee.roleTitle}</p>}
                        </div>
                      </div>
                    </Td>
                    <Td className="text-muted-foreground">{u.email}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={u.roleName.toUpperCase()} />
                        <Select value={u.roleId ?? ""} onChange={(e) => changeRole(u, e.target.value)} className="!w-28 !py-1 !text-[11px]">
                          {(roles ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </Select>
                      </div>
                    </Td>
                    <Td><StatusBadge status={u.isActive ? "ACTIVE" : "INACTIVE"} /></Td>
                    <Td className="text-muted-foreground">{formatDate(u.createdAt ?? null)}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <Btn variant="ghost" onClick={() => setEditUser(u)}><Pencil className="size-3.5" /></Btn>
                        <Btn variant="ghost" onClick={() => setResetUser(u)}><KeyRound className="size-3.5" /></Btn>
                        <Btn variant="ghost" onClick={() => toggleActive(u)}><Power className="size-3.5" /></Btn>
                        <Btn variant="ghost" className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-400" onClick={() => setDeleteUser(u)}><Trash2 className="size-3.5" /></Btn>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </FadeIn>
      )}
      <UserFormModal open={createOpen} onClose={() => setCreateOpen(false)} roles={roles} onSaved={() => { setCreateOpen(false); notify("User created"); onRefresh(); }} />
      <UserFormModal open={!!editUser} onClose={() => setEditUser(null)} roles={roles} initial={editUser} onSaved={() => { setEditUser(null); notify("User updated"); onRefresh(); }} />
      <ResetPasswordModal user={resetUser} onClose={() => setResetUser(null)} onDone={() => notify("Password reset")} />
      <Modal open={!!deleteUser} onClose={() => setDeleteUser(null)} title="Delete user?">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {deleteUser?.name} will permanently lose access to the workspace. Tasks, leads and other records they own stay
          in the system. This cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={() => setDeleteUser(null)} className="rounded-xl border border-border px-4 py-2 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">Cancel</button>
          <button onClick={removeUser} disabled={deleting} className="rounded-xl bg-rose-500 px-4 py-2 text-[12.5px] font-bold text-white shadow-lg shadow-rose-500/30 transition-all hover:scale-[1.02] disabled:opacity-60">
            {deleting ? "Deleting…" : "Delete user"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function RolesTab({ roles, loading, error, onRetry }: any) {
  return (
    <div>
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(3)].map((_, i) => <SkeletonBlock key={i} className="h-64" />)}
        </div>
      ) : error ? (
        <CardShell>
          <EmptyState title={error} />
          <div className="mt-4 flex justify-center">
            <Btn variant="outline" onClick={onRetry}><RefreshCw className="size-3.5" /> Retry</Btn>
          </div>
        </CardShell>
      ) : (
        <FadeIn>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {(roles ?? []).map((r: any) => (
              <CardShell key={r.id} className="flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="flex items-center gap-2 font-heading text-[15px] font-semibold">
                      {r.name}
                      {r.name === "Owner" && <ShieldCheck className="size-4 text-violet-400" />}
                    </p>
                    {r.name === "Owner" && <p className="mt-0.5 text-[11px] font-bold text-violet-400">Full access to every module</p>}
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{r._count?.users ?? 0} users</span>
                </div>
                <p className="text-[12px] leading-relaxed text-muted-foreground">{r.description || "No description"}</p>
                {r.name !== "Owner" && (
                  <div className="overflow-hidden rounded-xl border border-border/60">
                    <table className="w-full">
                      <THead>
                        <Th>Module</Th>
                        <Th>View</Th>
                        <Th>Edit</Th>
                        <Th>Approve</Th>
                      </THead>
                      <tbody>
                        {MODULES.map((m, i) => {
                          const p = r.modulePermissions?.[m];
                          return (
                            <Tr key={m} index={i}>
                              <Td className="text-[12px] font-medium">{label(m)}</Td>
                              {["view", "edit", "approve"].map((k) => (
                                <Td key={k}><input type="checkbox" checked={!!p?.[k]} disabled className="size-3.5 accent-violet-500" /></Td>
                              ))}
                            </Tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardShell>
            ))}
          </div>
        </FadeIn>
      )}
    </div>
  );
}

function IntegrationsTab({ integrations, loading, error, onRefresh, notify }: any) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const setStatus = async (i: any, status: string) => {
    setBusyId(i.id);
    try {
      await apiFetch(`/control/integrations/${i.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      notify(status === "CONNECTED" ? `${i.providerName} connected` : `${i.providerName} disconnected`);
      onRefresh();
    } catch (e: any) {
      notify(e.message ?? "Update failed");
    } finally {
      setBusyId(null);
    }
  };
  return (
    <div>
      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(4)].map((_, i) => <SkeletonBlock key={i} className="h-14" />)}
        </div>
      ) : error ? (
        <CardShell>
          <EmptyState title={error} />
          <div className="mt-4 flex justify-center">
            <Btn variant="outline" onClick={onRefresh}><RefreshCw className="size-3.5" /> Retry</Btn>
          </div>
        </CardShell>
      ) : (
        <FadeIn>
          <div className="flex flex-col gap-2.5">
            {(integrations ?? []).map((i: any) => (
              <div key={i.id} className="card-lift flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-muted">
                    <Plug className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold">{i.providerName}</p>
                    <p className="text-[10.5px] text-muted-foreground">
                      {label(i.type)}
                      {i.connectedBy?.name ? ` · connected by ${i.connectedBy.name}` : ""}
                      {i.connectedAt ? ` · ${timeAgo(i.connectedAt)}` : " · never connected"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <StatusBadge status={i.status} />
                  <Btn variant={i.status === "CONNECTED" ? "outline" : "primary"} onClick={() => setStatus(i, i.status === "CONNECTED" ? "DISCONNECTED" : "CONNECTED")} className={busyId === i.id ? "opacity-50" : ""}>
                    {i.status === "CONNECTED" ? "Disconnect" : "Connect"}
                  </Btn>
                </div>
              </div>
            ))}
            {(integrations ?? []).length === 0 && <EmptyState title="No integrations configured" />}
          </div>
        </FadeIn>
      )}
    </div>
  );
}

function DataTab({ audit, auditLoading, onRefresh, notify }: any) {
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const exportData = async () => {
    setExporting(true);
    try {
      const data = await apiFetch("/control/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zoolyum-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      notify("Export downloaded");
    } catch (e: any) {
      notify(e.message ?? "Export failed");
    } finally {
      setExporting(false);
    }
  };
  const wipe = async () => {
    setDeleting(true);
    try {
      await apiFetch("/control/delete-all", { method: "POST" });
      notify("All business data deleted");
      setDeleteOpen(false);
      setConfirm("");
      onRefresh();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    } finally {
      setDeleting(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardShell>
          <SectionTitle title="Export All Data" subtitle="Download every client, lead, project, task, invoice, employee and expense record as JSON" />
          <p className="mb-4 text-[12px] leading-relaxed text-muted-foreground">
            The export is a full backup of business data, including nested records like contacts, documents, payments
            and attendance. Sensitive fields such as passwords are never included.
          </p>
          <Btn variant="primary" onClick={exportData} className={exporting ? "opacity-50" : ""}>
            <Download className="size-3.5" /> {exporting ? "Exporting…" : "Export All Data"}
          </Btn>
        </CardShell>
        <CardShell className="border-rose-500/30">
          <SectionTitle title="Delete All Data" subtitle="Irreversibly wipe every business record from the workspace" />
          <p className="mb-4 flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-rose-400" />
            Users, roles, settings and integrations are kept. Clients, leads, projects, tasks, invoices, employees,
            expenses and all related records are permanently removed.
          </p>
          <Btn variant="outline" className="!text-rose-400 hover:bg-rose-500/10 hover:text-rose-400" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="size-3.5" /> Delete All Data
          </Btn>
        </CardShell>
      </div>
      <CardShell>
        <SectionTitle title="System Audit Trail" subtitle="The latest 50 security and configuration events" />
        {auditLoading ? (
          <SkeletonBlock className="h-32" />
        ) : (
          <div className="flex flex-col gap-2">
            {(audit ?? []).slice(0, 10).map((a: any) => (
              <div key={a.id} className="flex items-start gap-2.5">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                <p className="text-[12px] leading-snug">
                  <span className="font-medium">{a.action}</span>{" "}
                  <span className="text-muted-foreground">on {label(a.entityType ?? "")} · {timeAgo(a.timestamp)}</span>
                </p>
              </div>
            ))}
            {(audit ?? []).length === 0 && <EmptyState title="No audit events yet" />}
          </div>
        )}
      </CardShell>
      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete all business data?">
        <div className="flex flex-col gap-4">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            This permanently wipes all business records — clients, leads, projects, tasks, invoices, employees,
            expenses, payments and more. This action cannot be undone. Type{" "}
            <span className="font-bold text-rose-400">DELETE</span> to confirm.
          </p>
          <Field label="Confirmation">
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleteOpen(false)} className="rounded-xl border border-border px-4 py-2 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">Cancel</button>
            <button onClick={wipe} disabled={confirm !== "DELETE" || deleting} className="rounded-xl bg-rose-500 px-4 py-2 text-[12.5px] font-bold text-white shadow-lg shadow-rose-500/30 transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50">
              {deleting ? "Deleting…" : "Delete everything"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function ControlPage() {
  const [tab, setTab] = useState<Tab>("settings");
  const [flash, setFlash] = useState<string | null>(null);
  const notify = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }, []);
  const [settings, setSettings] = useState<any>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [usersRefresh, setUsersRefresh] = useState(0);
  const [rolesRefresh, setRolesRefresh] = useState(0);
  const [integRefresh, setIntegRefresh] = useState(0);
  const [auditRefresh, setAuditRefresh] = useState(0);
  const [stagesRefresh, setStagesRefresh] = useState(0);
  const loadSettings = useCallback(() => {
    setSettingsLoading(true);
    setSettingsError(null);
    apiFetch<any>("/control/settings")
      .then((d) => setSettings(d))
      .catch((e) => setSettingsError(e.message))
      .finally(() => setSettingsLoading(false));
  }, []);
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);
  const { data: users, error: usersError, loading: usersLoading } = useRefetch<any[]>("/users", usersRefresh);
  const { data: roles, error: rolesError, loading: rolesLoading } = useRefetch<any[]>("/control/roles", rolesRefresh);
  const { data: integrations, error: integError, loading: integLoading } = useRefetch<any[]>("/control/integrations", integRefresh);
  const { data: audit, loading: auditLoading } = useRefetch<any[]>("/control/audit-logs", auditRefresh);
  const { data: stages, error: stagesError, loading: stagesLoading } = useRefetch<any[]>("/control/pipeline-stages", stagesRefresh);
  const reloadAll = () => {
    setUsersRefresh((r) => r + 1);
    setRolesRefresh((r) => r + 1);
    setIntegRefresh((r) => r + 1);
    setAuditRefresh((r) => r + 1);
    setStagesRefresh((r) => r + 1);
    loadSettings();
  };
  const saveSection = async (partial: any) => {
    setSaving(Object.keys(partial)[0] ?? "settings");
    try {
      await apiFetch("/control/settings", { method: "PATCH", body: JSON.stringify(partial) });
      setSettings((s: any) => ({ ...s, ...partial }));
      notify("Settings saved");
    } catch (e: any) {
      notify(e.message ?? "Save failed");
    } finally {
      setSaving(null);
    }
  };
  return (
    <div>
      {flash && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-[12.5px] font-medium text-white shadow-xl"
        >
          {flash}
        </motion.div>
      )}
      <PageHeader
        title="Control — Admin & Settings"
        subtitle="Workspace settings, users, roles, integrations and data management."
        actions={
          <Segmented
            options={[
              { value: "settings", label: "Settings" },
              { value: "users", label: "Users" },
              { value: "roles", label: "Roles" },
              { value: "integrations", label: "Integrations" },
              { value: "data", label: "Data" },
            ]}
            value={tab}
            onChange={setTab}
          />
        }
      />
      {tab === "settings" && (
        <SettingsTab
          settings={settings}
          settingsLoading={settingsLoading}
          settingsError={settingsError}
          saving={saving}
          onSave={saveSection}
          onRetry={loadSettings}
          stages={stages}
          stagesLoading={stagesLoading}
          stagesError={stagesError}
          onStagesRefresh={() => setStagesRefresh((r) => r + 1)}
          notify={notify}
        />
      )}
      {tab === "users" && <UsersTab users={users ?? []} loading={usersLoading} error={usersError} roles={roles ?? []} onRefresh={() => setUsersRefresh((r) => r + 1)} notify={notify} />}
      {tab === "roles" && <RolesTab roles={roles} loading={rolesLoading} error={rolesError} onRetry={() => setRolesRefresh((r) => r + 1)} />}
      {tab === "integrations" && <IntegrationsTab integrations={integrations ?? []} loading={integLoading} error={integError} onRefresh={() => setIntegRefresh((r) => r + 1)} notify={notify} />}
      {tab === "data" && <DataTab audit={audit ?? []} auditLoading={auditLoading} onRefresh={reloadAll} notify={notify} />}
    </div>
  );
}