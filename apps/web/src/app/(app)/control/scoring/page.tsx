"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Check,
  Clock,
  Gauge,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { CardShell, EmptyState, FadeIn, PageHeader, SectionTitle, StatusBadge, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Input, Segmented, Select } from "@/components/ui";

type Tab = "client" | "project" | "overall" | "preview" | "history";
type Scope = "client" | "project";

const LEVEL_TONE: Record<string, string> = {
  GREEN: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  YELLOW: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  RED: "border-rose-500/30 bg-rose-500/10 text-rose-600",
};

export default function ScoringPage() {
  const [config, setConfig] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("client");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; error?: boolean } | null>(null);

  const notify = useCallback((text: string, error = false) => {
    setFlash({ text, error });
    setTimeout(() => setFlash(null), 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      const [cfg, ov] = await Promise.all([
        apiFetch<any>("/scoring/config"),
        apiFetch<any>("/scoring/overview"),
      ]);
      setConfig(cfg);
      setDraft(JSON.parse(JSON.stringify(cfg)));
      setOverview(ov);
    } catch (e: any) {
      notify(e?.message ?? "Could not load scoring config", true);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(
    () => !!config && !!draft && JSON.stringify(config) !== JSON.stringify(draft),
    [config, draft]
  );

  const patchProfile = (scope: Scope, patch: any) => {
    setDraft((d: any) => ({ ...d, [scope]: { ...d[scope], ...patch } }));
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await apiFetch<any>("/scoring/config", {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      setConfig(next);
      setDraft(JSON.parse(JSON.stringify(next)));
      notify("Scoring config saved. Recompute to apply it to existing scores.");
      apiFetch<any>("/scoring/overview").then(setOverview).catch(() => undefined);
    } catch (e: any) {
      notify(e?.message ?? "Save failed", true);
    } finally {
      setSaving(false);
    }
  };

  const runRecompute = async (scope: "clients" | "projects" | "all") => {
    setBusy(scope);
    try {
      const r = await apiFetch<any>("/scoring/recompute", {
        method: "POST",
        body: JSON.stringify({ scope }),
      });
      notify(
        r?.skipped
          ? r.reason ?? "A recompute was already running"
          : `Recomputed ${r.clients ?? 0} clients and ${r.projects ?? 0} projects in ${Math.round((r.tookMs ?? 0) / 1000)}s`
      );
      apiFetch<any>("/scoring/overview").then(setOverview).catch(() => undefined);
    } catch (e: any) {
      notify(e?.message ?? "Recompute failed", true);
    } finally {
      setBusy(null);
    }
  };

  const resetDefaults = async () => {
    if (!confirm("Restore the default scoring rules? Current weights, bands and overrides will be replaced.")) return;
    setSaving(true);
    try {
      const next = await apiFetch<any>("/scoring/config/reset", { method: "POST" });
      setConfig(next);
      setDraft(JSON.parse(JSON.stringify(next)));
      notify("Defaults restored.");
    } catch (e: any) {
      notify(e?.message ?? "Reset failed", true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-16">
      {flash && (
        <div
          className={cn(
            "fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-xl px-4 py-2.5 text-[12.5px] font-medium text-white shadow-xl",
            flash.error ? "bg-rose-600" : "bg-sidebar"
          )}
        >
          {flash.text}
        </div>
      )}

      <PageHeader
        title="Scoring engine"
        subtitle="How client health, project risk and the overall picture are calculated — every weight, threshold and rule is editable here."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/control"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[12px] font-semibold transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" /> Control
            </Link>
            <Btn variant="outline" onClick={resetDefaults} disabled={saving}>
              <RotateCcw className="size-3.5" /> Reset defaults
            </Btn>
            <Btn
              variant="outline"
              onClick={() => runRecompute("all")}
              disabled={!!busy || saving}
            >
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
              {busy ? "Recomputing…" : "Recompute all"}
            </Btn>
            <Btn variant="primary" onClick={save} disabled={!dirty || saving}>
              <Save className="size-3.5" /> {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </Btn>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi
          label="Avg client health"
          value={overview?.clients?.avg ?? "—"}
          hint={`${overview?.clients?.atRisk ?? 0} of ${overview?.clients?.total ?? 0} need attention`}
          tone={
            overview?.clients?.avg == null
              ? undefined
              : overview.clients.avg >= 70
                ? "text-emerald-500"
                : overview.clients.avg >= 40
                  ? "text-amber-500"
                  : "text-rose-500"
          }
          icon={<Gauge className="size-3.5" />}
        />
        <Kpi
          label="Avg project risk"
          value={overview?.projects?.avgRisk ?? "—"}
          hint={`${overview?.projects?.atRisk ?? 0} of ${overview?.projects?.total ?? 0} at risk or delayed`}
          tone={
            overview?.projects?.avgRisk == null
              ? undefined
              : overview.projects.avgRisk >= 55
                ? "text-rose-500"
                : overview.projects.avgRisk >= 30
                  ? "text-amber-500"
                  : "text-emerald-500"
          }
          icon={<BarChart3 className="size-3.5" />}
        />
        <Kpi
          label="Never scored"
          value={(overview?.clients?.neverScored ?? 0) + (overview?.projects?.neverScored ?? 0)}
          hint="Run a recompute to seed these"
          icon={<Sparkles className="size-3.5" />}
        />
        <Kpi
          label="Stale (>24h)"
          value={(overview?.clients?.stale ?? 0) + (overview?.projects?.stale ?? 0)}
          hint={overview?.lastRun ? `Last full run ${formatDate(overview.lastRun.at)}` : "Nightly run at 02:00"}
          icon={<Clock className="size-3.5" />}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          options={[
            { value: "client", label: "Client health" },
            { value: "project", label: "Project risk" },
            { value: "overall", label: "Overall" },
            { value: "preview", label: "Preview & what-if" },
            { value: "history", label: "History" },
          ]}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
        />
        <div className="flex items-center gap-2">
          <Btn variant="ghost" onClick={() => runRecompute("clients")} disabled={!!busy}>
            <RefreshCw className={cn("size-3.5", busy === "clients" && "animate-spin")} /> Clients
          </Btn>
          <Btn variant="ghost" onClick={() => runRecompute("projects")} disabled={!!busy}>
            <RefreshCw className={cn("size-3.5", busy === "projects" && "animate-spin")} /> Projects
          </Btn>
        </div>
      </div>

      {!draft ? (
        <CardShell>
          <div className="h-64 animate-pulse rounded-xl bg-muted/40" />
        </CardShell>
      ) : tab === "client" ? (
        <ProfileEditor
          scope="client"
          profile={draft.client}
          metrics={overview?.metricRegistry ?? {}}
          onChange={(patch) => patchProfile("client", patch)}
        />
      ) : tab === "project" ? (
        <ProfileEditor
          scope="project"
          profile={draft.project}
          metrics={overview?.metricRegistry ?? {}}
          onChange={(patch) => patchProfile("project", patch)}
        />
      ) : tab === "overall" ? (
        <OverallEditor
          overall={draft.overall}
          alerts={draft.alerts}
          onChange={(patch) => setDraft((d: any) => ({ ...d, ...patch }))}
        />
      ) : tab === "preview" ? (
        <PreviewTab draft={draft} dirty={dirty} notify={notify} />
      ) : (
        <HistoryTab
          notify={notify}
          onApplyWeights={(weights: Record<string, number>) =>
            patchProfile("client", {
              factors: draft.client.factors.map((f: any) => ({
                ...f,
                weight: weights[f.code] ?? f.weight,
              })),
            })
          }
        />
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className={cn("mt-1 text-xl font-heading font-semibold tabular-nums", tone)}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ── Profile editor ──────────────────────────────────────────────────────

function ProfileEditor({
  scope,
  profile,
  metrics,
  onChange,
}: {
  scope: Scope;
  profile: any;
  metrics: Record<string, any>;
  onChange: (patch: any) => void;
}) {
  const metricOptions = Object.entries(metrics).filter(([, m]: any) => m.scope === scope);
  const totalWeight = (profile.factors ?? [])
    .filter((f: any) => f.enabled)
    .reduce((s: number, f: any) => s + Number(f.weight ?? 0), 0);

  const patchFactor = (index: number, patch: any) => {
    const factors = profile.factors.map((f: any, i: number) => (i === index ? { ...f, ...patch } : f));
    onChange({ factors });
  };
  const removeFactor = (index: number) => {
    onChange({ factors: profile.factors.filter((_: any, i: number) => i !== index) });
  };
  const addFactor = () => {
    const unused = metricOptions.find(
      ([key]) => !profile.factors.some((f: any) => f.metric === key)
    );
    const metric = unused?.[0] ?? metricOptions[0]?.[0] ?? "";
    onChange({
      factors: [
        ...profile.factors,
        {
          code: `factor_${profile.factors.length + 1}`,
          label: unused?.[1]?.label ?? "New factor",
          weight: 0,
          enabled: true,
          metric,
          direction: "lowerBetter",
          type: "bands",
          bands: [
            { lte: 0, score: 100 },
            { lte: null, score: 0 },
          ],
          missing: "exclude",
          unit: unused?.[1]?.unit,
          showRaw: true,
        },
      ],
    });
  };

  return (
    <div className="space-y-4">
      <CardShell>
        <SectionTitle
          title={scope === "client" ? "Client health factors" : "Project risk factors"}
          subtitle={
            scope === "client"
              ? "Each signal is normalised to 0-100, then weighted. Missing data is dropped and the remaining weights are renormalised."
              : "Schedule, budget, progress and quality come from live data. PM confidence is the only manual input."
          }
          action={
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-bold",
                  Math.abs(totalWeight - 100) < 0.01
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-600"
                )}
              >
                {totalWeight}% allocated
              </span>
              <Btn variant="outline" onClick={addFactor}>
                <Plus className="size-3.5" /> Add factor
              </Btn>
            </div>
          }
        />

        <div className="space-y-3">
          {profile.factors.map((factor: any, index: number) => (
            <FactorCard
              key={`${factor.code}-${index}`}
              factor={factor}
              metricOptions={metricOptions}
              onPatch={(patch) => patchFactor(index, patch)}
              onRemove={() => removeFactor(index)}
            />
          ))}
          {!profile.factors.length && <EmptyState title="No factors yet" hint="Add at least one factor to score." />}
        </div>
      </CardShell>

      <BandsEditor
        bands={profile.bands ?? []}
        onChange={(bands) => onChange({ bands })}
        subtitle={
          scope === "client"
            ? "Turns the 0-100 client health score into a level, a label and a required action."
            : "Turns the 0-100 project health score into a level, a label and a required action (risk is 100 - score)."
        }
      />

      {scope === "client" && (
        <ProfilesEditor
          factors={profile.factors ?? []}
          profiles={profile.profiles ?? []}
          onChange={(profiles) => onChange({ profiles })}
        />
      )}

      <OverridesEditor
        overrides={profile.overrides ?? []}
        metricOptions={metricOptions}
        onChange={(overrides) => onChange({ overrides })}
      />
    </div>
  );
}

function FactorCard({
  factor,
  metricOptions,
  onPatch,
  onRemove,
}: {
  factor: any;
  metricOptions: [string, any][];
  onPatch: (patch: any) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const registry = metricOptions.find(([key]) => key === factor.metric)?.[1];

  const patchBand = (index: number, patch: any) => {
    const bands = (factor.bands ?? []).map((b: any, i: number) => (i === index ? { ...b, ...patch } : b));
    onPatch({ bands });
  };
  const removeBand = (index: number) => {
    onPatch({ bands: (factor.bands ?? []).filter((_: any, i: number) => i !== index) });
  };
  const addBand = () => {
    const bands = [...(factor.bands ?? [])];
    const catchAll = bands.findIndex((b: any) => b.lte === null);
    const next: any = { lte: catchAll === -1 ? 0 : null, score: 50 };
    if (catchAll === -1) bands.push(next);
    else bands.splice(catchAll, 0, next);
    onPatch({ bands });
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-3.5 transition-colors",
        factor.enabled ? "border-border/70 bg-background" : "border-border/40 bg-muted/20 opacity-70"
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={factor.enabled !== false}
            onChange={(e) => onPatch({ enabled: e.target.checked })}
            className="size-4 accent-violet-600"
          />
        </label>
        <Input
          value={factor.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          className="min-w-[150px] flex-1 !h-9 !text-[12.5px] !font-semibold"
          placeholder="Factor label"
        />
        <div className="flex items-center gap-1.5">
          <span className="text-[10.5px] font-medium uppercase text-muted-foreground">Weight</span>
          <Input
            type="number"
            min={0}
            max={100}
            value={factor.weight ?? 0}
            onChange={(e) => onPatch({ weight: Number(e.target.value) })}
            className="!h-9 !w-20 text-right tabular-nums"
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? "Hide rules" : "Rules"}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-lg border border-border px-2 py-1.5 text-muted-foreground transition-colors hover:border-rose-400/50 hover:text-rose-500"
          title="Remove factor"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono">{factor.metric || "no metric"}</span>
        {registry?.description && <span className="max-w-[520px] truncate">{registry.description}</span>}
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <Labeled label="Metric">
              <Select value={factor.metric} onChange={(e) => onPatch({ metric: e.target.value })}>
                {metricOptions.map(([key, m]) => (
                  <option key={key} value={key}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Labeled>
            <Labeled label="Direction">
              <Select value={factor.direction} onChange={(e) => onPatch({ direction: e.target.value })}>
                <option value="lowerBetter">Lower is better</option>
                <option value="higherBetter">Higher is better</option>
              </Select>
            </Labeled>
            <Labeled label="Normalisation">
              <Select value={factor.type} onChange={(e) => onPatch({ type: e.target.value })}>
                <option value="bands">Bands (recommended)</option>
                <option value="linear">Linear min/max</option>
              </Select>
            </Labeled>
            <Labeled label="Missing data">
              <Select value={factor.missing} onChange={(e) => onPatch({ missing: e.target.value })}>
                <option value="exclude">Exclude & renormalise</option>
                <option value="neutral">Neutral (50)</option>
                <option value="zero">Zero (harsh)</option>
              </Select>
            </Labeled>
          </div>

          {factor.type === "linear" ? (
            <div className="grid gap-2.5 sm:grid-cols-3">
              <Labeled label="Min">
                <Input type="number" value={factor.min ?? 0} onChange={(e) => onPatch({ min: Number(e.target.value) })} />
              </Labeled>
              <Labeled label="Max">
                <Input type="number" value={factor.max ?? 100} onChange={(e) => onPatch({ max: Number(e.target.value) })} />
              </Labeled>
              <Labeled label="Unit">
                <Input value={factor.unit ?? ""} onChange={(e) => onPatch({ unit: e.target.value })} />
              </Labeled>
            </div>
          ) : (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Score bands (first match wins)
                </p>
                <Btn variant="ghost" onClick={addBand}>
                  <Plus className="size-3" /> Band
                </Btn>
              </div>
              <div className="space-y-1.5">
                {(factor.bands ?? []).map((band: any, index: number) => (
                  <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 px-2.5 py-1.5">
                    <span className="text-[11.5px] font-medium">if value ≤</span>
                    {band.lte === null ? (
                      <span className="rounded-md border border-border bg-background px-2 py-1 text-[11.5px] font-semibold">
                        anything else
                      </span>
                    ) : (
                      <Input
                        type="number"
                        value={band.lte}
                        onChange={(e) => patchBand(index, { lte: Number(e.target.value) })}
                        className="!h-8 !w-24 text-right tabular-nums"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => patchBand(index, { lte: band.lte === null ? 0 : null })}
                      className="rounded-md border border-border px-1.5 py-1 text-[10.5px] font-semibold text-muted-foreground hover:text-foreground"
                    >
                      {band.lte === null ? "set value" : "∞ catch-all"}
                    </button>
                    <span className="text-[11.5px] font-medium">→</span>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={band.score}
                      onChange={(e) => patchBand(index, { score: Number(e.target.value) })}
                      className="!h-8 !w-20 text-right tabular-nums"
                    />
                    <span className="text-[11px] text-muted-foreground">pts</span>
                    <button
                      type="button"
                      onClick={() => removeBand(index)}
                      className="ml-auto text-muted-foreground hover:text-rose-500"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[10.5px] text-muted-foreground">
                Bands are matched from the smallest value upward; always keep one catch-all band.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function BandsEditor({ bands, onChange, subtitle }: { bands: any[]; onChange: (bands: any[]) => void; subtitle?: string }) {
  const patch = (index: number, p: any) => onChange(bands.map((b, i) => (i === index ? { ...b, ...p } : b)));
  const add = () => onChange([...bands, { min: 0, level: "GREEN", label: "New band", color: "#64748b", action: "" }]);
  return (
    <CardShell>
      <SectionTitle
        title="Score bands"
        subtitle={subtitle ?? "Turns the 0-100 score into a level, a label and a required action."}
        action={
          <Btn variant="outline" onClick={add}>
            <Plus className="size-3.5" /> Band
          </Btn>
        }
      />
      <div className="space-y-2">
        {[...bands]
          .sort((a, b) => Number(b.min) - Number(a.min))
          .map((band, index) => (
            <div key={index} className="grid gap-2 rounded-xl border border-border/60 bg-background p-2.5 lg:grid-cols-[90px_120px_1fr_1fr_36px]">
              <Labeled label="Min score">
                <Input type="number" min={0} max={100} value={band.min} onChange={(e) => patch(index, { min: Number(e.target.value) })} />
              </Labeled>
              <Labeled label="Level">
                <Select value={band.level} onChange={(e) => patch(index, { level: e.target.value })}>
                  <option value="GREEN">GREEN</option>
                  <option value="YELLOW">YELLOW</option>
                  <option value="RED">RED</option>
                </Select>
              </Labeled>
              <Labeled label="Label">
                <Input value={band.label} onChange={(e) => patch(index, { label: e.target.value })} />
              </Labeled>
              <Labeled label="Action when here">
                <Input value={band.action ?? ""} onChange={(e) => patch(index, { action: e.target.value })} placeholder="What the team must do" />
              </Labeled>
              <div className="flex items-end justify-center pb-2">
                <input
                  type="color"
                  value={band.color ?? "#64748b"}
                  onChange={(e) => patch(index, { color: e.target.value })}
                  className="size-8 cursor-pointer rounded-md border border-border bg-transparent"
                  title="Band colour"
                />
              </div>
            </div>
          ))}
      </div>
    </CardShell>
  );
}

function ProfilesEditor({
  factors,
  profiles,
  onChange,
}: {
  factors: any[];
  profiles: any[];
  onChange: (profiles: any[]) => void;
}) {
  const cycles = [
    { value: "MONTHLY_RETAINER", label: "Retainer" },
    { value: "PROJECT_BASED", label: "Project" },
    { value: "ONE_TIME", label: "One-time" },
  ];
  const patch = (index: number, p: any) => onChange(profiles.map((x, i) => (i === index ? { ...x, ...p } : x)));
  const patchCycle = (index: number, cycle: string, on: boolean) => {
    const current = profiles[index].match?.billingCycleType ?? [];
    patch(index, {
      match: {
        billingCycleType: on ? [...current, cycle] : current.filter((c: string) => c !== cycle),
      },
    });
  };
  const add = () =>
    onChange([
      ...profiles,
      {
        id: `profile-${Date.now()}`,
        label: "New segment",
        match: { billingCycleType: ["MONTHLY_RETAINER"] },
        weights: Object.fromEntries(
          factors.filter((f) => f.enabled).map((f) => [f.code, Number(f.weight ?? 0)])
        ),
      },
    ]);

  return (
    <CardShell>
      <SectionTitle
        title="Segment profiles"
        subtitle="Optional weight sets per billing cycle. The first matching profile wins; clients that match nothing use the base factors above."
        action={
          <Btn variant="outline" onClick={add}>
            <Plus className="size-3.5" /> Profile
          </Btn>
        }
      />
      <div className="space-y-2">
        {profiles.map((profile, index) => (
          <div key={profile.id ?? index} className="rounded-xl border border-border/60 bg-background p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={profile.label}
                onChange={(e) => patch(index, { label: e.target.value })}
                className="!h-9 min-w-[150px] flex-1 !text-[12.5px] !font-semibold"
                placeholder="Profile name"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                {cycles.map((c) => (
                  <label key={c.value} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[11px] font-medium">
                    <input
                      type="checkbox"
                      checked={(profile.match?.billingCycleType ?? []).includes(c.value)}
                      onChange={(e) => patchCycle(index, c.value, e.target.checked)}
                      className="size-3.5 accent-violet-600"
                    />
                    {c.label}
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onChange(profiles.filter((_, i) => i !== index))}
                className="text-muted-foreground hover:text-rose-500"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {factors
                .filter((f) => f.enabled)
                .map((f) => (
                  <Labeled key={f.code} label={f.label}>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={profile.weights?.[f.code] ?? f.weight ?? 0}
                      onChange={(e) =>
                        patch(index, { weights: { ...(profile.weights ?? {}), [f.code]: Number(e.target.value) } })
                      }
                      className="!h-8 text-right tabular-nums"
                    />
                  </Labeled>
                ))}
            </div>
          </div>
        ))}
        {!profiles.length && (
          <EmptyState title="No segment profiles" hint="Base factors apply to every client until you add one." />
        )}
      </div>
    </CardShell>
  );
}

function OverallEditor({
  overall,
  alerts,
  onChange,
}: {
  overall: any;
  alerts: any;
  onChange: (patch: any) => void;
}) {
  const components = overall?.components ?? [];
  const patchComponent = (index: number, p: any) =>
    onChange({ overall: { ...overall, components: components.map((c: any, i: number) => (i === index ? { ...c, ...p } : c)) } });
  const total = components.filter((c: any) => c.enabled).reduce((s: number, c: any) => s + Number(c.weight ?? 0), 0);
  const patchAlerts = (p: any) => onChange({ alerts: { ...alerts, ...p } });
  const patchPolicy = (scope: "client" | "project", p: any) =>
    patchAlerts({ [scope]: { ...(alerts?.[scope] ?? {}), ...p } });

  const policyRow = (scope: "client" | "project", title: string, hint: string) => {
    const policy = alerts?.[scope] ?? { levels: [], roles: [] };
    return (
      <div className="rounded-xl border border-border/60 bg-background p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[12px] font-semibold">{title}</p>
            <p className="text-[11px] text-muted-foreground">{hint}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {["YELLOW", "RED"].map((level) => (
              <label key={level} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[11px] font-medium">
                <input
                  type="checkbox"
                  checked={(policy.levels ?? []).includes(level)}
                  onChange={(e) =>
                    patchPolicy(scope, {
                      levels: e.target.checked
                        ? [...(policy.levels ?? []), level]
                        : (policy.levels ?? []).filter((l: string) => l !== level),
                    })
                  }
                  className="size-3.5 accent-violet-600"
                />
                {level}
              </label>
            ))}
          </div>
        </div>
        <div className="mt-2">
          <Labeled label="Notify roles (comma separated)">
            <Input
              value={(policy.roles ?? []).join(", ")}
              onChange={(e) =>
                patchPolicy(scope, {
                  roles: e.target.value.split(",").map((r: string) => r.trim()).filter(Boolean),
                })
              }
              placeholder="Owner, PM"
            />
          </Labeled>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <CardShell>
        <SectionTitle
          title="Overall business score"
          subtitle="The dashboard's single health number. Values come from finance, delivery, people and client health; only their weights live here."
          action={
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-bold",
                Math.abs(total - 100) < 0.01
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-600"
              )}
            >
              {total}% allocated
            </span>
          }
        />
        <div className="space-y-2">
          {components.map((component: any, index: number) => (
            <div key={component.key} className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border/60 bg-background px-3 py-2">
              <input
                type="checkbox"
                checked={component.enabled !== false}
                onChange={(e) => patchComponent(index, { enabled: e.target.checked })}
                className="size-4 accent-violet-600"
              />
              <span className="flex-1 text-[12.5px] font-semibold">{component.label}</span>
              <span className="font-mono text-[10.5px] text-muted-foreground">{component.key}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10.5px] font-medium uppercase text-muted-foreground">Weight</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={component.weight ?? 0}
                  onChange={(e) => patchComponent(index, { weight: Number(e.target.value) })}
                  className="!h-8 !w-20 text-right tabular-nums"
                />
              </div>
            </div>
          ))}
        </div>
      </CardShell>

      <BandsEditor
        bands={overall?.bands ?? []}
        onChange={(bands) => onChange({ overall: { ...overall, bands } })}
        subtitle="Maps the overall score to Healthy / Watch / At risk and the action leadership must take."
      />

      <CardShell>
        <SectionTitle
          title="Score alerts"
          subtitle="Notify the chosen roles when a score worsens into a band. Only a downgrade fires — the nightly recompute will not re-alert a client that is already red."
          action={
            <div className="flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-[11.5px] font-medium">
                <input
                  type="checkbox"
                  checked={alerts?.notifyImprovements !== false}
                  onChange={(e) => patchAlerts({ notifyImprovements: e.target.checked })}
                  className="size-4 accent-violet-600"
                />
                Also on recovery
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-[11.5px] font-medium">
                <input
                  type="checkbox"
                  checked={alerts?.enabled !== false}
                  onChange={(e) => patchAlerts({ enabled: e.target.checked })}
                  className="size-4 accent-violet-600"
                />
                Alerts on
              </label>
            </div>
          }
        />
        <div className="grid gap-2 lg:grid-cols-2">
          {policyRow("client", "Client downgrades", "Fires when a client moves into the selected levels.")}
          {policyRow("project", "Project downgrades", "Fires when a project moves into the selected levels.")}
        </div>
      </CardShell>
    </div>
  );
}

function OverridesEditor({
  overrides,
  metricOptions,
  onChange,
}: {
  overrides: any[];
  metricOptions: [string, any][];
  onChange: (overrides: any[]) => void;
}) {
  const patch = (index: number, p: any) =>
    onChange(overrides.map((o, i) => (i === index ? { ...o, ...p } : o)));
  const add = () =>
    onChange([
      ...overrides,
      {
        id: `rule-${Date.now()}`,
        label: "",
        enabled: true,
        metric: metricOptions[0]?.[0] ?? "",
        op: "gte",
        value: 0,
        action: "cap",
        level: "RED",
        note: "",
      },
    ]);

  return (
    <CardShell>
      <SectionTitle
        title="Override rules"
        subtitle="Hard rules that run after the weighted score. `Cap` stops a client being better than a level; `set` forces it. This is how you stop averages hiding a cliff."
        action={
          <Btn variant="outline" onClick={add}>
            <Plus className="size-3.5" /> Rule
          </Btn>
        }
      />
      <div className="space-y-2">
        {overrides.map((rule, index) => (
          <div
            key={rule.id ?? index}
            className={cn(
              "grid gap-2 rounded-xl border border-border/60 bg-background p-2.5",
              "lg:grid-cols-[24px_1fr_90px_90px_110px_95px_120px_36px]"
            )}
          >
            <div className="flex items-end pb-2">
              <input
                type="checkbox"
                checked={rule.enabled !== false}
                onChange={(e) => patch(index, { enabled: e.target.checked })}
                className="size-4 accent-violet-600"
              />
            </div>
            <Labeled label="Metric">
              <Select value={rule.metric} onChange={(e) => patch(index, { metric: e.target.value })}>
                {metricOptions.map(([key, m]) => (
                  <option key={key} value={key}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Labeled>
            <Labeled label="Operator">
              <Select value={rule.op} onChange={(e) => patch(index, { op: e.target.value })}>
                <option value="gte">≥</option>
                <option value="gt">&gt;</option>
                <option value="lte">≤</option>
                <option value="lt">&lt;</option>
                <option value="eq">=</option>
              </Select>
            </Labeled>
            <Labeled label="Value">
              <Input type="number" value={rule.value} onChange={(e) => patch(index, { value: Number(e.target.value) })} />
            </Labeled>
            <Labeled label="Then">
              <Select value={rule.action} onChange={(e) => patch(index, { action: e.target.value })}>
                <option value="cap">Cap at</option>
                <option value="set">Set to</option>
              </Select>
            </Labeled>
            <Labeled label="Level">
              <Select value={rule.level} onChange={(e) => patch(index, { level: e.target.value })}>
                <option value="GREEN">GREEN</option>
                <option value="YELLOW">YELLOW</option>
                <option value="RED">RED</option>
              </Select>
            </Labeled>
            <Labeled label="Reason shown">
              <Input value={rule.note ?? rule.label ?? ""} onChange={(e) => patch(index, { note: e.target.value })} placeholder="Why this fired" />
            </Labeled>
            <div className="flex items-end justify-center pb-2">
              <button
                type="button"
                onClick={() => onChange(overrides.filter((_, i) => i !== index))}
                className="text-muted-foreground hover:text-rose-500"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
        {!overrides.length && <EmptyState title="No override rules" hint="Add one to escalate a specific cliff automatically." />}
      </div>
    </CardShell>
  );
}

// ── Preview ─────────────────────────────────────────────────────────────

function PreviewTab({ draft, dirty, notify }: { draft: any; dirty: boolean; notify: (t: string, e?: boolean) => void }) {
  const [subjects, setSubjects] = useState<any>(null);
  const [scope, setScope] = useState<Scope>("client");
  const [id, setId] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<any>("/scoring/subjects")
      .then((s) => {
        setSubjects(s);
        const first = s.clients?.[0]?.id;
        if (first) setId(first);
      })
      .catch((e) => notify(e?.message ?? "Could not load subjects", true));
  }, [notify]);

  const options = scope === "client" ? subjects?.clients ?? [] : subjects?.projects ?? [];

  const run = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const path = scope === "client" ? `/scoring/clients/${id}/preview` : `/scoring/projects/${id}/preview`;
      const r = await apiFetch<any>(path, { method: "POST", body: JSON.stringify({ config: draft }) });
      setResult(r);
    } catch (e: any) {
      notify(e?.message ?? "Preview failed", true);
    } finally {
      setLoading(false);
    }
  }, [draft, id, notify, scope]);

  useEffect(() => {
    if (id) run();
  }, [id, scope, run]);

  const switchScope = (next: Scope) => {
    setScope(next);
    const first = next === "client" ? subjects?.clients?.[0]?.id : subjects?.projects?.[0]?.id;
    setId(first ?? "");
    setResult(null);
  };

  return (
    <div className="space-y-4">
      <CardShell>
        <SectionTitle
          title="Preview against real data"
          subtitle="Runs the draft config (your unsaved edits included) against a real client or project. Nothing is saved."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                options={[
                  { value: "client", label: "Client" },
                  { value: "project", label: "Project" },
                ]}
                value={scope}
                onChange={(v) => switchScope(v as Scope)}
              />
              <Select value={id} onChange={(e) => setId(e.target.value)} className="!w-64">
                <option value="">Select…</option>
                {options.map((o: any) => (
                  <option key={o.id} value={o.id}>
                    {scope === "client" ? o.companyName : `${o.name}${o.client?.companyName ? ` — ${o.client.companyName}` : ""}`}
                  </option>
                ))}
              </Select>
              <Btn variant="outline" onClick={run} disabled={!id || loading}>
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> Run
              </Btn>
            </div>
          }
        />
        {dirty && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11.5px] font-medium text-amber-700">
            Previewing unsaved changes — save when the numbers look right.
          </div>
        )}
      </CardShell>

      {result && <ScoreCard result={result} scope={scope} />}
    </div>
  );
}

function ScoreCard({ result, scope }: { result: any; scope: Scope }) {
  if (result?.skipped) {
    return (
      <CardShell>
        <EmptyState title="Scoring is disabled for this scope" hint="Enable it in the factor editor." />
      </CardShell>
    );
  }
  const levelTone = LEVEL_TONE[result.level] ?? "border-border bg-muted text-muted-foreground";
  const score = scope === "client" ? result.score : 100 - (result.riskScore ?? 100 - result.score);
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <CardShell>
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {scope === "client" ? "Health score" : "Project health"}
          </p>
          <span className={cn("rounded-full border px-2 py-0.5 text-[10.5px] font-bold", levelTone)}>
            {result.level}
          </span>
        </div>
        <p className="mt-3 text-5xl font-heading font-semibold tabular-nums">{score}</p>
        <p className="mt-1 text-[12px] font-medium text-muted-foreground">
          {result.band?.label}
          {scope === "project" && ` · risk ${result.riskScore ?? 100 - result.score}`}
        </p>
        <div className="mt-4 space-y-2 text-[11.5px]">
          <Row label="Data coverage" value={`${result.coverage}%`} />
          <Row label="Weight used" value={`${result.breakdown.filter((b: any) => b.subScore !== null).reduce((s: number, b: any) => s + b.weight, 0)}%`} />
          <Row label="Override rules" value={result.overridden ? "fired" : "none"} tone={result.overridden ? "text-rose-500" : undefined} />
          <Row label="Computed" value={formatDate(result.computedAt)} />
        </div>
        {result.band?.action && (
          <div className="mt-4 rounded-xl bg-muted/40 p-3 text-[11.5px]">
            <p className="font-bold uppercase tracking-wide text-muted-foreground">Required action</p>
            <p className="mt-1">{result.band.action}</p>
          </div>
        )}
      </CardShell>

      <CardShell>
        <SectionTitle title="Why this score" subtitle={result.driverSummary} />
        <div className="space-y-2.5">
          {result.breakdown.map((factor: any) => (
            <div key={factor.code}>
              <div className="mb-1 flex items-center justify-between gap-2 text-[11.5px]">
                <span className="flex items-center gap-1.5 font-semibold">
                  {factor.label}
                  <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                    {factor.weight}%
                  </span>
                </span>
                <span className="flex items-center gap-2 tabular-nums">
                  {factor.raw !== null && (
                    <span className="text-muted-foreground">
                      {Math.round(factor.raw * 10) / 10}
                      {factor.unit ? ` ${factor.unit}` : ""}
                    </span>
                  )}
                  <span
                    className={cn(
                      "font-bold",
                      factor.status === "good"
                        ? "text-emerald-500"
                        : factor.status === "warn"
                          ? "text-amber-500"
                          : factor.status === "bad"
                            ? "text-rose-500"
                            : "text-muted-foreground"
                    )}
                  >
                    {factor.subScore === null ? "no data" : `${factor.subScore}/100`}
                  </span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    factor.status === "good"
                      ? "bg-emerald-500"
                      : factor.status === "warn"
                        ? "bg-amber-500"
                        : factor.status === "bad"
                          ? "bg-rose-500"
                          : "bg-muted-foreground/30"
                  )}
                  style={{ width: `${factor.subScore ?? 0}%` }}
                />
              </div>
              <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
                <span>contributes {factor.contribution} pts</span>
                <span>{factor.metric}</span>
              </div>
            </div>
          ))}
        </div>
        {result.overrideNotes?.length > 0 && (
          <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-[11.5px] text-rose-700">
            <p className="font-bold uppercase tracking-wide">Override rules fired</p>
            <ul className="mt-1 list-disc pl-4">
              {result.overrideNotes.map((note: string, i: number) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </div>
        )}
      </CardShell>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular-nums", tone)}>{value}</span>
    </div>
  );
}

// ── History ─────────────────────────────────────────────────────────────

function HistoryTab({
  notify,
  onApplyWeights,
}: {
  notify: (t: string, e?: boolean) => void;
  onApplyWeights: (weights: Record<string, number>) => void;
}) {
  const [subjects, setSubjects] = useState<any>(null);
  const [scope, setScope] = useState<Scope>("client");
  const [id, setId] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [forecast, setForecast] = useState<any>(null);

  useEffect(() => {
    apiFetch<any>("/scoring/subjects")
      .then((s) => {
        setSubjects(s);
        if (s.clients?.[0]) setId(s.clients[0].id);
      })
      .catch((e) => notify(e?.message ?? "Could not load subjects", true));
  }, [notify]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    const path = scope === "client" ? `/scoring/clients/${id}/history?take=60` : `/scoring/projects/${id}/history?take=60`;
    apiFetch<any[]>(path)
      .then(setRows)
      .catch((e) => notify(e?.message ?? "Could not load history", true))
      .finally(() => setLoading(false));
  }, [id, scope, notify]);

  useEffect(() => {
    if (!id) return;
    setForecast(null);
    apiFetch<any>(`/scoring/forecast?scope=${scope}&id=${id}&points=8`)
      .then(setForecast)
      .catch(() => setForecast(null));
  }, [id, scope]);

  const switchScope = (next: Scope) => {
    setScope(next);
    const first = next === "client" ? subjects?.clients?.[0]?.id : subjects?.projects?.[0]?.id;
    setId(first ?? "");
    setRows([]);
  };

  const options = scope === "client" ? subjects?.clients ?? [] : subjects?.projects ?? [];
  const values = rows.map((r) => (scope === "client" ? r.score : 100 - r.riskScore));
  const max = Math.max(100, ...values);
  const min = Math.min(0, ...values);

  return (
    <div className="space-y-4">
      <CardShell>
        <SectionTitle
          title="Score history"
          subtitle="A snapshot is written only when the score actually changes, so this is the real trend — not noise."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                options={[
                  { value: "client", label: "Client" },
                  { value: "project", label: "Project" },
                ]}
                value={scope}
                onChange={(v) => switchScope(v as Scope)}
              />
              <Select value={id} onChange={(e) => setId(e.target.value)} className="!w-64">
                <option value="">Select…</option>
                {options.map((o: any) => (
                  <option key={o.id} value={o.id}>
                    {scope === "client" ? o.companyName : `${o.name}${o.client?.companyName ? ` — ${o.client.companyName}` : ""}`}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
        {loading ? (
          <div className="h-40 animate-pulse rounded-xl bg-muted/40" />
        ) : !rows.length ? (
          <EmptyState title="No history yet" hint="Run a recompute to write the first snapshot." />
        ) : (
          <>
            <div className="mb-4 flex h-28 items-end gap-1 rounded-xl border border-border/60 bg-background p-2">
              {[...rows].reverse().map((r, i) => {
                const value = scope === "client" ? r.score : 100 - r.riskScore;
                const height = Math.max(4, ((value - min) / Math.max(1, max - min)) * 100);
                const tone = value >= 70 ? "bg-emerald-500" : value >= 40 ? "bg-amber-500" : "bg-rose-500";
                return (
                  <div
                    key={r.id ?? i}
                    className={cn("flex-1 rounded-t-sm", tone)}
                    style={{ height: `${height}%` }}
                    title={`${value} — ${formatDate(scope === "client" ? r.recordedAt : r.calculatedAt)}`}
                  />
                );
              })}
            </div>
            {forecast && !forecast.insufficient && (
              <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-[11.5px]">
                <span className="font-semibold">
                  Trend{" "}
                  <span
                    className={cn(
                      forecast.direction === "improving"
                        ? "text-emerald-500"
                        : forecast.direction === "declining"
                          ? "text-rose-500"
                          : "text-muted-foreground"
                    )}
                  >
                    {forecast.slopePerWeek > 0 ? "+" : ""}
                    {forecast.slopePerWeek} pts/week
                  </span>
                </span>
                <span className="text-muted-foreground">
                  4 weeks → <b className="text-foreground">{forecast.projected}</b> ({forecast.projectedLabel})
                </span>
                {forecast.crossing && (
                  <span className="text-muted-foreground">
                    crosses {forecast.crossing.at} in ~{forecast.crossing.weeks}w
                  </span>
                )}
                <span className="ml-auto text-muted-foreground">fit R² {forecast.r2}</span>
              </div>
            )}
            {forecast?.insufficient && (
              <p className="mb-4 text-[11px] text-muted-foreground">
                Need at least two snapshots to forecast a trend.
              </p>
            )}
            <div className="divide-y divide-border/60">
              {rows.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12px]">
                  <span className="tabular-nums text-muted-foreground">
                    {formatDate(scope === "client" ? r.recordedAt : r.calculatedAt)}
                  </span>
                  <span className="flex-1 px-3 text-muted-foreground">{r.driverSummary ?? r.primaryDriver ?? "—"}</span>
                  <span className="flex items-center gap-2">
                    {r.level && <StatusBadge status={r.level} />}
                    <span className="font-bold tabular-nums">
                      {scope === "client" ? r.score : `risk ${r.riskScore}`}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardShell>
      <BacktestCard notify={notify} onApplyWeights={onApplyWeights} />
    </div>
  );
}

function BacktestCard({
  notify,
  onApplyWeights,
}: {
  notify: (t: string, e?: boolean) => void;
  onApplyWeights: (weights: Record<string, number>) => void;
}) {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [calibration, setCalibration] = useState<any>(null);
  const [calibrating, setCalibrating] = useState(false);

  useEffect(() => {
    setLoading(true);
    setCalibration(null);
    apiFetch<any>(`/scoring/backtest?days=${days}`)
      .then(setData)
      .catch((e) => notify(e?.message ?? "Backtest failed", true))
      .finally(() => setLoading(false));
  }, [days, notify]);

  const runCalibration = async () => {
    setCalibrating(true);
    try {
      setCalibration(await apiFetch<any>(`/scoring/calibrate?days=${days}`));
    } catch (e: any) {
      notify(e?.message ?? "Calibration failed", true);
    } finally {
      setCalibrating(false);
    }
  };

  const metric = (label: string, value: number | null, hint: string, tone?: string, suffix = "%") => (
    <div className="rounded-xl border border-border/60 bg-background px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-lg font-heading font-semibold tabular-nums", tone)}>
        {value == null ? "—" : `${value}${suffix}`}
      </p>
      <p className="text-[10.5px] text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <CardShell className="mt-4">
      <SectionTitle
        title="Outcome validation"
        subtitle="Does the score actually predict churn? Each client's score at the cutoff is compared with what happened afterwards — no look-ahead."
        action={
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="!w-40">
            <option value="30">30 days ago</option>
            <option value="60">60 days ago</option>
            <option value="90">90 days ago</option>
            <option value="180">180 days ago</option>
          </Select>
        }
      />
      {loading && !data ? (
        <div className="h-32 animate-pulse rounded-xl bg-muted/40" />
      ) : !data || data.sample === 0 ? (
        <EmptyState
          title="Not enough history yet"
          hint="The backtest needs snapshots older than the cutoff. Keep the nightly recompute running."
        />
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {metric("Catch rate", data.catchRate, `Of ${data.churned} churned, how many were amber/red`, "text-emerald-500")}
            {metric("False alarms", data.falseAlarmRate, `Of ${data.retained} retained, how many were flagged`, "text-amber-500")}
            {metric("Precision", data.precision, "Of everyone flagged, how many actually churned")}
            {metric("Sample", data.sample == null ? null : data.sample, `clients with a snapshot ${days} days ago`, undefined, "")}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            A useful score catches 80%+ of churners at the cost of a tolerable false-alarm rate. If both numbers
            are low, the weights are not reading your data; adjust them and re-run.
          </p>
          {data.surprises?.length > 0 && (
            <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-[11.5px] text-rose-700">
              <p className="font-bold uppercase tracking-wide">Churned while green — investigate these</p>
              <ul className="mt-1 list-disc pl-4">
                {data.surprises.map((s: any) => (
                  <li key={s.id}>
                    {s.companyName} — {s.thenScore}/100 on {formatDate(s.thenDate)} ({s.churnSignal})
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 divide-y divide-border/60">
            {data.rows.slice(0, 40).map((r: any) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[11.5px]">
                <span className="min-w-[140px] font-medium">{r.companyName}</span>
                <span className="tabular-nums text-muted-foreground">
                  {r.thenScore}/100 · {formatDate(r.thenDate)}
                </span>
                <span className="flex items-center gap-2">
                  {r.thenLevel && <StatusBadge status={r.thenLevel} />}
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize",
                      r.churned
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-500"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                    )}
                  >
                    {r.outcome}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-border/60 bg-muted/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Weight calibration
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Which factors actually separated churned from retained clients at the cutoff.
                </p>
              </div>
              <Btn variant="outline" onClick={runCalibration} disabled={calibrating}>
                {calibrating ? <RefreshCw className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                {calibrating ? "Analysing…" : "Analyse factors"}
              </Btn>
            </div>

            {calibration?.caveat && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700">
                {calibration.caveat}
              </p>
            )}
            {calibration && !calibration.reliable && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700">
                Only {calibration.churned} churned / {calibration.retained} retained with breakdown snapshots.
                Treat this as a hint, not a verdict.
              </p>
            )}

            {calibration && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="pb-1.5 font-bold">Factor</th>
                      <th className="pb-1.5 text-right font-bold">Churned</th>
                      <th className="pb-1.5 text-right font-bold">Retained</th>
                      <th className="pb-1.5 text-right font-bold">Gap</th>
                      <th className="pb-1.5 text-right font-bold">Now</th>
                      <th className="pb-1.5 text-right font-bold">Suggested</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {calibration.rows.map((r: any) => (
                      <tr key={r.code}>
                        <td className="py-1.5 font-medium">{r.label}</td>
                        <td className="py-1.5 text-right tabular-nums">{r.meanChurned ?? "—"}</td>
                        <td className="py-1.5 text-right tabular-nums">{r.meanRetained ?? "—"}</td>
                        <td className="py-1.5 text-right tabular-nums font-semibold">{r.separation ?? "—"}</td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">{r.currentWeight}%</td>
                        <td className="py-1.5 text-right tabular-nums font-bold text-violet-500">{r.suggestedWeight}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10.5px] text-muted-foreground">
                    Suggested weights are proportional to the gap. Applying only edits the draft — save when it looks right.
                  </p>
                  <Btn
                    variant="outline"
                    onClick={() => {
                      const weights = Object.fromEntries(
                        calibration.rows.map((r: any) => [r.code, r.suggestedWeight])
                      );
                      onApplyWeights(weights);
                      notify("Suggested weights applied to the draft");
                    }}
                  >
                    <Check className="size-3.5" /> Apply to draft
                  </Btn>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </CardShell>
  );
}
