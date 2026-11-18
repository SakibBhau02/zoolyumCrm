"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Activity, AlertTriangle, Bell, Building2, CheckCircle2, Crown, Database, Download,
  FileSignature, FileText, Globe2, HardDrive, HeartPulse, Kanban, KeyRound, ListChecks,
  Lock, Mail, Palette, Pencil, Plug, Plus, Power, RefreshCw, Search, Server,
  ShieldAlert, ShieldCheck, Tags, Trash2, UserCheck, UserPlus, Users, Wallet, X, XCircle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchFormData, API_URL } from "@/lib/api";
import { useBranding } from "@/lib/branding-context";
import { useAuth } from "@/lib/auth";
import { formatDate, timeAgo } from "@/lib/format";
import {
  Avatar, CardShell, EmptyState, FadeIn, PageHeader, SectionTitle,
  SkeletonBlock, StatusBadge, cn,
} from "@/components/shared";
import { Btn, TableShell, Td, THead, Th, Tr } from "@/components/table";
import { Field, FormActions, Input, Modal, Segmented, Select, Textarea } from "@/components/ui";
import { PAY_META, MOBILE_WALLET_KINDS } from "@/lib/payment-meta";
import { TelegramTab } from "./_components/telegram-tab";

type Tab = "settings" | "users" | "roles" | "integrations" | "whatsapp" | "telegram" | "data";

const SECTIONS = [
  { id: "companyProfile", label: "Company Profile", icon: Building2 },
  { id: "regional", label: "Regional", icon: Globe2 },
  { id: "invoiceTemplate", label: "Invoicing", icon: FileText },
  { id: "invoiceProfile", label: "Invoice & Signature", icon: FileSignature },
  { id: "financeConfig", label: "Finance", icon: Wallet },
  { id: "pipelineStages", label: "Pipeline Stages", icon: Kanban },
  { id: "leadCategories", label: "Lead Categories", icon: Tags },
  { id: "leadRules", label: "Lead Rules", icon: ShieldCheck },
  { id: "clientTiers", label: "Client Tiers", icon: Crown },
  { id: "healthScoreWeights", label: "Scoring Engine", icon: HeartPulse },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "emailTemplates", label: "Email Templates", icon: Mail },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "security", label: "Security", icon: Lock },
  { id: "email", label: "Email / SMTP", icon: Mail },
  { id: "system", label: "System", icon: Server },
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

