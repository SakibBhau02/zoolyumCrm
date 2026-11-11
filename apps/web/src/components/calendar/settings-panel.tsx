"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn, CardShell, SectionTitle } from "@/components/shared";
import { Btn } from "@/components/table";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { CalendarClient, PLATFORMS, PLATFORM_LABEL, label } from "./types";

export function SettingsPanel({
  clients,
  onNewCampaign,
  onNewFlight,
  onRefresh,
}: {
  clients: CalendarClient[];
  onNewCampaign: () => void;
  onNewFlight: () => void;
  onRefresh: () => void;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [accounts, setAccounts] = useState<any[]>([]);
  const [pillars, setPillars] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [flights, setFlights] = useState<any[]>([]);
  const [views, setViews] = useState<any[]>([]);
  const [acct, setAcct] = useState({ platform: "INSTAGRAM", handle: "", profileUrl: "" });
  const [pillar, setPillar] = useState({ name: "", color: "#7C3AED", targetPct: "0" });
  const [color, setColor] = useState("#7C3AED");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const client = clients.find((c) => c.id === clientId);

  const load = useCallback(() => {
    if (!clientId) return;
    apiFetch<any[]>(`/calendar/settings/platform-accounts?clientId=${clientId}`).then(setAccounts).catch(() => setAccounts([]));
    apiFetch<any[]>(`/calendar/settings/pillars?clientId=${clientId}`).then(setPillars).catch(() => setPillars([]));
    apiFetch<any[]>(`/calendar/campaigns?clientId=${clientId}`).then(setCampaigns).catch(() => setCampaigns([]));
    apiFetch<any[]>(`/calendar/flights?clientId=${clientId}`).then(setFlights).catch(() => setFlights([]));
    apiFetch<any[]>("/calendar/views").then(setViews).catch(() => setViews([]));
  }, [clientId]);

  useEffect(() => {
    // `clients` arrives after the first render, so the initial "" would never
    // resolve — every default-client action (pillar/account/targets) failed.
    if (!clientId && clients[0]?.id) setClientId(clients[0].id);
  }, [clients, clientId]);

  useEffect(() => {
    setColor(client?.calendarColor ?? "#7C3AED");
    const t: Record<string, string> = {};
    for (const [k, v] of Object.entries(client?.postingTargets ?? {})) t[k] = String(v);
    setTargets(t);
  }, [clientId, client?.calendarColor, client?.postingTargets]);

  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 3000);
  };

  const saveAppearance = async () => {
    setBusy(true);
    try {
      const postingTargets: Record<string, number> = {};
      for (const [k, v] of Object.entries(targets)) if (Number(v) > 0) postingTargets[k] = Number(v);
      await apiFetch(`/calendar/clients/${clientId}/appearance`, {
        method: "PATCH",
        body: JSON.stringify({ calendarColor: color, postingTargets }),
      });
      flash("Client appearance saved");
      onRefresh();
    } catch (e: any) {
      flash(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const addAccount = async () => {
    if (!acct.handle.trim()) return;
    setBusy(true);
    try {
      await apiFetch("/calendar/settings/platform-accounts", {
        method: "POST",
        body: JSON.stringify({ ...acct, clientId, handle: acct.handle.trim() }),
      });
      setAcct({ platform: "INSTAGRAM", handle: "", profileUrl: "" });
      load();
      flash("Account added");
    } catch (e: any) {
      flash(e.message ?? "Could not add the account");
    } finally {
      setBusy(false);
    }
  };

  const addPillar = async () => {
    if (!pillar.name.trim()) return;
    setBusy(true);
    try {
      await apiFetch("/calendar/settings/pillars", {
        method: "POST",
        body: JSON.stringify({ ...pillar, clientId, targetPct: Number(pillar.targetPct) }),
      });
      setPillar({ name: "", color: "#7C3AED", targetPct: "0" });
      load();
      flash("Pillar added");
    } catch (e: any) {
      flash(e.message ?? "Could not add the pillar");
    } finally {
      setBusy(false);
    }
  };

  const importCsv = async () => {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return flash("Paste a header row and at least one post");
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(",");
      const row: any = {};
      headers.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
      return {
        date: row.date,
        time: row.time || "10:00",
        title: row.title,
        platforms: String(row.platforms ?? "").split("|").map((p: string) => p.trim().toUpperCase()).filter(Boolean),
        client: row.client,
        content: row.caption ?? "",
        status: (row.status ?? "DRAFT").toUpperCase(),
      };
    });
    setBusy(true);
    try {
      const res = await apiFetch<any>("/calendar/posts/import", { method: "POST", body: JSON.stringify({ rows }) });
      flash(`Imported ${res.created} posts${res.errors?.length ? ` · ${res.errors.length} skipped` : ""}`);
      setCsv("");
      onRefresh();
    } catch (e: any) {
      flash(e.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {msg && (
        <div className="fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-[12px] font-medium text-white shadow-xl">
          {msg}
        </div>
      )}

      <CardShell>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle title="Calendar settings" subtitle="Per-client accounts, content pillars, posting targets and bulk import." />
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)} className="!w-56">
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.companyName}</option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Client colour & targets</p>
            <div className="flex items-end gap-2">
              <Field label="Colour">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-16 cursor-pointer rounded-lg border border-border bg-card" />
              </Field>
              <Btn variant="outline" onClick={saveAppearance} disabled={busy}>Save</Btn>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {PLATFORMS.slice(0, 6).map((p) => (
                <Field key={p} label={PLATFORM_LABEL[p]}>
                  <Input
                    type="number"
                    min={0}
                    value={targets[p] ?? ""}
                    onChange={(e) => setTargets({ ...targets, [p]: e.target.value })}
                    placeholder="0"
                    className="!py-1 text-[12px]"
                  />
                </Field>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Platform accounts</p>
            <div className="flex flex-col gap-1">
              {accounts.length === 0 && <p className="text-[11px] text-muted-foreground">No accounts yet.</p>}
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border/50 px-2 py-1">
                  <span className="rounded bg-muted px-1 text-[9px] font-bold">{PLATFORM_LABEL[a.platform] ?? a.platform}</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{a.handle}</span>
                  <span className="text-[9.5px] text-muted-foreground">{a.followers ? `${a.followers.toLocaleString("en-US")}` : ""}</span>
                  <button
                    onClick={async () => {
                      await apiFetch(`/calendar/settings/platform-accounts/${a.id}`, { method: "DELETE" }).catch(() => null);
                      load();
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-end gap-1.5">
              <Select value={acct.platform} onChange={(e) => setAcct({ ...acct, platform: e.target.value })} className="!w-32 !py-1 text-[11px]">
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>
                ))}
              </Select>
              <Input value={acct.handle} onChange={(e) => setAcct({ ...acct, handle: e.target.value })} placeholder="@handle" className="!py-1 text-[12px]" />
              <Btn variant="outline" onClick={addAccount} disabled={busy}><Plus className="size-3" /></Btn>
            </div>
          </div>
        </div>
      </CardShell>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardShell>
          <SectionTitle title="Content pillars" subtitle="Used for the mix report (educational / promo / UGC…)." />
          <div className="flex flex-col gap-1">
            {pillars.length === 0 && <p className="text-[11px] text-muted-foreground">No pillars yet.</p>}
            {pillars.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-border/50 px-2 py-1">
                <span className="size-2 rounded-full" style={{ background: p.color }} />
                <span className="flex-1 text-[11.5px] font-medium">{p.name}</span>
                <span className="text-[9.5px] text-muted-foreground">{p.targetPct}%</span>
                <button
                  onClick={async () => {
                    await apiFetch(`/calendar/settings/pillars/${p.id}`, { method: "DELETE" }).catch(() => null);
                    load();
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-end gap-1.5">
            <Input value={pillar.name} onChange={(e) => setPillar({ ...pillar, name: e.target.value })} placeholder="Pillar name" className="!py-1 text-[12px]" />
            <input type="color" value={pillar.color} onChange={(e) => setPillar({ ...pillar, color: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-border" />
            <Input type="number" value={pillar.targetPct} onChange={(e) => setPillar({ ...pillar, targetPct: e.target.value })} className="!w-16 !py-1 text-[12px]" />
            <Btn variant="outline" onClick={addPillar} disabled={busy}><Plus className="size-3" /></Btn>
          </div>
        </CardShell>

        <CardShell>
          <SectionTitle title="Ads planning" subtitle="Campaigns and flights drive the timeline view." action={
            <div className="flex gap-1">
              <Btn variant="outline" onClick={onNewCampaign}><Plus className="size-3" /> Campaign</Btn>
              <Btn variant="outline" onClick={onNewFlight}><Plus className="size-3" /> Flight</Btn>
            </div>
          } />
          <div className="flex flex-col gap-1">
            {campaigns.length === 0 && <p className="text-[11px] text-muted-foreground">No campaigns yet.</p>}
            {campaigns.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border/50 px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{c.name}</span>
                <span className="rounded bg-muted px-1 text-[9px] font-semibold">{label(c.status)}</span>
                <span className="text-[9.5px] text-muted-foreground">{c._count?.posts ?? 0} posts</span>
              </div>
            ))}
            {flights.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-lg border border-dashed border-primary/30 px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-[11px]">{f.name}</span>
                <span className="rounded bg-primary/10 px-1 text-[9px] font-semibold text-primary">{f.platform}</span>
                <span className="text-[9px] text-muted-foreground">৳{Math.round(f.plannedSpend ?? 0).toLocaleString("en-US")}</span>
              </div>
            ))}
          </div>
        </CardShell>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardShell>
          <SectionTitle title="Bulk import" subtitle="Paste CSV: date,time,platforms,client,title,caption,status" />
          <Textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={"date,time,platforms,client,title,caption,status\n2026-11-20,10:00,INSTAGRAM|FACEBOOK,GlowSkin Beauty,Winter teaser,First look, SCHEDULED"}
            className="min-h-28 font-mono text-[11px]"
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">Platforms separated by “|”. Max 500 rows.</p>
            <Btn variant="primary" onClick={importCsv} disabled={busy || !csv.trim()}>
              <Upload className="size-3.5" /> Import
            </Btn>
          </div>
        </CardShell>

        <CardShell>
          <SectionTitle title="Saved views" subtitle="Shared filters your team opens every morning." />
          <div className="flex flex-col gap-1">
            {views.length === 0 && <p className="text-[11px] text-muted-foreground">No saved views yet — save one from the filter bar.</p>}
            {views.map((v) => (
              <div key={v.id} className="flex items-center gap-2 rounded-lg border border-border/50 px-2 py-1">
                <span className="flex-1 text-[11.5px] font-medium">{v.name}</span>
                <span className="rounded bg-muted px-1 text-[9px]">{v.view}</span>
                <button
                  onClick={async () => {
                    await apiFetch(`/calendar/views/${v.id}`, { method: "DELETE" }).catch(() => null);
                    load();
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </CardShell>
      </div>

      <p className={cn("text-[10.5px] text-muted-foreground", !msg && "opacity-0")}>{msg ?? "—"}</p>
    </div>
  );
}
