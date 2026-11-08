"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Link2, RefreshCw, Send, Trash2, Zap } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { CardShell, EmptyState, SectionTitle, SkeletonBlock, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Field, Input, Select } from "@/components/ui";

type Cfg = {
  enabled: boolean;
  mode: "mock" | "live";
  useWebhook: boolean;
  botName: string;
  auto: Record<string, boolean>;
  botTokenSet: boolean;
  webhookSecretSet: boolean;
  defaultChatId: string;
  linkedChats: number;
  messagesSent: number;
};

const AUTO_LABELS: [string, string][] = [
  ["notifications", "Mirror every in-app notification"],
  ["meetingReminder", "Meeting reminders (24h + 1h)"],
  ["dailyAgenda", "Daily agenda at 08:30"],
  ["attendanceNudge", "Missing check-in / check-out nudges"],
  ["payrollReminder", "Payroll reminder on the 25th"],
  ["weeklyDigest", "Weekly owner digest (Fri 17:00)"],
];

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-muted")}
    >
      <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

/**
 * Control → Telegram.
 *
 * Deliberately mirrors the WhatsApp tab: token lives server-side encrypted, the
 * UI only learns whether it is set, and there is a mock mode so the whole
 * pipeline can be wired up before a BotFather token exists.
 */
export function TelegramTab({ notify }: { notify: (m: string) => void }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [form, setForm] = useState({ botToken: "", webhookSecret: "", defaultChatId: "", botName: "" });
  const [busy, setBusy] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");
  const [links, setLinks] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [info, setInfo] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const [c, l, g] = await Promise.all([
        apiFetch<Cfg>("/control/telegram/config"),
        apiFetch<any[]>("/control/telegram/links"),
        apiFetch<any[]>("/control/telegram/logs?take=25"),
      ]);
      setCfg(c);
      setForm({ botToken: "", webhookSecret: "", defaultChatId: c.defaultChatId ?? "", botName: c.botName ?? "" });
      setLinks(l ?? []);
      setLogs(g ?? []);
    } catch (e: any) {
      notify(e.message ?? "Could not load Telegram settings");
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (publicUrl === "" && typeof window !== "undefined") setPublicUrl(window.location.origin.replace(":3000", ":4000")); }, [publicUrl]);

  if (!cfg) return <div className="flex flex-col gap-2">{[...Array(4)].map((_, i) => <SkeletonBlock key={i} className="h-16" />)}</div>;

  const save = async (patch?: Partial<Cfg>) => {
    setBusy(true);
    try {
      const next = await apiFetch<Cfg>("/control/telegram/config", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: patch?.enabled ?? cfg.enabled,
          mode: patch?.mode ?? cfg.mode,
          useWebhook: patch?.useWebhook ?? cfg.useWebhook,
          botName: form.botName,
          botToken: form.botToken || undefined,
          webhookSecret: form.webhookSecret || undefined,
          defaultChatId: form.defaultChatId || undefined,
          auto: cfg.auto,
        }),
      });
      setCfg(next);
      setForm({ botToken: "", webhookSecret: "", defaultChatId: next.defaultChatId ?? "", botName: next.botName ?? "" });
      notify("Telegram settings saved");
      void load();
    } catch (e: any) {
      notify(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const act = async (label: string, fn: () => Promise<any>) => {
    setBusy(true);
    try {
      const r = await fn();
      const detail = r?.detail ?? r?.error ?? (r?.ok === false ? "Failed" : "Done");
      notify(`${label}: ${detail}`);
      void load();
    } catch (e: any) {
      notify(`${label}: ${e.message ?? "failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <CardShell>
        <SectionTitle
          title="Telegram bot"
          subtitle="Bot token is encrypted at rest — it is never returned to the browser"
          icon={<Bot className="size-3.5" />}
          action={
            <span className="flex items-center gap-1.5">
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", cfg.enabled ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
                {cfg.enabled ? "enabled" : "disabled"}
              </span>
              <Switch checked={cfg.enabled} onChange={(v) => void save({ enabled: v })} />
            </span>
          }
        />

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Mode" hint="Mock logs every send instead of calling Telegram">
            <Select value={cfg.mode} onChange={(e) => void save({ mode: e.target.value as "mock" | "live" })}>
              <option value="mock">Mock — log only</option>
              <option value="live">Live — deliver via Bot API</option>
            </Select>
          </Field>
          <Field label="Bot username" hint="From @BotFather, e.g. zoolyum_hr_bot (no @)">
            <Input value={form.botName} onChange={(e) => setForm({ ...form, botName: e.target.value.replace(/^@/, "") })} placeholder="zoolyum_hr_bot" />
          </Field>
          <Field label={`Bot token ${cfg.botTokenSet ? "(saved — leave blank to keep)" : ""}`}>
            <Input type="password" value={form.botToken} onChange={(e) => setForm({ ...form, botToken: e.target.value })} placeholder={cfg.botTokenSet ? "••••••••" : "123456:ABC-DEF…"} />
          </Field>
          <Field label={`Webhook secret ${cfg.webhookSecretSet ? "(saved — leave blank to keep)" : ""}`} hint="Telegram echoes this in X-Telegram-Bot-Api-Secret-Token">
            <Input value={form.webhookSecret} onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })} placeholder="long-random-string" />
          </Field>
          <Field label="Fallback group chat id" hint="Used when a person has not linked yet (optional)">
            <Input value={form.defaultChatId} onChange={(e) => setForm({ ...form, defaultChatId: e.target.value })} placeholder="-1001234567890" />
          </Field>
          <div className="flex items-end gap-2">
            <Btn variant="primary" onClick={() => void save()} disabled={busy}><Zap className="size-3.5" /> Save</Btn>
            <Btn variant="outline" onClick={() => act("Connection", () => apiFetch("/control/telegram/test-connection", { method: "POST" }))} disabled={busy}>Test connection</Btn>
            <Btn variant="outline" onClick={() => act("Test send", () => apiFetch("/control/telegram/test-send", { method: "POST", body: JSON.stringify({}) }))} disabled={busy}>
              <Send className="size-3.5" /> Test send
            </Btn>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
          <span className="text-[11.5px] font-bold">Transport</span>
          <span className="text-[11.5px] text-muted-foreground">
            {cfg.useWebhook ? "Webhook (production)" : "Long polling (dev / no public URL)"}
          </span>
          <Input value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="https://your-domain.com" className="!w-72 !py-1.5 text-[11.5px]" />
          <Btn variant="outline" className="!py-1.5" disabled={busy} onClick={() => act("Webhook", () => apiFetch("/control/telegram/webhook", { method: "POST", body: JSON.stringify({ publicUrl }) }))}>Register webhook</Btn>
          <Btn variant="ghost" className="!py-1.5" disabled={busy} onClick={() => act("Webhook removed", () => apiFetch("/control/telegram/webhook", { method: "DELETE" }))}>Remove</Btn>
          <Btn variant="ghost" className="!py-1.5" disabled={busy} onClick={() => act("Polling", () => apiFetch("/control/telegram/polling/sync", { method: "POST" }))}>
            <RefreshCw className="size-3.5" /> Sync polling
          </Btn>
          <Btn variant="ghost" className="!py-1.5" onClick={() => act("Webhook info", async () => { const r = await apiFetch("/control/telegram/webhook-info"); setInfo(r); return { detail: "loaded below" }; })}>Info</Btn>
        </div>
        {info && <pre className="mt-2 max-h-40 overflow-auto rounded-xl bg-muted/40 p-3 text-[10.5px]">{JSON.stringify(info, null, 2)}</pre>}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Telegram cannot call <span className="font-mono">localhost</span>. On a laptop keep polling on; register the webhook only when the API is reachable on public HTTPS (443/80/88/8443).
        </p>
      </CardShell>

      <CardShell>
        <SectionTitle title="Automation" subtitle="Which events go out automatically. Every send is deduped and logged." />
        <div className="grid gap-2 md:grid-cols-2">
          {AUTO_LABELS.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5">
              <span className="text-[12px] font-medium">{label}</span>
              <Switch
                checked={!!cfg.auto[key]}
                onChange={(v) => {
                  const auto = { ...cfg.auto, [key]: v };
                  setCfg({ ...cfg, auto });
                  void apiFetch("/control/telegram/config", { method: "PATCH", body: JSON.stringify({ auto }) }).catch(() => notify("Could not save"));
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn variant="outline" onClick={() => act("Agenda", () => apiFetch("/people/automation/digest", { method: "POST" }))} disabled={busy}>Run digest now</Btn>
          <Btn variant="outline" onClick={() => act("Nudge", () => apiFetch("/people/automation/nudge-in", { method: "POST" }))} disabled={busy}>Run check-in nudge</Btn>
          <Btn variant="outline" onClick={() => act("Recompute", () => apiFetch("/people/automation/recompute", { method: "POST" }))} disabled={busy}>Recompute attendance</Btn>
        </div>
      </CardShell>

      <CardShell>
        <SectionTitle title={`Linked chats (${cfg.linkedChats})`} subtitle="People who pressed /start with a valid code" icon={<Link2 className="size-3.5" />} />
        {links.length === 0 ? (
          <EmptyState title="Nobody linked yet" hint="Open an employee profile → Telegram → Connect, then send them the one-tap link." />
        ) : (
          <div className="flex flex-col gap-1.5">
            {links.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 px-3 py-2">
                <span className={cn("size-1.5 rounded-full", l.isActive ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                <span className="text-[12.5px] font-semibold">{l.employee?.name ?? l.user?.name ?? l.firstName ?? "Unknown"}</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">{l.username ? `@${l.username}` : l.chatId}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  <Btn variant="ghost" className="!px-2 !py-1 text-[11px]" onClick={() => act("Removed", () => apiFetch(`/control/telegram/links/${l.id}`, { method: "DELETE" }))}>
                    <Trash2 className="size-3.5" />
                  </Btn>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardShell>

      <CardShell>
        <SectionTitle title="Message log" subtitle="Every send, its status and the failure reason" action={<Btn variant="ghost" onClick={() => void load()}>Refresh</Btn>} />
        {logs.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">Nothing sent yet.</p>
        ) : (
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {logs.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-3 py-1.5">
                <span className={cn("rounded-full px-2 py-0.5 text-[9.5px] font-bold", l.status === "sent" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : l.status === "mock" ? "bg-sky-500/10 text-sky-600 dark:text-sky-300" : l.status === "failed" ? "bg-rose-500/10 text-rose-600 dark:text-rose-300" : "bg-muted text-muted-foreground")}>{l.status}</span>
                <span className="text-[11px] font-semibold">{l.kind}</span>
                <span className="truncate text-[11px] text-muted-foreground">{l.title ?? l.body?.slice(0, 60)}</span>
                {l.error && <span className="text-[10.5px] text-rose-500">{l.error}</span>}
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{new Date(l.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        )}
      </CardShell>
    </div>
  );
}