const MODULES = ["PULSE", "ACCOUNTS", "FLOW", "TASKS", "PEOPLE", "CAPITAL", "INSIGHT", "CALENDAR", "PORTAL", "CONTROL"];

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
      value={value || "#FF5001"}
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
        <Field label="Company logo URL" hint="Path or hosted URL of the logo"><Input value={draft.companyLogo ?? ""} onChange={(e) => set("companyLogo", e.target.value)} placeholder="/brand/zoolyum-wordmark-dark.png" /></Field>
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
        <Field label="Accent color"><ColorInput value={draft.accentColor ?? "#FF5001"} onChange={(v) => set("accentColor", v)} /></Field>
        <p className="pt-6 text-body text-muted-foreground">Accent used for headings and totals on generated PDFs</p>
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
      subtitle="Payment terms, late fees, payment methods, tax rates and dashboard targets"
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
        <p className="text-meta font-semibold text-muted-foreground">Dashboard planning</p>
        <p className="mb-2.5 text-micro text-muted-foreground">
          The owner dashboard compares revenue against this target and shows how many months the
          current cash lasts. Leave a field at 0 to hide that comparison instead of showing a guess.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Monthly revenue target (৳)" hint="Used by “Revenue vs target” on the dashboard.">
            <Input
              type="number"
              step="1000"
              min="0"
              value={draft.monthlyRevenueTarget ?? 0}
              onChange={(e) => patch({ monthlyRevenueTarget: Number(e.target.value) })}
            />
          </Field>
          <Field label="Monthly fixed cost (৳)" hint="Salaries, rent and tools. Sets the floor for the runway calculation.">
            <Input
              type="number"
              step="1000"
              min="0"
              value={draft.monthlyFixedCost ?? 0}
              onChange={(e) => patch({ monthlyFixedCost: Number(e.target.value) })}
            />
          </Field>
          <Field label="Concentration warning (%)" hint="Top-3 client share that raises an amber warning.">
            <Input
              type="number"
              step="5"
              min="0"
              max="100"
              value={draft.concentrationWarnPct ?? 50}
              onChange={(e) => patch({ concentrationWarnPct: Number(e.target.value) })}
            />
          </Field>
          <Field label="Concentration critical (%)" hint="Top-3 client share that raises a red alert.">
            <Input
              type="number"
              step="5"
              min="0"
              max="100"
              value={draft.concentrationCriticalPct ?? 60}
              onChange={(e) => patch({ concentrationCriticalPct: Number(e.target.value) })}
            />
          </Field>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 p-3.5">
        <p className="text-meta font-semibold text-muted-foreground">Dollar desk</p>
        <p className="mb-2.5 text-micro text-muted-foreground">
          The cost rate used to calculate profit when a client buys dollars. Each sale keeps the rate it was recorded with, so changing this never rewrites past profit.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="USD cost rate (৳ per $1)" hint="Example: 130 means one dollar costs you ৳130.">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={draft.dollarCostRate ?? 130}
              onChange={(e) => patch({ dollarCostRate: Number(e.target.value) })}
            />
          </Field>
          <div className="flex items-end">
            <p className="rounded-xl bg-muted/40 px-3 py-2 text-micro text-muted-foreground">
              Sell ৳4,500 for $30 at cost ৳130 → cost ৳3,900, profit ৳600 (13.3% margin).
            </p>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border/60 p-3.5">
        <p className="mb-2.5 text-meta font-semibold text-muted-foreground">Payment methods</p>
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
        <p className="mb-2.5 text-meta font-semibold text-muted-foreground">Tax configurations</p>
        <div className="flex flex-col gap-2">
          {(draft.taxConfigs ?? []).map((t: any, i: number) => (
            <div key={t.id ?? i} className="flex items-center gap-2.5">
              <Input value={t.name} onChange={(e) => patchTax(i, { name: e.target.value })} className="flex-1" />
              <Input type="number" step="0.5" value={t.rate ?? 0} onChange={(e) => patchTax(i, { rate: Number(e.target.value) })} className="!w-24" />
              <div className="flex items-center gap-1.5">
                <Toggle checked={!!t.isDefault} onChange={(v) => patchTax(i, { isDefault: v })} />
                <span className="text-micro font-medium text-muted-foreground">default</span>
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
      onAdd={() => setRows([...rows, { id: uid(), name: "", color: "#FF5001" }])}
      onSave={(e) => {
        e.preventDefault();
        onSave({ leadCategories: rows });
      }}
      onCancel={() => setRows(settings.leadCategories?.map((c: any) => ({ ...c })) ?? [])}
      renderRow={(r: any, i: number) => (
        <div key={r.id ?? i} className="flex items-center gap-2.5">
          <ColorInput value={r.color ?? "#FF5001"} onChange={(v) => patch(i, { color: v })} />
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
      onAdd={() => setRows([...rows, { name: "", minValue: 0, color: "#FF5001" }])}
      onSave={(e) => {
        e.preventDefault();
        onSave({ clientTiers: rows });
      }}
      onCancel={() => setRows(settings.clientTiers?.map((t: any) => ({ ...t })) ?? [])}
      renderRow={(r: any, i: number) => (
        <div key={i} className="flex items-center gap-2.5">
          <ColorInput value={r.color ?? "#FF5001"} onChange={(v) => patch(i, { color: v })} />
          <Input value={r.name} onChange={(e) => patch(i, { name: e.target.value })} className="flex-1" placeholder="Tier name" />
          <Input type="number" value={r.minValue ?? 0} onChange={(e) => patch(i, { minValue: Number(e.target.value) })} className="!w-32" placeholder="Min value" />
          <DelBtn onClick={() => setRows(rows.filter((_: any, j: number) => j !== i))} />
        </div>
      )}
    />
  );
}

function ScoringLinkSection() {
  return (
    <CardShell>
      <SectionTitle
        title="Scoring engine"
        subtitle="Client health and project risk are calculated by a configurable engine — not by hardcoded numbers."
      />
      <div className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ["Weighted factors", "Every signal is normalised to 0-100 and weighted. Change a weight and the score moves."],
            ["Editable bands", "Set the green / amber / red thresholds and the action each band requires."],
            ["Override rules", "Escalate a cliff automatically — 30+ days overdue, 30pp behind plan, and so on."],
            ["Explainability", "Each score carries a factor breakdown, so anyone can see why it is what it is."],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-xl border border-border/60 bg-background px-3 py-2.5">
              <p className="text-meta font-bold">{title}</p>
              <p className="mt-0.5 text-meta text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
        <Link
          href="/control/scoring"
          className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-primary px-3.5 text-body font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <HeartPulse className="size-3.5" /> Open the scoring engine
        </Link>
        <p className="text-meta text-muted-foreground">
          The old weight table lived here but the engine never read it. It has been replaced by the page above,
          which drives the actual calculation, the history snapshots and the nightly recompute.
        </p>
      </div>
    </CardShell>
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
          <span key={`${s}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1.5 text-body font-medium">
            {s}
            <button type="button" onClick={() => setStatuses(statuses.filter((_, j) => j !== i))} className="text-muted-foreground transition-colors hover:text-rose-400">
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        {statuses.length === 0 && <p className="text-body text-muted-foreground">No custom statuses</p>}
      </div>
      <div className="flex items-center gap-2">
        <Input value={newStatus} onChange={(e) => setNewStatus(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} placeholder="New status…" className="max-w-xs" />
        <Btn type="button" variant="outline" onClick={add}><Plus className="size-3.5" /> Add</Btn>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-border/60 px-3.5 py-3">
        <div>
          <p className="text-body font-semibold">Auto-assign from templates</p>
          <p className="text-meta text-muted-foreground">Automatically generate tasks when a deal enters the pipeline</p>
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
              <span className="text-micro font-medium text-muted-foreground">{c.label}</span>
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
              <p className="text-body font-semibold">{t.name}</p>
              <p className="truncate text-meta text-muted-foreground">{t.subject || "No subject"}</p>
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
  const [logoDarkJxlUrl, setLogoDarkJxlUrl] = useState<string>("");
  const [logoLightJxlUrl, setLogoLightJxlUrl] = useState<string>("");
  const [primaryColor, setPrimaryColor] = useState("#FF5001");
  const [secondaryColor, setSecondaryColor] = useState("#FF8A2B");
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
    setLogoDarkJxlUrl((branding as any).logoDarkJxlUrl ?? "");
    setLogoLightJxlUrl((branding as any).logoLightJxlUrl ?? "");
    if (branding.primaryColor) setPrimaryColor(branding.primaryColor);
    if (branding.secondaryColor) setSecondaryColor(branding.secondaryColor);
  }, [branding]);

  const handleFile = async (file: File, variant: "dark" | "light") => {
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) {
      notify("Only png, jpeg, webp images are allowed");
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
      const res = await apiFetchFormData<{ url: string; jxlUrl?: string | null }>("/control/branding/upload", fd);
      const url = res.url;
      if (variant === "dark") { setLogoDarkUrl(url); setLogoDarkJxlUrl(res.jxlUrl ?? ""); }
      else { setLogoLightUrl(url); setLogoLightJxlUrl(res.jxlUrl ?? ""); }
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
          logoDarkJxlUrl: logoDarkJxlUrl || null,
          logoLightJxlUrl: logoLightJxlUrl || null,
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
              <p className="text-body font-semibold">Dark Logo</p>
              <p className="text-meta text-muted-foreground">Shown on light backgrounds</p>
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
                  <span className="text-meta text-muted-foreground">Drop image or click to upload</span>
                )}
                {uploadingDark && <span className="text-meta text-muted-foreground">Uploading…</span>}
              </div>
              <input
                ref={darkInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, "dark"); e.target.value = ""; }}
              />
              <Btn type="button" variant="outline" className="w-fit" onClick={() => darkInputRef.current?.click()}>
                {darkPreview ? "Replace" : "Upload"} Dark Logo
              </Btn>
            </div>

            {/* Light Logo */}
            <div className="flex flex-col gap-2">
              <p className="text-body font-semibold">Light Logo</p>
              <p className="text-meta text-muted-foreground">Shown on dark / sidebar backgrounds</p>
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
                  <span className="text-meta text-muted-foreground">Drop image or click to upload</span>
                )}
                {uploadingLight && <span className="text-meta text-muted-foreground">Uploading…</span>}
              </div>
              <input
                ref={lightInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
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
            <span className="text-meta font-semibold text-muted-foreground">Gradient preview</span>
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
            setPrimaryColor(branding.primaryColor ?? "#FF5001");
            setSecondaryColor(branding.secondaryColor ?? "#FF8A2B");
          }
        }} submitLabel="Save branding" />
      </form>
    </CardShell>
  );
}

function InvoiceCompanyProfileSection({ notify }: { notify: (msg: string) => void }) {
  const { branding, refresh } = useBranding();
  const queryClient = useQueryClient();
  const [f, setF] = useState({
    tagline: "", email: "", phone: "", address: "", city: "", country: "",
    taxId: "", website: "", authorizedSignerName: "", authorizedSignerTitle: "",
    signatureImageUrl: "", defaultCurrency: "BDT", defaultNotes: "", defaultTerms: "",
    payMethod: "BANK_TRANSFER", payBankName: "", payAccountName: "", payAccountNumber: "",
    payBranch: "", payRoutingNumber: "", payMobileWalletNumber: "", payWalletProviders: [] as string[],
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const sigInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!branding) return;
    const pay: any = branding.defaultPaymentDetails ?? {};
    setF({
      tagline: branding.tagline ?? "", email: branding.email ?? "", phone: branding.phone ?? "",
      address: branding.address ?? "", city: branding.city ?? "", country: branding.country ?? "",
      taxId: branding.taxId ?? "", website: branding.website ?? "",
      authorizedSignerName: branding.authorizedSignerName ?? "", authorizedSignerTitle: branding.authorizedSignerTitle ?? "",
      signatureImageUrl: branding.signatureImageUrl ?? "", defaultCurrency: branding.defaultCurrency ?? "BDT",
      defaultNotes: branding.defaultNotes ?? "", defaultTerms: branding.defaultTerms ?? "",
      payMethod: pay.method ?? "BANK_TRANSFER", payBankName: pay.bankName ?? "", payAccountName: pay.accountName ?? "",
      payAccountNumber: pay.accountNumber ?? "", payBranch: pay.branch ?? "", payRoutingNumber: pay.routingNumber ?? "",
      payMobileWalletNumber: pay.mobileWalletNumber ?? "",
      payWalletProviders: Array.isArray(pay.mobileWalletProviders) ? pay.mobileWalletProviders : [],
    });
  }, [branding]);

  const set = (k: string, v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const toggleWallet = (provider: string) =>
    setF((prev) => {
      const current = prev.payWalletProviders ?? [];
      return {
        ...prev,
        payWalletProviders: current.includes(provider)
          ? current.filter((p) => p !== provider)
          : [...current, provider],
      };
    });

  const handleSigFile = async (file: File) => {
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) return notify("Only png, jpeg, webp images are allowed");
    if (file.size > 5 * 1024 * 1024) return notify("File too large — 5MB limit");
    const fd = new FormData();
    fd.append("file", file);
    setUploading(true);
    try {
      const res = await apiFetchFormData<{ url: string }>("/control/branding/upload", fd);
      set("signatureImageUrl", res.url);
      notify("Signature uploaded");
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
      const trim = (v: string) => v.trim() || null;
      const pay: Record<string, any> = {};
      const providers = f.payWalletProviders ?? [];
      // One number can serve several providers; `method` stays the primary one
      // for the ledger, the full list drives the invoice line.
      pay.method = providers[0] || (f.payMethod.trim() || "BANK_TRANSFER");
      if (providers.length) pay.mobileWalletProviders = providers;
      if (f.payBankName.trim()) pay.bankName = f.payBankName.trim();
      if (f.payAccountName.trim()) pay.accountName = f.payAccountName.trim();
      if (f.payAccountNumber.trim()) pay.accountNumber = f.payAccountNumber.trim();
      if (f.payBranch.trim()) pay.branch = f.payBranch.trim();
      if (f.payRoutingNumber.trim()) pay.routingNumber = f.payRoutingNumber.trim();
      if (f.payMobileWalletNumber.trim()) pay.mobileWalletNumber = f.payMobileWalletNumber.trim();
      await apiFetch("/control/branding", {
        method: "PATCH",
        body: JSON.stringify({
          tagline: trim(f.tagline), email: trim(f.email), phone: trim(f.phone),
          address: trim(f.address), city: trim(f.city), country: trim(f.country),
          taxId: trim(f.taxId), website: trim(f.website),
          authorizedSignerName: trim(f.authorizedSignerName), authorizedSignerTitle: trim(f.authorizedSignerTitle),
          signatureImageUrl: trim(f.signatureImageUrl), defaultCurrency: trim(f.defaultCurrency),
          defaultNotes: trim(f.defaultNotes), defaultTerms: trim(f.defaultTerms),
          defaultPaymentDetails: Object.keys(pay).length ? pay : null,
        }),
      });
      notify("Invoice company profile saved");
      await queryClient.invalidateQueries({ queryKey: ["branding"] });
      await refresh();
    } catch (e2: any) {
      notify(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const sigPreview = resolveBrandingImgUrl(f.signatureImageUrl || null);

  return (
    <CardShell className="mt-4">
      <form onSubmit={onSave}>
        <SectionTitle title="Invoice company profile" subtitle="Printed on every invoice PDF — contact block, authorized signature, default payment instructions, notes & terms" />
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Tagline"><Input value={f.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="Engineering Scalable Next-Gen Digital Products" /></Field>
            <Field label="Website"><Input value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://zoolyum.com" /></Field>
            <Field label="Email"><Input value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="billing@zoolyum.com" /></Field>
            <Field label="Phone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+880 1700 000000" /></Field>
            <Field label="Address"><Input value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="Level 6, Silicon Tower, Gulshan-2" /></Field>
            <Field label="City"><Input value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="Dhaka - 1212" /></Field>
            <Field label="Country"><Input value={f.country} onChange={(e) => set("country", e.target.value)} placeholder="Bangladesh" /></Field>
            <Field label="Tax ID (BIN/VAT)"><Input value={f.taxId} onChange={(e) => set("taxId", e.target.value)} placeholder="BIN-9920194812" /></Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Authorized signer name"><Input value={f.authorizedSignerName} onChange={(e) => set("authorizedSignerName", e.target.value)} placeholder="Sakib Hasan" /></Field>
            <Field label="Signer title"><Input value={f.authorizedSignerTitle} onChange={(e) => set("authorizedSignerTitle", e.target.value)} placeholder="Managing Director" /></Field>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-body font-semibold">Signature image</p>
            <div className="flex items-center gap-3">
              <div className="flex h-20 w-56 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-card">
                {sigPreview ? <img src={sigPreview} alt="Signature preview" className="max-h-full object-contain" /> : <span className="text-meta text-muted-foreground">No signature — cursive fallback prints</span>}
              </div>
              <div className="flex flex-col gap-2">
                <input ref={sigInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleSigFile(file); e.target.value = ""; }} />
                <Btn type="button" variant="outline" className="w-fit" onClick={() => sigInputRef.current?.click()}>{uploading ? "Uploading…" : sigPreview ? "Replace signature" : "Upload signature"}</Btn>
                {sigPreview && <Btn type="button" variant="ghost" className="w-fit" onClick={() => set("signatureImageUrl", "")}>Remove</Btn>}
              </div>
            </div>
          </div>

          <p className="text-body font-semibold">Default payment instructions</p>
          <p className="-mt-2 text-meta text-muted-foreground">
            These print at the bottom-left of every invoice. One mobile number can serve several providers.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Mobile wallet number" hint="bKash / Nagad / Rocket / Upay — same number allowed">
              <Input value={f.payMobileWalletNumber} onChange={(e) => set("payMobileWalletNumber", e.target.value)} placeholder="01XXXXXXXXX" inputMode="tel" /></Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-meta font-semibold text-muted-foreground">This number is used for</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
                {MOBILE_WALLET_KINDS.map((kind) => (
                  <label key={kind} className="flex cursor-pointer items-center gap-1.5 text-body">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-primary"
                      checked={(f.payWalletProviders ?? []).includes(kind)}
                      onChange={() => toggleWallet(kind)}
                    />
                    {PAY_META[kind].short}
                  </label>
                ))}
              </div>
            </div>
            <Field label="Bank name"><Input value={f.payBankName} onChange={(e) => set("payBankName", e.target.value)} placeholder="City Bank PLC" /></Field>
            <Field label="Account name"><Input value={f.payAccountName} onChange={(e) => set("payAccountName", e.target.value)} placeholder="Zoolyum Agency" /></Field>
            <Field label="Account number"><Input value={f.payAccountNumber} onChange={(e) => set("payAccountNumber", e.target.value)} placeholder="1102938481901" /></Field>
            <Field label="Branch"><Input value={f.payBranch} onChange={(e) => set("payBranch", e.target.value)} placeholder="Gulshan Branch" /></Field>
            <Field label="Routing number"><Input value={f.payRoutingNumber} onChange={(e) => set("payRoutingNumber", e.target.value)} placeholder="225271891" /></Field>
            <Field label="Default currency">
              <Select value={f.defaultCurrency} onChange={(e) => set("defaultCurrency", e.target.value)}>
                <option value="BDT">BDT</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="INR">INR</option>
              </Select>
            </Field>
          </div>
          <Field label="Default notes"><Textarea value={f.defaultNotes} onChange={(e) => set("defaultNotes", e.target.value)} placeholder="Notes prefilled on every new invoice…" /></Field>
          <Field label="Default terms"><Textarea value={f.defaultTerms} onChange={(e) => set("defaultTerms", e.target.value)} placeholder="Payment is due within 15 days of invoice date." /></Field>
        </div>
        <FormActions busy={busy} cancel={() => {}} submitLabel="Save company profile" />
      </form>
    </CardShell>
  );
}

function SignatureTips() {
  return (
    <CardShell className="mt-4">
      <SectionTitle
        title="Signature & invoice artwork tips"
        subtitle="These settings drive the downloaded PDF and the browser print view"
      />
      <ul className="mt-2 flex flex-col gap-2 text-body leading-relaxed text-muted-foreground">
        <li>• Upload a transparent PNG cropped tight around the signature — it is scaled into a 40 × 13 mm slot without stretching.</li>
        <li>• The signer name and title print under the rule, centred on the same vertical axis as the image.</li>
        <li>• Leave “Signature image” empty to print the cursive “Authorized Representative” fallback instead.</li>
        <li>• Every invoice is A4 (210 × 297 mm); the print view uses 10 mm page margins so columns never re-flow.</li>
        <li>• Changes apply to the next download immediately — reopen the invoice if an old PDF is still open.</li>
      </ul>
    </CardShell>
  );
}

function SecuritySection({ settings, busy, onSave }: any) {
  const [d, setD] = useDraft(settings?.security);
  if (!settings?.security) return <SkeletonBlock className="h-64" />;
  const set = (k: string, v: any) => setD({ ...d, [k]: v });
  const ipText = Array.isArray(d.ipAllowlist) ? d.ipAllowlist.join("\n") : "";
  return (
    <SectionShell
      title="Security policy"
      subtitle="Password strength, session lifetime and login lockout — enforced on every staff account"
      busy={busy}
      onSave={(e) => {
        e.preventDefault();
        onSave({ security: d });
      }}
      onCancel={() => setD({ ...settings.security })}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Minimum password length">
          <Input type="number" min={6} max={64} value={d.passwordMinLength ?? 8} onChange={(e) => set("passwordMinLength", Number(e.target.value))} />
        </Field>
        <Field label="Session lifetime (hours)">
          <Input type="number" min={1} max={720} value={d.sessionHours ?? 12} onChange={(e) => set("sessionHours", Number(e.target.value))} />
        </Field>
        <Field label="Max failed logins before lockout">
          <Input type="number" min={1} max={50} value={d.maxLoginAttempts ?? 5} onChange={(e) => set("maxLoginAttempts", Number(e.target.value))} />
        </Field>
        <Field label="Lockout duration (minutes)">
          <Input type="number" min={1} max={1440} value={d.lockoutMinutes ?? 15} onChange={(e) => set("lockoutMinutes", Number(e.target.value))} />
        </Field>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-3.5">
        <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Password requirements</p>
        <RuleToggle label="Require a number" desc="At least one digit" value={!!d.requireNumber} onChange={(v) => set("requireNumber", v)} />
        <RuleToggle label="Require an uppercase letter" desc="At least one A–Z character" value={!!d.requireUppercase} onChange={(v) => set("requireUppercase", v)} />
        <RuleToggle label="Require a symbol" desc="At least one punctuation character" value={!!d.requireSymbol} onChange={(v) => set("requireSymbol", v)} />
      </div>

      <Field label="IP allowlist" hint="One IPv4/IPv6 address per line. Leave empty to allow every address.">
        <Textarea
          value={ipText}
          onChange={(e) => set("ipAllowlist", e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))}
          placeholder={"203.0.113.10\n198.51.100.0"}
        />
      </Field>

      <p className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-meta leading-relaxed text-amber-600 dark:text-amber-400">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
        Resetting a password, changing a role or deactivating a user revokes that user&apos;s existing session immediately.
      </p>
    </SectionShell>
  );
}

function EmailSection({ settings, busy, onSave }: any) {
  const [d, setD] = useDraft(settings?.email);
  const [password, setPassword] = useState("");
  const [clear, setClear] = useState(false);
  if (!settings?.email) return <SkeletonBlock className="h-64" />;
  const set = (k: string, v: any) => setD({ ...d, [k]: v });
  return (
    <SectionShell
      title="Email delivery (SMTP)"
      subtitle="Outgoing mail server used for invoice emails, reminders and receipts"
      busy={busy}
      onSave={(e) => {
        e.preventDefault();
        onSave({ email: { ...d, smtpPassword: password || undefined, clearPassword: clear } });
        setPassword("");
        setClear(false);
      }}
      onCancel={() => setD({ ...settings.email })}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="SMTP host"><Input value={d.host ?? ""} onChange={(e) => set("host", e.target.value)} placeholder="smtp.zoho.com" /></Field>
        <Field label="Port"><Input type="number" value={d.port ?? 587} onChange={(e) => set("port", Number(e.target.value))} /></Field>
        <Field label="Username"><Input value={d.user ?? ""} onChange={(e) => set("user", e.target.value)} placeholder="billing@company.com" /></Field>
        <Field label="Password" hint={settings.email.hasSmtpPassword ? "A password is stored. Leave blank to keep it." : "No password stored yet."}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
        </Field>
        <Field label="From name"><Input value={d.fromName ?? ""} onChange={(e) => set("fromName", e.target.value)} placeholder="Zoolyum" /></Field>
        <Field label="From email"><Input value={d.fromEmail ?? ""} onChange={(e) => set("fromEmail", e.target.value)} placeholder="billing@company.com" /></Field>
        <Field label="Reply-to"><Input value={d.replyTo ?? ""} onChange={(e) => set("replyTo", e.target.value)} placeholder="support@company.com" /></Field>
        <div className="flex flex-col justify-end gap-2">
          <RuleToggle label="Use TLS/SSL" desc="Secure connection on connect" value={!!d.secure} onChange={(v) => set("secure", v)} />
          {settings.email.hasSmtpPassword && (
            <label className="flex cursor-pointer items-center gap-2 text-meta font-medium text-rose-500">
              <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} className="size-3.5 accent-rose-500" />
              Remove stored password
            </label>
          )}
        </div>
      </div>
      <p className="text-meta text-muted-foreground">
        Passwords are encrypted at rest (AES-256-GCM) and are never returned by the API.
      </p>
    </SectionShell>
  );
}

function HealthCard({ label, value, tone = "text-foreground", icon }: { label: string; value: React.ReactNode; tone?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </p>
      <p className={cn("mt-1 text-body-lg font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

function SystemSection({ settings, busy, onSave }: any) {
  const [d, setD] = useDraft(settings?.system);
  const [refresh, setRefresh] = useState(0);
  const { data: health, loading: hLoading, error: hError } = useRefetch<any>("/control/health", refresh);
  if (!settings?.system) return <SkeletonBlock className="h-64" />;
  const set = (k: string, v: any) => setD({ ...d, [k]: v });
  const flags = d.featureFlags ?? {};
  const setFlag = (k: string, v: boolean) => setD({ ...d, featureFlags: { ...flags, [k]: v } });
  const up = health?.uptimeSeconds ?? 0;
  const uptime = `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`;

  return (
    <div className="flex flex-col gap-4">
      <SectionShell
        title="System & feature flags"
        subtitle="Maintenance mode, module switches and audit retention"
        busy={busy}
        onSave={(e) => {
          e.preventDefault();
          onSave({ system: d });
        }}
        onCancel={() => setD({ ...settings.system })}
      >
        <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3.5">
          <RuleToggle
            label="Maintenance mode"
            desc="Show a maintenance notice to staff and block writes while you deploy"
            value={!!d.maintenanceMode}
            onChange={(v) => set("maintenanceMode", v)}
          />
          {d.maintenanceMode && (
            <div className="mt-3">
              <Field label="Maintenance message">
                <Textarea value={d.maintenanceMessage ?? ""} onChange={(e) => set("maintenanceMessage", e.target.value)} />
              </Field>
            </div>
          )}
        </div>

        <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Feature flags</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { key: "clientPortal", label: "Client portal", desc: "Public portal and approvals" },
            { key: "whatsapp", label: "WhatsApp", desc: "Cloud API messaging" },
            { key: "telegram", label: "Telegram", desc: "Bot notifications" },
            { key: "aiInsights", label: "AI insights", desc: "Correlations and summaries" },
            { key: "payroll", label: "Payroll", desc: "Runs, payslips and salary" },
          ].map((f) => (
            <div key={f.key} className="rounded-xl border border-border/60 px-3 py-2.5">
              <RuleToggle label={f.label} desc={f.desc} value={flags[f.key] !== false} onChange={(v) => setFlag(f.key, v)} />
            </div>
          ))}
        </div>

        <Field label="Audit retention (days)" hint="How long security events are kept before pruning">
          <Input type="number" min={7} max={3650} value={d.auditRetentionDays ?? 365} onChange={(e) => set("auditRetentionDays", Number(e.target.value))} />
        </Field>
      </SectionShell>

      <CardShell>
        <div className="flex items-center justify-between gap-3">
          <SectionTitle title="System health" subtitle={health?.checkedAt ? `Last checked ${timeAgo(health.checkedAt)}` : "Live status of this API instance"} />
          <Btn variant="outline" onClick={() => setRefresh((r) => r + 1)} disabled={hLoading}>
            <RefreshCw className={cn("size-3.5", hLoading && "animate-spin")} /> Refresh
          </Btn>
        </div>
        {hError ? (
          <p className="text-body font-medium text-rose-400">{hError}</p>
        ) : hLoading && !health ? (
          <SkeletonBlock className="h-28" />
        ) : health ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              <HealthCard label="API" value={health.ok ? "Operational" : "Degraded"} tone={health.ok ? "text-emerald-500" : "text-rose-500"} icon={health.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />} />
              <HealthCard label="Database" value={`${health.database?.latencyMs ?? "—"} ms`} tone={health.database?.ok ? "text-emerald-500" : "text-rose-500"} icon={<Database className="size-4" />} />
              <HealthCard label="Cache" value={health.cache === "redis" ? "Redis" : health.cache === "memory" ? "In-memory" : "Down"} tone={health.cache === "redis" ? "text-emerald-500" : health.cache === "memory" ? "text-amber-500" : "text-rose-500"} icon={<Activity className="size-4" />} />
              <HealthCard label="Uptime" value={uptime} icon={<Server className="size-4" />} />
              <HealthCard label="Memory" value={`${health.process?.rssMb ?? 0} MB`} icon={<HardDrive className="size-4" />} />
              <HealthCard label="Uploads" value={`${health.storage?.uploadsMb ?? 0} MB`} icon={<HardDrive className="size-4" />} />
              <HealthCard label="Users" value={`${health.counts?.activeUsers ?? 0}/${health.counts?.users ?? 0} active`} icon={<Users className="size-4" />} />
              <HealthCard label="Audit events" value={health.counts?.auditEvents ?? 0} icon={<ShieldCheck className="size-4" />} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <HealthCard label="Node" value={health.process?.node ?? "—"} icon={<Server className="size-4" />} />
              <HealthCard label="Environment" value={health.environment ?? "—"} icon={<Globe2 className="size-4" />} />
              <HealthCard label="Version" value={health.version ?? "—"} icon={<Tags className="size-4" />} />
              <HealthCard label="Clients / projects" value={`${health.counts?.clients ?? 0} / ${health.counts?.projects ?? 0}`} icon={<Building2 className="size-4" />} />
            </div>
            {health.lastAudit && (
              <p className="mt-3 text-meta text-muted-foreground">
                Last audit event: <span className="font-medium text-foreground">{health.lastAudit.action}</span> on {health.lastAudit.entityType} · {timeAgo(health.lastAudit.timestamp)}
              </p>
            )}
          </>
        ) : null}
      </CardShell>
    </div>
  );
}

function AppearanceSection({ settings, busy, onSave }: any) {  const [draft, setDraft] = useDraft(settings?.appearance);
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
            <p className="text-body font-semibold">{r.title}</p>
            <p className="text-meta text-muted-foreground">{r.desc}</p>
          </div>
          <Toggle checked={!!draft[r.key]} onChange={(v) => set(r.key, v)} />
        </div>
      ))}
    </SectionShell>
  );
}

function LeadRulesSection({ onSave, notify }: { onSave: (partial: any) => void; notify: (m: string) => void }) {
  const [rules, setRules] = useState<any | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [showWeights, setShowWeights] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<any>("/pulse/rules").catch(() => null),
      apiFetch<any[]>("/users").catch(() => []),
      apiFetch<any[]>("/control/roles").catch(() => []),
    ]).then(([r, u, ro]) => {
      setRules(r);
      setUsers(u ?? []);
      setRoles((ro ?? []).map((x: any) => x.name));
    });
  }, []);

  if (!rules) return <SkeletonBlock className="h-64" />;

  const set = (path: string, value: any) =>
    setRules((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split(".");
      let cur = next;
      for (const k of keys.slice(0, -1)) cur = cur[k];
      cur[keys[keys.length - 1]] = value;
      return next;
    });

  const save = async () => {
    setBusy(true);
    try {
      onSave({ leadRules: rules });
      notify("Lead rules saved");
    } finally {
      setBusy(false);
    }
  };

  const runAudit = async () => {
    setAuditing(true);
    try {
      const r = await apiFetch<any>("/pulse/audit", { method: "POST" });
      notify(`Audit complete — ${r.flagged} of ${r.scanned} leads flagged · ${r.duplicates} duplicates · ${r.slaBreach} SLA breaches · ${r.rescored} rescored`);
    } catch (e: any) {
      notify(e.message ?? "Audit failed");
    } finally {
      setAuditing(false);
    }
  };

  const verticalKeys = ["EDUCATION", "HEALTHCARE", "D2C", "OTHER"];
  const sourceKeys = ["REFERRAL", "WEBSITE", "LINKEDIN", "PARTNER", "FACEBOOK", "GOOGLE_ADS", "WHATSAPP", "INBOUND_PHONE", "EMAIL_CAMPAIGN", "EVENT", "EMAIL", "COLD_CALL", "COLD", "OTHER"];
  const priorityKeys = ["URGENT", "HIGH", "MEDIUM", "LOW"];

  return (
    <CardShell>
      <SectionTitle
        title="Lead Rules"
        subtitle="What counts as a storable lead, who owns it, how it is scored and how fast it must be answered"
        action={
          <Btn variant="outline" onClick={runAudit} disabled={auditing}>
            <RefreshCw className={cn("size-3.5", auditing && "animate-spin")} /> Run audit now
          </Btn>
        }
      />

      <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 px-3.5 py-3">
        <div>
          <p className="text-body font-semibold">Rule engine</p>
          <p className="text-meta text-muted-foreground">Master switch. Off = every lead is accepted exactly as typed.</p>
        </div>
        <Toggle checked={!!rules.enabled} onChange={(v) => set("enabled", v)} />
      </div>

      <div className={cn("mt-4 grid gap-4 lg:grid-cols-2", !rules.enabled && "pointer-events-none opacity-50")}>
        {/* Intake gate */}
        <RuleCard title="Intake gate" hint="Missing values block the save (or just warn, where noted)">
          <RuleToggle label="Phone required" desc="Phone is the contact that works in BD" value={rules.intake.requirePhone.enabled} onChange={(v) => set("intake.requirePhone.enabled", v)} />
          <RuleToggle label="Normalise phone" desc="+8801813-778899 → +8801813778899 before matching" value={rules.intake.normalizePhone.enabled} onChange={(v) => set("intake.normalizePhone.enabled", v)} />
          <RuleToggle label="Validate email format" desc="Refuse addresses without @ and a domain" value={rules.intake.validateEmail.enabled} onChange={(v) => set("intake.validateEmail.enabled", v)} />
          <RuleToggle label="Email required" desc="Turn on if you want a written trail for every lead" value={rules.intake.requireEmail.enabled} onChange={(v) => set("intake.requireEmail.enabled", v)} />
          <RuleToggle label="Company required" desc="B2B: every lead must belong to a business" value={rules.intake.requireCompany.enabled} onChange={(v) => set("intake.requireCompany.enabled", v)} />
          <RuleToggle label="Real source required" desc="Warns when the source is left as “Other”" value={rules.intake.requireSource.enabled} onChange={(v) => set("intake.requireSource.enabled", v)} />
          <RuleToggle label="Deal size required" desc="No estimate = no pipeline forecast" value={rules.intake.requireDealSize.enabled} onChange={(v) => set("intake.requireDealSize.enabled", v)}>
            <Input type="number" min={0} value={rules.intake.requireDealSize.minAmount ?? 0} onChange={(e) => set("intake.requireDealSize.minAmount", Number(e.target.value))} className="!w-28 !py-1 text-meta" />
          </RuleToggle>
          <RuleToggle label="Notes required" desc="At least a line of context from the first call" value={rules.intake.requireNotes.enabled} onChange={(v) => set("intake.requireNotes.enabled", v)}>
            <Input type="number" min={0} value={rules.intake.requireNotes.minChars ?? 20} onChange={(e) => set("intake.requireNotes.minChars", Number(e.target.value))} className="!w-20 !py-1 text-meta" />
          </RuleToggle>
        </RuleCard>

        {/* Duplicates */}
        <RuleCard title="Duplicates" hint="Same contact twice wastes a rep's day">
          <RuleToggle label="Phone match" desc="Compared after normalisation" value={rules.duplicates.byPhone.enabled} onChange={(v) => set("duplicates.byPhone.enabled", v)}>
            <ActionSelect value={rules.duplicates.byPhone.action} onChange={(v) => set("duplicates.byPhone.action", v)} />
          </RuleToggle>
          <RuleToggle label="Email match" desc="Case-insensitive" value={rules.duplicates.byEmail.enabled} onChange={(v) => set("duplicates.byEmail.enabled", v)}>
            <ActionSelect value={rules.duplicates.byEmail.action} onChange={(v) => set("duplicates.byEmail.action", v)} />
          </RuleToggle>
          <RuleToggle label="Same company" desc="A different person at a known company" value={rules.duplicates.byCompany.enabled} onChange={(v) => set("duplicates.byCompany.enabled", v)}>
            <ActionSelect value={rules.duplicates.byCompany.action} onChange={(v) => set("duplicates.byCompany.action", v)} />
          </RuleToggle>
          <RuleToggle label="Include converted clients" desc="Warn when an old customer comes back" value={rules.duplicates.includeConverted.enabled} onChange={(v) => set("duplicates.includeConverted.enabled", v)} />
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-body font-semibold">Lookback window</p>
              <p className="text-micro text-muted-foreground">How far back to search (0 = whole database)</p>
            </div>
            <Input type="number" min={0} value={rules.duplicates.lookbackDays ?? 180} onChange={(e) => set("duplicates.lookbackDays", Number(e.target.value))} className="!w-24 !py-1 text-meta" />
          </div>
        </RuleCard>

        {/* Routing */}
        <RuleCard title="Ownership & routing" hint="Nobody should have to ask “whose lead is this?”">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-body font-semibold">Assignment</p>
              <p className="text-micro text-muted-foreground">How a new lead finds an owner</p>
            </div>
            <Select value={rules.routing.mode} onChange={(e) => set("routing.mode", e.target.value)} className="!w-56 !py-1 text-meta">
              <option value="VERTICAL_THEN_ROUND_ROBIN">Vertical owner, else round-robin</option>
              <option value="ROUND_ROBIN">Round-robin only</option>
              <option value="CREATOR">Whoever created it</option>
              <option value="MANUAL">Manual (form choice)</option>
            </Select>
          </div>
          {verticalKeys.map((v) => (
            <div key={v} className="flex items-center justify-between gap-3">
              <p className="text-body font-semibold">{v.charAt(0) + v.slice(1).toLowerCase()} owner</p>
              <Select value={rules.routing.verticalOwners?.[v] ?? ""} onChange={(e) => set("routing.verticalOwners." + v, e.target.value)} className="!w-44 !py-1 text-meta">
                <option value="">Use round-robin</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-body font-semibold">Fallback owner</p>
              <p className="text-micro text-muted-foreground">Used when nobody is in the rotation</p>
            </div>
            <Select value={rules.routing.fallbackUserId ?? ""} onChange={(e) => set("routing.fallbackUserId", e.target.value)} className="!w-44 !py-1 text-meta">
              <option value="">Creator</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-body font-semibold">Auto follow-up</p>
              <p className="text-micro text-muted-foreground">Creates the first call task N hours after intake</p>
            </div>
            <div className="flex items-center gap-2">
              <Input type="number" min={0} value={rules.routing.autoFollowUpHours ?? 0} onChange={(e) => set("routing.autoFollowUpHours", Number(e.target.value))} className="!w-20 !py-1 text-meta" />
              <span className="text-meta text-muted-foreground">hrs</span>
            </div>
          </div>
          <RuleToggle label="Auto-tag by source" desc="facebook, google-ads… so source filters work" value={rules.routing.autoTagSource} onChange={(v) => set("routing.autoTagSource", v)} />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-meta font-semibold text-muted-foreground">Round-robin roles:</span>
            {roles.map((r) => {
              const on = (rules.routing.roundRobinRoles ?? []).includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    const list: string[] = rules.routing.roundRobinRoles ?? [];
                    set("routing.roundRobinRoles", on ? list.filter((x) => x !== r) : [...list, r]);
                  }}
                  className={cn("rounded-full border px-2 py-0.5 text-micro font-semibold", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}
                >
                  {r}
                </button>
              );
            })}
          </div>
        </RuleCard>

        {/* Scoring */}
        <RuleCard title="Lead scoring" hint="Rank the queue; thresholds drive HOT / COLD">
          <RuleToggle label="Scoring on" desc="Off = every lead scores 0 and temperature stays manual" value={rules.scoring.enabled} onChange={(v) => set("scoring.enabled", v)} />
          <div className="flex items-center justify-between gap-3">
            <p className="text-body font-semibold">Base points</p>
            <Input type="number" value={rules.scoring.base ?? 0} onChange={(e) => set("scoring.base", Number(e.target.value))} className="!w-20 !py-1 text-meta" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MiniNum label="Email pts" value={rules.scoring.contact.email} onChange={(v) => set("scoring.contact.email", v)} />
            <MiniNum label="Phone pts" value={rules.scoring.contact.phone} onChange={(v) => set("scoring.contact.phone", v)} />
            <MiniNum label="Company pts" value={rules.scoring.contact.company} onChange={(v) => set("scoring.contact.company", v)} />
            <MiniNum label="HOT ≥" value={rules.scoring.thresholds.hot} onChange={(v) => set("scoring.thresholds.hot", v)} />
            <MiniNum label="COLD ≤" value={rules.scoring.thresholds.cold} onChange={(v) => set("scoring.thresholds.cold", v)} />
            <MiniNum label="Per activity" value={rules.scoring.activity.perActivity} onChange={(v) => set("scoring.activity.perActivity", v)} />
          </div>
          <RuleToggle label="Auto temperature" desc="Score sets HOT / WARM / COLD on save" value={rules.scoring.autoTemperature} onChange={(v) => set("scoring.autoTemperature", v)} />
          <button type="button" onClick={() => setShowWeights((v) => !v)} className="text-left text-meta font-bold text-primary hover:underline">
            {showWeights ? "Hide weight tables" : "Edit weight tables"}
          </button>
          {showWeights && (
            <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/10 p-3">
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Source</p>
              <div className="grid grid-cols-2 gap-1.5">
                {sourceKeys.map((s) => (
                  <MiniNum key={s} label={s.replace(/_/g, " ")} value={rules.scoring.source[s] ?? 0} onChange={(v) => set("scoring.source." + s, v)} />
                ))}
              </div>
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Priority</p>
              <div className="grid grid-cols-2 gap-1.5">
                {priorityKeys.map((p) => (
                  <MiniNum key={p} label={p} value={rules.scoring.priority[p] ?? 0} onChange={(v) => set("scoring.priority." + p, v)} />
                ))}
              </div>
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Vertical</p>
              <div className="grid grid-cols-2 gap-1.5">
                {verticalKeys.map((v) => (
                  <MiniNum key={v} label={v === "D2C" ? "D2C" : v.charAt(0) + v.slice(1).toLowerCase()} value={rules.scoring.vertical[v] ?? 0} onChange={(x) => set("scoring.vertical." + v, x)} />
                ))}
              </div>
              <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Deal size bands</p>
              <div className="flex flex-col gap-1.5">
                {(rules.scoring.dealSizeBands ?? []).map((b: any, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input type="number" value={b.min} onChange={(e) => set(`scoring.dealSizeBands.${i}.min`, Number(e.target.value))} className="!w-32 !py-1 text-meta" />
                    <span className="text-meta text-muted-foreground">+ points</span>
                    <Input type="number" value={b.points} onChange={(e) => set(`scoring.dealSizeBands.${i}.points`, Number(e.target.value))} className="!w-20 !py-1 text-meta" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </RuleCard>

        {/* SLA */}
        <RuleCard title="Response SLA" hint="How fast a new lead must be touched">
          <RuleToggle label="SLA tracking" desc="Breaches surface in Today and the worklist" value={rules.sla.enabled} onChange={(v) => set("sla.enabled", v)} />
          <div className="grid grid-cols-2 gap-2">
            {priorityKeys.map((p) => (
              <MiniNum key={p} label={p + " (hrs)"} value={rules.sla.firstResponseHours[p] ?? 24} onChange={(v) => set("sla.firstResponseHours." + p, v)} />
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-body font-semibold">Stale after</p>
              <p className="text-micro text-muted-foreground">No contact for N days = stale</p>
            </div>
            <div className="flex items-center gap-2">
              <Input type="number" min={1} value={rules.sla.staleDays ?? 7} onChange={(e) => set("sla.staleDays", Number(e.target.value))} className="!w-20 !py-1 text-meta" />
              <span className="text-meta text-muted-foreground">days</span>
            </div>
          </div>
          <RuleToggle label="Nightly audit" desc="03:15 — normalise phones, refresh flags and scores" value={rules.audit.nightly} onChange={(v) => set("audit.nightly", v)} />
        </RuleCard>
      </div>

      <div className="mt-4 flex justify-end">
        <Btn variant="primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save rules"}
        </Btn>
      </div>
    </CardShell>
  );
}

function RuleCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5">
      <p className="text-body font-bold">{title}</p>
      {hint && <p className="mb-2 text-micro text-muted-foreground">{hint}</p>}
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function RuleToggle({
  label,
  desc,
  value,
  onChange,
  children,
}: {
  label: string;
  desc?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-body font-semibold">{label}</p>
        {desc && <p className="text-micro text-muted-foreground">{desc}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {children}
        <Toggle checked={value} onChange={onChange} />
      </div>
    </div>
  );
}

function ActionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="!w-24 !py-1 text-meta">
      <option value="BLOCK">Block</option>
      <option value="WARN">Warn</option>
    </Select>
  );
}

function MiniNum({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card px-2 py-1">
      <span className="truncate text-micro font-semibold capitalize text-muted-foreground">{label.toLowerCase()}</span>
      <input
        type="number"
        value={value ?? 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-14 shrink-0 rounded-md border border-border bg-background px-1.5 py-0.5 text-right text-meta tabular-nums outline-none focus:border-primary/40"
      />
    </label>
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
      {active.id === "invoiceProfile" && (
        <>
          <InvoiceCompanyProfileSection notify={notify} />
          <SignatureTips />
        </>
      )}
      {active.id === "financeConfig" && <FinanceSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "pipelineStages" && (
        <PipelineStagesSection stages={stages} loading={stagesLoading} error={stagesError} onRefresh={onStagesRefresh} notify={notify} />
      )}
      {active.id === "leadCategories" && <LeadCategoriesSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "leadRules" && <LeadRulesSection onSave={onSave} notify={notify} />}
      {active.id === "clientTiers" && <ClientTiersSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "healthScoreWeights" && <ScoringLinkSection />}
      {active.id === "tasks" && <TasksSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "notifications" && <NotificationsSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "emailTemplates" && <EmailTemplatesSection settings={settings} busy={!!saving} onSave={onSave} notify={notify} />}
      {active.id === "appearance" && <AppearanceSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "security" && <SecuritySection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "email" && <EmailSection settings={settings} busy={!!saving} onSave={onSave} />}
      {active.id === "system" && <SystemSection settings={settings} busy={!!saving} onSave={onSave} />}
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
                "flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-body font-semibold transition-all",
                section === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
          <label className="flex cursor-pointer items-center gap-2 text-body font-medium">
            <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="size-3.5 accent-primary" />
            Account active
          </label>
        )}
        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save changes" : "Create user"} />
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: any) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (user) {
      setPw("");
      setErr(null);
      setTemp(null);
      setCopied(false);
    }
  }, [user]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<any>(`/control/users/${user.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ newPassword: pw.trim() || undefined }),
      });
      if (r?.temporaryPassword) {
        setTemp(r.temporaryPassword);
      } else {
        onClose();
      }
    } catch (e2: any) {
      setErr(e2.message ?? "Reset failed");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!temp) return;
    try {
      await navigator.clipboard.writeText(temp);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked */
    }
  };
  return (
    <Modal open={!!user} onClose={onClose} title={`Reset password — ${user?.name ?? ""}`}>
      {temp ? (
        <div className="flex flex-col gap-4">
          <p className="text-body leading-relaxed text-muted-foreground">
            Share this one-time password with the user. It is shown only once and their old sessions have been revoked.
          </p>
          <div className="flex items-center gap-2">
            <Input readOnly value={temp} className="!font-mono" />
            <Btn type="button" variant="outline" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</Btn>
          </div>
          <div className="flex justify-end">
            <Btn variant="primary" onClick={onClose}>Done</Btn>
          </div>
        </div>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field label="New password" hint="Leave blank to generate a secure temporary password automatically.">
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" autoFocus autoComplete="new-password" />
          </Field>
          {err && <p className="text-body font-medium text-rose-400">{err}</p>}
          <FormActions busy={busy} cancel={onClose} submitLabel="Reset password" />
        </form>
      )}
    </Modal>
  );
}

