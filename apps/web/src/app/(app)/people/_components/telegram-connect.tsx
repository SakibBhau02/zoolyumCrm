"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Send, Unlink } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { CardShell, SectionTitle, cn } from "@/components/shared";
import { Btn } from "@/components/table";

type LinkRow = { id: string; chatId: string; username?: string | null; firstName?: string | null; isActive: boolean; createdAt: string } | null;

/**
 * Connect one employee to the Telegram bot.
 *
 * No chat_id copy-paste: the server mints a single-use code and we hand the
 * person a `t.me/<bot>?start=<code>` deep link. Tapping it in Telegram is the
 * only thing that binds their chat, so HR cannot accidentally attach someone
 * else's account. The card hides itself for users who are not HR (the endpoint
 * answers 403 and we render nothing).
 */
export function TelegramConnect({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const [link, setLink] = useState<LinkRow>(null);
  const [allowed, setAllowed] = useState(true);
  const [code, setCode] = useState<{ code: string; deepLink: string | null; botName: string | null; ttlMinutes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const row = await apiFetch<LinkRow>(`/control/telegram/link?employeeId=${employeeId}`);
      setLink(row);
    } catch (e: any) {
      if (e?.status === 403) setAllowed(false);
    }
  }, [employeeId]);

  useEffect(() => { void load(); }, [load]);

  if (!allowed) return null;

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<any>("/control/telegram/link-code", {
        method: "POST",
        body: JSON.stringify({ employeeId }),
      });
      setCode(r);
    } catch (e: any) {
      setError(e.message ?? "Could not generate a link");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!link || !window.confirm(`Disconnect ${employeeName} from Telegram?`)) return;
    setBusy(true);
    try {
      await apiFetch(`/control/telegram/links/${link.id}`, { method: "DELETE" });
      setLink(null);
    } catch (e: any) {
      setError(e.message ?? "Could not disconnect");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!code?.deepLink) return;
    await navigator.clipboard.writeText(code.deepLink).catch(() => null);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <CardShell>
      <SectionTitle
        title="Telegram"
        subtitle="Meeting reminders, leave decisions and payroll alerts in their pocket"
        icon={<Send className="size-4" />}
        action={
          link ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-micro font-bold text-emerald-600 dark:text-emerald-300">
              <Check className="size-3.5" /> Connected
            </span>
          ) : undefined
        }
      />

      {link ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-body font-semibold">{link.firstName ?? link.username ?? "Telegram chat"}</p>
            <p className="font-mono text-micro text-muted-foreground">
              {link.username ? `@${link.username} · ` : ""}chat {link.chatId}
            </p>
          </div>
          <Btn variant="ghost" onClick={disconnect} disabled={busy} className="text-rose-500 hover:bg-rose-500/10">
            <Unlink className="size-3.5" /> Disconnect
          </Btn>
        </div>
      ) : code ? (
        <div className="flex flex-col gap-2">
          {code.deepLink ? (
            <>
              <p className="text-body text-muted-foreground">
                Send this link to {employeeName}. It works once and expires in {code.ttlMinutes} minutes.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xl border border-border bg-muted/40 px-3 py-2 font-mono text-meta">{code.deepLink}</code>
                <Btn variant="outline" onClick={copy}><Copy className="size-3.5" /> {copied ? "Copied" : "Copy"}</Btn>
                <a
                  href={code.deepLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-gradient px-3 py-2 text-body font-semibold text-white"
                >
                  <Send className="size-3.5" /> Open Telegram
                </a>
              </div>
              <p className="text-micro text-muted-foreground">
                Or they can send <span className="font-mono font-semibold text-foreground">/start {code.code}</span> to the bot.
              </p>
            </>
          ) : (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-meta text-amber-700 dark:text-amber-300">
              Bot name is not configured yet. Set the bot username in Control → Telegram, or share this code: <span className="font-mono font-bold">{code.code}</span>
            </div>
          )}
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={() => setCode(null)}>Done</Btn>
            <Btn variant="outline" onClick={generate} disabled={busy}>New code</Btn>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-body text-muted-foreground">
            Not connected. Generate a one-tap link — no chat ID to copy.
          </p>
          <Btn variant="outline" onClick={generate} disabled={busy}>
            <Link2 className="size-3.5" /> {busy ? "Working…" : "Connect Telegram"}
          </Btn>
        </div>
      )}

      {error && <p className={cn("mt-2 text-meta font-medium text-rose-500")}>{error}</p>}
    </CardShell>
  );
}