function UsersTab({ users, loading, error, roles, onRefresh, notify }: any) {
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<any | null>(null);
  const [resetUser, setResetUser] = useState<any | null>(null);
  const [deleteUser, setDeleteUser] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const filtered = (users ?? []).filter((u: any) => {
    const needle = q.trim().toLowerCase();
    const matchesQ = !needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle);
    const matchesRole = !roleFilter || u.roleId === roleFilter || u.roleName === roleFilter;
    const matchesStatus = !statusFilter || (statusFilter === "active" ? u.isActive : !u.isActive);
    return matchesQ && matchesRole && matchesStatus;
  });
  const changeRole = async (u: any, roleId: string) => {
    try {
      await apiFetch(`/control/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ roleId }) });
      notify(`${u.name} role updated`);
      onRefresh();
    } catch (e: any) {
      notify(e.message ?? "Role update failed");
    }
  };
  const toggleActive = async (u: any) => {
    try {
      await apiFetch(`/control/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !u.isActive }) });
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
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or email…"
              className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-body outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="!w-40">
            <option value="">All roles</option>
            {(roles ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-36">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
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
          <TableShell footer={<span className="text-meta text-muted-foreground">{filtered.length} users</span>}>
            <table className="w-full">
              <THead>
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Last login</Th>
                <Th>Joined</Th>
                <Th className="text-right">Actions</Th>
              </THead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8">
                      <EmptyState title="No users match these filters" hint="Try a different search, role or status." />
                    </td>
                  </tr>
                )}
                {filtered.map((u: any, i: number) => (
                  <Tr key={u.id} index={i}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{u.name}</p>
                          <p className="truncate text-micro text-muted-foreground">{u.email}</p>
                          {u.employee?.roleTitle && <p className="truncate text-micro text-muted-foreground">{u.employee.roleTitle}</p>}
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <Select value={u.roleId ?? ""} onChange={(e) => changeRole(u, e.target.value)} className="!w-32 !py-1 !text-meta">
                        {(roles ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </Select>
                    </Td>
                    <Td>
                      <button onClick={() => toggleActive(u)} title={u.isActive ? "Deactivate account" : "Activate account"} className="transition-opacity hover:opacity-80">
                        <StatusBadge status={u.isActive ? "ACTIVE" : "INACTIVE"} />
                      </button>
                    </Td>
                    <Td className="text-meta text-muted-foreground">
                      {u.lastLoginAt ? (
                        <span>
                          {formatDate(u.lastLoginAt)}
                          <span className="block text-micro">{timeAgo(u.lastLoginAt)}</span>
                        </span>
                      ) : "Never"}
                    </Td>
                    <Td className="text-meta text-muted-foreground">{formatDate(u.createdAt ?? null)}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <Btn variant="ghost" onClick={() => setEditUser(u)} title="Edit user"><Pencil className="size-3.5" /></Btn>
                        <Btn variant="ghost" onClick={() => setResetUser(u)} title="Reset password"><KeyRound className="size-3.5" /></Btn>
                        <Btn variant="ghost" onClick={() => toggleActive(u)} title={u.isActive ? "Deactivate" : "Activate"}><Power className="size-3.5" /></Btn>
                        <Btn variant="ghost" className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-400" onClick={() => setDeleteUser(u)} title="Delete user"><Trash2 className="size-3.5" /></Btn>
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
        <p className="text-body leading-relaxed text-muted-foreground">
          {deleteUser?.name} will permanently lose access to the workspace. Tasks, leads and other records they own stay
          in the system. This cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={() => setDeleteUser(null)} className="rounded-xl border border-border px-4 py-2 text-body font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">Cancel</button>
          <button onClick={removeUser} disabled={deleting} className="rounded-xl bg-rose-500 px-4 py-2 text-body font-bold text-white shadow-rose-500/30 transition-all hover:scale-[1.02] disabled:opacity-60">
            {deleting ? "Deleting…" : "Delete user"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function RoleModal({ open, onClose, role, onSaved, notify }: any) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setPerms(role?.modulePermissions ?? {});
    setErr(null);
  }, [open, role]);

  const isOwner = role?.name === "Owner";
  const perm = (m: string) => perms[m] ?? { view: false, edit: false, approve: false };
  const setPerm = (m: string, k: "view" | "edit" | "approve", v: boolean) => {
    const next = { ...perm(m), [k]: v };
    if (k === "view" && !v) {
      next.edit = false;
      next.approve = false;
    }
    if ((k === "edit" || k === "approve") && v) next.view = true;
    setPerms({ ...perms, [m]: next });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr("Role name is required");
    setBusy(true);
    setErr(null);
    try {
      const body: any = { name: name.trim(), description: description.trim() || null };
      // The Owner role cannot carry a permission matrix — sending one makes the
      // API reject the save. Only the description is editable for Owner.
      if (!isOwner) body.modulePermissions = perms;
      await apiFetch(role ? `/control/roles/${role.id}` : "/control/roles", {
        method: role ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      notify(role ? "Role updated" : "Role created");
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={role ? `Edit role — ${role.name}` : "Create role"} size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Role name">
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={isOwner} placeholder="e.g. Project Manager" autoFocus />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this role can do" />
          </Field>
        </div>

        {isOwner ? (
          <p className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-body text-primary">
            The Owner role always has full access to every module and cannot be edited.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60">
            <table className="w-full">
              <THead>
                <Th>Module</Th>
                <Th className="text-center">View</Th>
                <Th className="text-center">Edit</Th>
                <Th className="text-center">Approve</Th>
              </THead>
              <tbody>
                {MODULES.map((m, i) => {
                  const p = perm(m);
                  return (
                    <Tr key={m} index={i}>
                      <Td className="text-body font-medium">{label(m)}</Td>
                      {(["view", "edit", "approve"] as const).map((k) => (
                        <Td key={k} className="text-center">
                          <input
                            type="checkbox"
                            checked={!!p[k]}
                            onChange={(e) => setPerm(m, k, e.target.checked)}
                            className="size-3.5 accent-primary"
                          />
                        </Td>
                      ))}
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={role ? "Save role" : "Create role"} />
      </form>
    </Modal>
  );
}

function RolesTab({ roles, loading, error, onRetry, notify, onRefresh }: any) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await apiFetch(`/control/roles/${deleting.id}`, { method: "DELETE" });
      notify(`${deleting.name} deleted`);
      setDeleting(null);
      onRefresh();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Roles & permissions" subtitle="Control exactly which module each role can view, edit or approve" />
        <Btn variant="primary" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="size-3.5" /> New role
        </Btn>
      </div>
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
            {(roles ?? []).length === 0 && (
              <div className="md:col-span-2 xl:col-span-3">
                <EmptyState title="No roles yet" hint="Create your first role to control module access." />
              </div>
            )}
            {(roles ?? []).map((r: any) => (
              <CardShell key={r.id} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-heading text-section font-semibold">
                      {r.name}
                      {r.name === "Owner" && <ShieldCheck className="size-3.5 text-primary" />}
                    </p>
                    <p className="mt-0.5 text-meta text-muted-foreground">
                      {r.name === "Owner" ? "Full access to every module" : r.description || "No description"}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-meta font-semibold text-muted-foreground">{r._count?.users ?? 0} users</span>
                </div>

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
                              <Td className="text-body font-medium">{label(m)}</Td>
                              {["view", "edit", "approve"].map((k) => (
                                <Td key={k}><input type="checkbox" checked={!!p?.[k]} disabled className="size-3.5 accent-primary" /></Td>
                              ))}
                            </Tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-auto flex items-center gap-1.5">
                  <Btn variant="outline" onClick={() => { setEditing(r); setOpen(true); }}>
                    <Pencil className="size-3.5" /> Edit
                  </Btn>
                  {r.name !== "Owner" && (
                    <Btn variant="ghost" className="!text-rose-400 hover:bg-rose-500/10" onClick={() => setDeleting(r)}>
                      <Trash2 className="size-3.5" /> Delete
                    </Btn>
                  )}
                </div>
              </CardShell>
            ))}
          </div>
        </FadeIn>
      )}

      <RoleModal open={open} onClose={() => { setOpen(false); setEditing(null); }} role={editing} notify={notify} onSaved={onRefresh} />
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete role?">
        <p className="text-body leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">{deleting?.name}</span> will be removed. Roles that still have
          users assigned cannot be deleted.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={() => setDeleting(null)} className="rounded-xl border border-border px-4 py-2 text-body font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">Cancel</button>
          <button onClick={remove} disabled={busy} className="rounded-xl bg-rose-500 px-4 py-2 text-body font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-60">
            {busy ? "Deleting…" : "Delete role"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function IntegrationModal({ open, onClose, integration, onSaved, notify }: any) {
  const editing = !!integration;
  const [providerName, setProviderName] = useState("");
  const [type, setType] = useState("MESSAGING");
  const [rows, setRows] = useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProviderName(integration?.providerName ?? "");
    setType(integration?.type ?? "MESSAGING");
    setRows([{ key: "", value: "" }]);
    setErr(null);
  }, [open, integration]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!providerName.trim()) return setErr("Provider name is required");
    const credentials = Object.fromEntries(
      rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value])
    );
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(editing ? `/control/integrations/${integration.id}` : "/control/integrations", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          providerName: providerName.trim(),
          type,
          ...(Object.keys(credentials).length ? { credentials } : {}),
        }),
      });
      notify(editing ? "Integration updated" : "Integration added");
      onSaved();
      onClose();
    } catch (e2: any) {
      setErr(e2.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Configure ${integration?.providerName}` : "Add integration"} size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Provider name">
            <Input value={providerName} onChange={(e) => setProviderName(e.target.value)} placeholder="Slack / Stripe / Google Ads" autoFocus />
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {["ADS", "PAYMENT", "BANKING", "FX_RATE", "MESSAGING"].map((t) => (
                <option key={t} value={t}>{label(t)}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-body font-semibold">Credentials</p>
          <p className="text-meta text-muted-foreground">
            Stored encrypted (AES-256-GCM) and never returned by the API.
            {editing ? " Leave blank to keep the existing values." : ""}
          </p>
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={row.key}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
                placeholder="key (e.g. apiKey)"
                className="!w-44"
              />
              <Input
                value={row.value}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
                placeholder="value"
                type="password"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ key: "", value: "" }])}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                aria-label="Remove field"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <Btn type="button" variant="outline" className="!w-fit" onClick={() => setRows([...rows, { key: "", value: "" }])}>
            <Plus className="size-3.5" /> Add field
          </Btn>
        </div>

        {err && <p className="text-body font-medium text-rose-400">{err}</p>}
        <FormActions busy={busy} cancel={onClose} submitLabel={editing ? "Save integration" : "Add integration"} />
      </form>
    </Modal>
  );
}

function IntegrationsTab({ integrations, loading, error, onRefresh, notify }: any) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; item: any | null }>({ open: false, item: null });
  const [deleting, setDeleting] = useState<any | null>(null);

  const setStatus = async (i: any, status: string) => {
    if (status === "CONNECTED" && !i.hasCredentials) {
      notify("Add credentials before connecting this integration");
      setModal({ open: true, item: i });
      return;
    }
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

  const test = async (i: any) => {
    setBusyId(i.id);
    try {
      const r = await apiFetch<any>(`/control/integrations/${i.id}/test`, { method: "POST" });
      notify(r.message ?? (r.ok ? "Configuration looks valid" : "Test failed"));
      onRefresh();
    } catch (e: any) {
      notify(e.message ?? "Test failed");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await apiFetch(`/control/integrations/${deleting.id}`, { method: "DELETE" });
      notify(`${deleting.providerName} removed`);
      setDeleting(null);
      onRefresh();
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Integrations" subtitle="Connect ad platforms, payments, banking and messaging providers" />
        <Btn variant="primary" onClick={() => setModal({ open: true, item: null })}>
          <Plus className="size-3.5" /> Add integration
        </Btn>
      </div>
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
              <div key={i.id} className="card-lift flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <Plug className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-body-lg font-semibold">{i.providerName}</p>
                    <p className="truncate text-micro text-muted-foreground">
                      {label(i.type)}
                      {i.connectedBy?.name ? ` · connected by ${i.connectedBy.name}` : ""}
                      {i.connectedAt ? ` · ${timeAgo(i.connectedAt)}` : " · never connected"}
                    </p>
                    <p className="mt-0.5 text-micro font-semibold">
                      {i.hasCredentials ? (
                        <span className="text-emerald-500">{i.credentialKeys?.length ?? 0} credential field(s) stored</span>
                      ) : (
                        <span className="text-amber-500">No credentials configured</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={i.status} />
                  <Btn variant="ghost" onClick={() => test(i)} disabled={busyId === i.id}>
                    {busyId === i.id ? "Testing…" : "Test"}
                  </Btn>
                  <Btn variant="outline" onClick={() => setModal({ open: true, item: i })}>Configure</Btn>
                  <Btn variant={i.status === "CONNECTED" ? "outline" : "primary"} onClick={() => setStatus(i, i.status === "CONNECTED" ? "DISCONNECTED" : "CONNECTED")} className={busyId === i.id ? "opacity-50" : ""}>
                    {i.status === "CONNECTED" ? "Disconnect" : "Connect"}
                  </Btn>
                  <Btn variant="ghost" className="!text-rose-400 hover:bg-rose-500/10" onClick={() => setDeleting(i)} aria-label="Delete integration">
                    <Trash2 className="size-3.5" />
                  </Btn>
                </div>
              </div>
            ))}
            {(integrations ?? []).length === 0 && <EmptyState title="No integrations configured" hint="Add your first provider to sync data." />}
          </div>
        </FadeIn>
      )}

      <IntegrationModal
        open={modal.open}
        integration={modal.item}
        onClose={() => setModal({ open: false, item: null })}
        onSaved={onRefresh}
        notify={notify}
      />
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Remove integration?">
        <p className="text-body leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">{deleting?.providerName}</span> and its stored credentials will be removed.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={() => setDeleting(null)} className="rounded-xl border border-border px-4 py-2 text-body font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">Cancel</button>
          <button onClick={remove} disabled={busyId === deleting?.id} className="rounded-xl bg-rose-500 px-4 py-2 text-body font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-60">
            {busyId === deleting?.id ? "Removing…" : "Remove"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function WhatsappTab({ notify }: { notify: (m: string) => void }) {
  const [cfg, setCfg] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [secrets, setSecrets] = useState({ accessToken: "", appSecret: "", verifyToken: "" });
  const [sendTo, setSendTo] = useState("");
  const [sendTpl, setSendTpl] = useState("invoice_ready");
  const [sendParams, setSendParams] = useState("");
  const [sending, setSending] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const c = await apiFetch<any>("/control/whatsapp/config");
      setCfg(c);
    } catch (e: any) {
      notify(e.message ?? "Failed to load WhatsApp config");
    } finally {
      setLoading(false);
    }
  }, [notify]);
  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      setLogs(await apiFetch<any[]>("/control/whatsapp/logs?take=30"));
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    loadLogs();
  }, [load, loadLogs]);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const payload = { ...cfg, ...secrets };
      const updated = await apiFetch<any>("/control/whatsapp/config", { method: "PATCH", body: JSON.stringify(payload) });
      setCfg(updated);
      setSecrets({ accessToken: "", appSecret: "", verifyToken: "" });
      notify("WhatsApp settings saved");
    } catch (e: any) {
      notify(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };
  const testConn = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await apiFetch<any>("/control/whatsapp/test-connection", { method: "POST" });
      setTestResult(r.ok ? `Connected — ${r.detail}` : `Failed — ${r.detail}`);
    } catch (e: any) {
      setTestResult(`Failed — ${e.message ?? "error"}`);
    } finally {
      setTesting(false);
    }
  };
  const testSend = async () => {
    if (!sendTo.trim()) return notify("Enter a recipient phone number");
    setSending(true);
    try {
      const params = sendParams.split(",").map((s) => s.trim()).filter(Boolean);
      const r = await apiFetch<any>("/control/whatsapp/test-send", {
        method: "POST",
        body: JSON.stringify({ to: sendTo.trim(), templateName: sendTpl, params }),
      });
      notify(r.ok ? (r.mocked ? `Mock sent (wamid ${r.wamid})` : `Sent (wamid ${r.wamid})`) : `Failed — ${r.error}`);
      loadLogs();
    } catch (e: any) {
      notify(e.message ?? "Send failed");
    } finally {
      setSending(false);
    }
  };
  const simulate = async (wamid: string, status: "delivered" | "read" | "failed") => {
    try {
      await apiFetch("/control/whatsapp/simulate", { method: "POST", body: JSON.stringify({ wamid, status }) });
      notify(`Marked ${status}`);
      loadLogs();
    } catch (e: any) {
      notify(e.message ?? "Simulate failed");
    }
  };
  const runSweep = async () => {
    try {
      const r = await apiFetch<any>("/control/whatsapp/sweep", { method: "POST" });
      notify(r.ran ? `${r.sent ?? 0} reminder(s) sent` : "Sweep skipped (disabled)");
      loadLogs();
    } catch (e: any) {
      notify(e.message ?? "Sweep failed");
    }
  };
  const toggleTpl = async (t: any) => {
    try {
      await apiFetch(`/control/whatsapp/templates/${t.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !t.isActive }) });
      setCfg((c: any) => c && ({ ...c, templates: c.templates.map((x: any) => (x.id === t.id ? { ...x, isActive: !x.isActive } : x)) }));
    } catch (e: any) {
      notify(e.message ?? "Toggle failed");
    }
  };
  const setAuto = (k: string, v: boolean) =>
    setCfg((c: any) => c && ({ ...c, auto: { ...c.auto, [k]: v } }));

  if (loading || !cfg) {
    return (
      <div className="flex flex-col gap-2">
        {[...Array(3)].map((_, i) => <SkeletonBlock key={i} className="h-24" />)}
      </div>
    );
  }
  const AUTO_LABELS: [string, string][] = [
    ["invoiceSent", "Invoice issued → send invoice + link"],
    ["paymentReceived", "Payment recorded → send receipt"],
    ["dueToday", "Daily 9AM → due-today reminders"],
    ["overdue", "Daily 9AM → overdue nudges (1/2/final)"],
    ["taskAssigned", "Task assigned → notify team member"],
    ["taskClientUpdate", "Visible task done → notify client"],
  ];
  return (
    <div className="flex flex-col gap-4">
      <CardShell>
        <SectionTitle title="WhatsApp Cloud API" subtitle="Meta direct connection — credentials live here, never in code or env files" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Status">
            <Select value={cfg.enabled ? "on" : "off"} onChange={(e) => setCfg({ ...cfg, enabled: e.target.value === "on" })}>
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </Select>
          </Field>
          <Field label="Mode">
            <Select value={cfg.mode} onChange={(e) => setCfg({ ...cfg, mode: e.target.value })}>
              <option value="mock">Mock (log only — for testing)</option>
              <option value="live">Live (Meta Cloud API)</option>
            </Select>
          </Field>
          <Field label="Display number"><Input value={cfg.displayNumber ?? ""} onChange={(e) => setCfg({ ...cfg, displayNumber: e.target.value })} placeholder="+8801XXXXXXXXX" /></Field>
          <Field label="Default language">
            <Select value={cfg.defaultLanguage ?? "en"} onChange={(e) => setCfg({ ...cfg, defaultLanguage: e.target.value })}>
              <option value="en">English (en)</option>
              <option value="bn">Bangla (bn)</option>
            </Select>
          </Field>
          <Field label="Phone number ID"><Input value={cfg.phoneNumberId ?? ""} onChange={(e) => setCfg({ ...cfg, phoneNumberId: e.target.value })} placeholder="123456789012345" className="font-mono" /></Field>
          <Field label="WABA ID"><Input value={cfg.wabaId ?? ""} onChange={(e) => setCfg({ ...cfg, wabaId: e.target.value })} placeholder="987654321098765" className="font-mono" /></Field>
          <Field label={`Access token ${cfg.accessTokenSet ? "(set — leave blank to keep)" : "(permanent system-user token)"}`}>
            <Input type="password" value={secrets.accessToken} onChange={(e) => setSecrets({ ...secrets, accessToken: e.target.value })} placeholder={cfg.accessTokenSet ? "•••••••• (stored encrypted)" : "EAA…"} className="font-mono" />
          </Field>
          <Field label={`App secret ${cfg.appSecretSet ? "(set)" : "(for webhook signature)"}`}>
            <Input type="password" value={secrets.appSecret} onChange={(e) => setSecrets({ ...secrets, appSecret: e.target.value })} placeholder={cfg.appSecretSet ? "••••••••" : "Meta app secret"} className="font-mono" />
          </Field>
          <Field label={`Verify token ${cfg.verifyTokenSet ? "(set)" : "(you invent this)"}`}>
            <Input value={secrets.verifyToken} onChange={(e) => setSecrets({ ...secrets, verifyToken: e.target.value })} placeholder={cfg.verifyTokenSet ? "••••••••" : "any-random-string"} className="font-mono" />
          </Field>
          <Field label="Webhook URL (paste into Meta)">
            <Input value={`${typeof window !== "undefined" ? window.location.origin.replace(":3000", ":4000") : ""}/api/whatsapp/webhook`} readOnly className="font-mono" />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Btn variant="primary" onClick={save} className={saving ? "opacity-50" : ""}>{saving ? "Saving…" : "Save settings"}</Btn>
          <Btn variant="outline" onClick={testConn} className={testing ? "opacity-50" : ""}><Plug className="size-3.5" /> {testing ? "Testing…" : "Test connection"}</Btn>
          <Btn variant="outline" onClick={runSweep}>Run due sweep now</Btn>
          {testResult && <p className="w-full text-body text-muted-foreground">{testResult}</p>}
        </div>
      </CardShell>

      <CardShell>
        <SectionTitle title="Automation triggers" subtitle="Which events send WhatsApp automatically (dedupe + audit built in)" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {AUTO_LABELS.map(([k, lbl]) => (
            <label key={k} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2.5 text-body">
              <input type="checkbox" checked={!!cfg.auto?.[k]} onChange={(e) => setAuto(k, e.target.checked)} className="size-3.5 accent-primary" />
              {lbl}
            </label>
          ))}
        </div>
        <p className="mt-2 text-meta text-muted-foreground">Remember to press Save settings after changing triggers.</p>
      </CardShell>

      <CardShell>
        <SectionTitle title="Message templates" subtitle="Utility templates — same content must be approved on Meta before live mode" />
        <div className="flex flex-col gap-2">
          {(cfg.templates ?? []).map((t: any) => (
            <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2">
              <div className="min-w-0">
                <p className="font-mono text-body font-bold">{t.name} <span className="text-muted-foreground">· {t.language} · {t.category}</span></p>
                <p className="truncate text-meta text-muted-foreground">{t.bodyPreview}</p>
                <p className="text-micro text-muted-foreground">vars: {(t.variables ?? []).join(", ") || "—"}{t.metaStatus ? ` · Meta: ${t.metaStatus}` : ""}</p>
              </div>
              <button type="button" onClick={() => toggleTpl(t)} className={`shrink-0 rounded-full px-3 py-1 text-meta font-bold ${t.isActive ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"}`}>
                {t.isActive ? "ON" : "OFF"}
              </button>
            </div>
          ))}
        </div>
      </CardShell>

      <CardShell>
        <SectionTitle title="Test send (mock-friendly)" subtitle="Sends through the same pipeline — mock mode logs instead of calling Meta" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="To (phone)"><Input value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="01XXXXXXXXX" className="font-mono" /></Field>
          <Field label="Template">
            <Select value={sendTpl} onChange={(e) => setSendTpl(e.target.value)}>
              {(cfg.templates ?? []).filter((t: any) => t.isActive).map((t: any) => <option key={t.id} value={t.name}>{t.name} ({t.language})</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Params (comma-separated, in order)">
            <Input value={sendParams} onChange={(e) => setSendParams(e.target.value)} placeholder="Karim, ZLM-2026-0058, Bhau web, 225000, 2026-10-22, https://…" className="font-mono" />
          </Field>
        </div>
        <div className="mt-4">
          <Btn variant="primary" onClick={testSend} className={sending ? "opacity-50" : ""}>{sending ? "Sending…" : "Send test message"}</Btn>
        </div>
      </CardShell>

      <CardShell>
        <SectionTitle title="Message log" subtitle="Every send + delivery/read receipt lands here" />
        {logsLoading ? (
          <SkeletonBlock className="h-32" />
        ) : logs.length === 0 ? (
          <EmptyState title="No messages yet" hint="Test sends and automations will appear here." />
        ) : (
          <TableShell>
            <table className="w-full">
              <THead><Th>Time</Th><Th>To</Th><Th>Template</Th><Th>Status</Th><Th>wamid</Th><Th /></THead>
              <tbody>
                {logs.map((l: any) => (
                  <Tr key={l.id} index={0}>
                    <Td className="whitespace-nowrap text-muted-foreground">{timeAgo(l.createdAt)}</Td>
                    <Td className="font-mono">{l.to}</Td>
                    <Td className="font-mono">{l.templateName ?? l.messageType}</Td>
                    <Td><StatusBadge status={l.status} /></Td>
                    <Td className="max-w-[140px] truncate font-mono text-micro text-muted-foreground">{l.wamid ?? "—"}</Td>
                    <Td>
                      {cfg.mode === "mock" && l.wamid && ["sent", "queued"].includes(l.status) && (
                        <div className="flex gap-1">
                          <button type="button" onClick={() => simulate(l.wamid, "delivered")} className="rounded-md bg-muted px-2 py-0.5 text-micro font-bold hover:bg-muted/70">Delivered</button>
                          <button type="button" onClick={() => simulate(l.wamid, "read")} className="rounded-md bg-muted px-2 py-0.5 text-micro font-bold hover:bg-muted/70">Read</button>
                        </div>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </CardShell>
    </div>
  );
}

function csvCell(value: any): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadTextFile(content: string, type: string, filename: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function DataTab({ onRefresh, notify }: any) {
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  // ── audit filters ──
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [audit, setAudit] = useState<any | null>(null);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditErr, setAuditErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (action) p.set("action", action);
    if (entityType) p.set("entityType", entityType);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    return p.toString();
  }, [q, action, entityType, from, to, page, pageSize]);

  useEffect(() => {
    let cancelled = false;
    setAuditLoading(true);
    setAuditErr(null);
    apiFetch<any>(`/control/audit-logs?${params}`)
      .then((d) => !cancelled && setAudit(d))
      .catch((e) => !cancelled && setAuditErr(e.message))
      .finally(() => !cancelled && setAuditLoading(false));
    return () => {
      cancelled = true;
    };
  }, [params, tick]);

  const { data: health } = useRefetch<any>("/control/health", 0);

  const exportData = async () => {
    setExporting(true);
    try {
      const data = await apiFetch<any>("/control/export");
      downloadTextFile(JSON.stringify(data, null, 2), "application/json", `zoolyum-export-${new Date().toISOString().slice(0, 10)}.json`);
      notify(`Export downloaded (${data?.counts?.invoices ?? 0} invoices, ${data?.counts?.clients ?? 0} clients)`);
    } catch (e: any) {
      notify(e.message ?? "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const exportAudit = async () => {
    try {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (action) p.set("action", action);
      if (entityType) p.set("entityType", entityType);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      p.set("page", "1");
      p.set("pageSize", "1000");
      const d = await apiFetch<any>(`/control/audit-logs?${p.toString()}`);
      const header = ["timestamp", "actor", "actorEmail", "action", "entityType", "entityId"];
      const lines = [
        header.join(","),
        ...(d.rows ?? []).map((r: any) =>
          [r.timestamp, r.actor?.name ?? r.actorUserId ?? "", r.actor?.email ?? "", r.action, r.entityType, r.entityId]
            .map(csvCell)
            .join(",")
        ),
      ];
      downloadTextFile(lines.join("\n"), "text/csv", `audit-log-${new Date().toISOString().slice(0, 10)}.csv`);
      notify(`Audit log exported (${d.rows?.length ?? 0} rows)`);
    } catch (e: any) {
      notify(e.message ?? "Export failed");
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
      setTick((t) => t + 1);
    } catch (e: any) {
      notify(e.message ?? "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CardShell>
          <SectionTitle title="Backup" subtitle="Full JSON snapshot of business data — no passwords or secrets" />
          <div className="mb-3 grid grid-cols-2 gap-2">
            <HealthCard label="Clients" value={health?.counts?.clients ?? "—"} icon={<Building2 className="size-4" />} />
            <HealthCard label="Projects" value={health?.counts?.projects ?? "—"} icon={<Activity className="size-4" />} />
            <HealthCard label="Invoices" value={health?.counts?.invoices ?? "—"} icon={<FileText className="size-4" />} />
            <HealthCard label="Tasks" value={health?.counts?.tasks ?? "—"} icon={<ListChecks className="size-4" />} />
          </div>
          <Btn variant="primary" onClick={exportData} disabled={exporting}>
            <Download className="size-3.5" /> {exporting ? "Exporting…" : "Export all data"}
          </Btn>
        </CardShell>

        <CardShell>
          <SectionTitle title="Storage & system" subtitle="Uploads and audit volume for this workspace" />
          <div className="grid grid-cols-2 gap-2">
            <HealthCard label="Uploads" value={`${health?.storage?.uploadsMb ?? 0} MB`} icon={<HardDrive className="size-4" />} />
            <HealthCard label="Audit events" value={health?.counts?.auditEvents ?? "—"} icon={<ShieldCheck className="size-4" />} />
            <HealthCard label="Environment" value={health?.environment ?? "—"} icon={<Globe2 className="size-4" />} />
            <HealthCard label="Uptime" value={health?.uptimeSeconds ? `${Math.floor(health.uptimeSeconds / 3600)}h` : "—"} icon={<Server className="size-4" />} />
          </div>
        </CardShell>

        <CardShell className="border-rose-500/30">
          <SectionTitle title="Danger zone" subtitle="Irreversibly wipe every business record" />
          <p className="mb-3 flex items-start gap-2 text-meta leading-relaxed text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-rose-400" />
            Users, roles, settings, integrations and the audit trail are kept.
          </p>
          <Btn variant="outline" className="!text-rose-400 hover:bg-rose-500/10 hover:text-rose-400" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="size-3.5" /> Delete all data
          </Btn>
        </CardShell>
      </div>

      <CardShell>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle title="Audit trail" subtitle="Every security and configuration change, with actor and payload" />
          <div className="flex items-center gap-2">
            <Btn variant="ghost" onClick={() => setTick((t) => t + 1)} disabled={auditLoading}>
              <RefreshCw className={cn("size-3.5", auditLoading && "animate-spin")} /> Refresh
            </Btn>
            <Btn variant="outline" onClick={exportAudit}>
              <Download className="size-3.5" /> Export CSV
            </Btn>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Search action / entity / id…"
              className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-body outline-none focus:border-primary/40"
            />
          </div>
          <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
            <option value="">All actions</option>
            {(audit?.actions ?? []).map((a: string) => <option key={a} value={a}>{a}</option>)}
          </Select>
          <Select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
            <option value="">All entities</option>
            {(audit?.entityTypes ?? []).map((t: string) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>

        {auditErr ? (
          <p className="mt-3 text-body font-medium text-rose-400">{auditErr}</p>
        ) : auditLoading && !audit ? (
          <SkeletonBlock className="mt-3 h-40" />
        ) : (
          <>
            <div className="mt-3 overflow-hidden rounded-xl border border-border/60">
              <table className="w-full">
                <THead>
                  <Th>When</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>ID</Th>
                </THead>
                <tbody>
                  {(audit?.rows ?? []).length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8"><EmptyState title="No audit events match these filters" /></td></tr>
                  )}
                  {(audit?.rows ?? []).map((r: any, i: number) => (
                    <Tr key={r.id} index={i}>
                      <Td className="whitespace-nowrap text-meta text-muted-foreground">{formatDate(r.timestamp)} · {new Date(r.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</Td>
                      <Td className="text-body">
                        {r.actor ? (
                          <span>
                            <span className="font-medium">{r.actor.name}</span>
                            <span className="block text-micro text-muted-foreground">{r.actor.email}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">system</span>
                        )}
                      </Td>
                      <Td className="text-body font-medium">{r.action}</Td>
                      <Td className="text-meta text-muted-foreground">{r.entityType}</Td>
                      <Td className="max-w-[180px] truncate text-meta text-muted-foreground">{r.entityId}</Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-meta text-muted-foreground">
                {audit?.total ?? 0} event(s) · page {audit?.page ?? 1} of {audit?.pages ?? 1}
              </p>
              <div className="flex items-center gap-2">
                <Select value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="!w-24">
                  {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
                </Select>
                <Btn variant="outline" disabled={(audit?.page ?? 1) <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Btn>
                <Btn variant="outline" disabled={(audit?.page ?? 1) >= (audit?.pages ?? 1)} onClick={() => setPage((p) => p + 1)}>Next</Btn>
              </div>
            </div>
          </>
        )}
      </CardShell>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete all business data?">
        <div className="flex flex-col gap-4">
          <p className="text-body leading-relaxed text-muted-foreground">
            This permanently wipes all business records — clients, leads, projects, tasks, invoices, employees,
            expenses, payments and more. This action cannot be undone. Type{" "}
            <span className="font-bold text-rose-400">DELETE</span> to confirm.
          </p>
          <Field label="Confirmation">
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleteOpen(false)} className="rounded-xl border border-border px-4 py-2 text-body font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">Cancel</button>
            <button onClick={wipe} disabled={confirm !== "DELETE" || deleting} className="rounded-xl bg-rose-500 px-4 py-2 text-body font-bold text-white shadow-rose-500/30 transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50">
              {deleting ? "Deleting…" : "Delete everything"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ControlWorkspace() {
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
  const { data: stages, error: stagesError, loading: stagesLoading } = useRefetch<any[]>("/control/pipeline-stages", stagesRefresh);
  const { data: health } = useRefetch<any>("/control/health", 0);
  const reloadAll = () => {
    setUsersRefresh((r) => r + 1);
    setRolesRefresh((r) => r + 1);
    setIntegRefresh((r) => r + 1);
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
          className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-body font-medium text-white shadow-xl"
        >
          {flash}
        </motion.div>
      )}
      <PageHeader
        title="Control — Admin & Settings"
        subtitle="Workspace settings, users, roles, integrations and data management."
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/control/scoring"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-body font-semibold transition-colors hover:border-violet-400/60 hover:text-violet-500"
            >
              <HeartPulse className="size-3.5" /> Scoring engine
            </Link>
            <Segmented
              options={[
                { value: "settings", label: "Settings" },
                { value: "users", label: "Users" },
                { value: "roles", label: "Roles" },
                { value: "integrations", label: "Integrations" },
                { value: "whatsapp", label: "WhatsApp" },
                { value: "telegram", label: "Telegram" },
                { value: "data", label: "Data" },
              ]}
              value={tab}
              onChange={setTab}
            />
          </div>
        }
      />
      {/* While /control/health (and the roles/integrations lookups) resolve, show
          em dashes instead of zeros — "ROLES 0" read as a broken config
          (audit UX-25). aria-busy tells assistive tech why they are empty. */}
      <div
        aria-busy={!health || rolesLoading || integLoading}
        className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6"
      >
        <HealthCard label="API status" value={health ? (health.ok ? "Operational" : "Degraded") : "—"} tone={health ? (health.ok ? "text-emerald-500" : "text-rose-500") : undefined} icon={<Activity className="size-4" />} />
        <HealthCard label="Staff users" value={health?.counts ? `${health.counts.activeUsers ?? "—"} / ${health.counts.users ?? "—"}` : "—"} icon={<Users className="size-4" />} />
        <HealthCard label="Roles" value={roles ? roles.length : "—"} icon={<ShieldCheck className="size-4" />} />
        <HealthCard label="Integrations" value={integrations ? integrations.length : "—"} icon={<Plug className="size-4" />} />
        <HealthCard label="Audit events" value={health?.counts?.auditEvents ?? "—"} icon={<ListChecks className="size-4" />} />
        <HealthCard label="Maintenance" value={health ? (health.maintenanceMode ? "ON" : "Off") : "—"} tone={!health ? undefined : health.maintenanceMode ? "text-rose-500" : "text-emerald-500"} icon={<Server className="size-4" />} />
      </div>
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
      {tab === "roles" && <RolesTab roles={roles} loading={rolesLoading} error={rolesError} onRetry={() => setRolesRefresh((r) => r + 1)} notify={notify} onRefresh={() => setRolesRefresh((r) => r + 1)} />}
      {tab === "integrations" && <IntegrationsTab integrations={integrations ?? []} loading={integLoading} error={integError} onRefresh={() => setIntegRefresh((r) => r + 1)} notify={notify} />}
      {tab === "whatsapp" && <WhatsappTab notify={notify} />}
      {tab === "telegram" && <TelegramTab notify={notify} />}
      {tab === "data" && <DataTab onRefresh={reloadAll} notify={notify} />}
    </div>
  );
}
export default function ControlPage() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <SkeletonBlock className="h-24" />
        <SkeletonBlock className="h-64" />
      </div>
    );
  }
  const perms = user?.permissions;
  const allowed =
    user?.role === "Owner" ||
    user?.role === "CONTROL" ||
    perms?.CONTROL?.view === true;
  if (!allowed) {
    return (
      <CardShell>
        <EmptyState
          title="Admin access required"
          hint="Ask an Owner to grant your role Control access in Roles & permissions."
        />
      </CardShell>
    );
  }
  return <ControlWorkspace />;
}
