import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsappConfigService } from "./whatsapp-config.service";
import { WA_GRAPH_VERSION, toWaNumber } from "./whatsapp.constants";

export type WaSendInput = {
  to: string;
  templateName?: string;
  language?: string;
  /** positional template params ({{1}}..{{n}}) */
  params?: (string | number)[];
  /** URL button variable (invoice link etc.) */
  buttonUrl?: string;
  messageType?: string;
  relatedInvoiceId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /** skip when an equivalent live log already exists for this invoice+template */
  dedupe?: boolean;
  force?: boolean;
};

@Injectable()
export class WhatsappSenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WhatsappConfigService
  ) {}

  /** Primary WhatsApp-reachable contact for a client (primary first, opt-in only). */
  async resolveClientRecipient(clientId: string): Promise<{ to: string; name: string; contactId: string } | { error: string }> {
    const contacts = await this.prisma.clientContact.findMany({
      where: { clientId, phone: { not: null } },
      orderBy: { isPrimary: "desc" },
      take: 5,
    });
    const ok = contacts.find((c) => c.whatsappOptIn && toWaNumber(c.phone));
    if (!ok) {
      const anyPhone = contacts.length > 0;
      return { error: anyPhone ? "Client contacts opted out of WhatsApp" : "No client phone number on file" };
    }
    return { to: toWaNumber(ok.phone)!, name: ok.name, contactId: ok.id };
  }

  async resolveStaffRecipient(userId: string): Promise<{ to: string; name: string } | { error: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, employee: { select: { phone: true } } },
    });
    const num = toWaNumber((user?.employee as any)?.phone);
    if (!num) return { error: `No staff phone on file for ${user?.name ?? userId}` };
    return { to: num, name: user?.name ?? "there" };
  }

  /** Task assignees are stored as employee IDs — resolve phone directly. */
  async resolveEmployeeRecipient(employeeId: string): Promise<{ to: string; name: string } | { error: string }> {
    const emp = await (this.prisma as any).employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true, phone: true } }).catch(() => null);
    const num = toWaNumber(emp?.phone);
    if (!num) return { error: `No phone on file for ${emp?.name ?? "assignee"}` };
    return { to: num, name: emp?.name ?? "there" };
  }

  async send(input: WaSendInput): Promise<{ ok: boolean; logId?: string; wamid?: string; skipped?: boolean; mocked?: boolean; error?: string }> {
    const cfg = await this.config.getConfig();
    if (!cfg.enabled) return { ok: false, error: "WhatsApp integration is disabled (Control → Integrations → WhatsApp)" };
    const to = toWaNumber(input.to);
    if (!to) return { ok: false, error: "Invalid recipient phone number" };

    if (input.dedupe && !input.force && input.relatedInvoiceId && input.templateName) {
      const existing = await this.prisma.whatsappMessageLog.findFirst({
        where: {
          relatedInvoiceId: input.relatedInvoiceId,
          templateName: input.templateName,
          status: { in: ["queued", "sent", "delivered", "read"] },
        },
      });
      if (existing) return { ok: true, skipped: true, logId: existing.id, wamid: existing.wamid ?? undefined };
    }

    const log = await this.prisma.whatsappMessageLog.create({
      data: {
        to,
        templateName: input.templateName ?? null,
        language: input.language ?? cfg.defaultLanguage ?? "en",
        messageType: input.messageType ?? "template",
        params: (input.params ?? null) as any,
        relatedInvoiceId: input.relatedInvoiceId ?? null,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        status: "queued",
      },
    });

    if (cfg.mode === "mock" || !cfg.accessToken || !cfg.phoneNumberId) {
      const wamid = `mock_${log.id.replace(/[^a-z0-9]/gi, "").slice(0, 12)}_${Date.now().toString(36)}`;
      await this.prisma.whatsappMessageLog.update({ where: { id: log.id }, data: { status: "sent", wamid } });
      return { ok: true, logId: log.id, wamid, mocked: true };
    }

    try {
      const body: any = {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: input.templateName,
          language: { code: input.language ?? cfg.defaultLanguage ?? "en" },
          components: [
            ...(input.params?.length
              ? [{ type: "body", parameters: input.params.slice(0, 10).map((p) => ({ type: "text", text: String(p) })) }]
              : []),
            ...(input.buttonUrl ? [{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: input.buttonUrl }] }] : []),
          ],
        },
      };
      const res = await fetch(`https://graph.facebook.com/${WA_GRAPH_VERSION}/${encodeURIComponent(cfg.phoneNumberId!)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok || data?.error) {
        const msg = data?.error?.message ?? `Meta responded ${res.status}`;
        await this.prisma.whatsappMessageLog.update({ where: { id: log.id }, data: { status: "failed", error: msg } });
        return { ok: false, logId: log.id, error: msg };
      }
      const wamid = data?.messages?.[0]?.id ?? null;
      await this.prisma.whatsappMessageLog.update({ where: { id: log.id }, data: { status: "sent", wamid } });
      return { ok: true, logId: log.id, wamid: wamid ?? undefined };
    } catch (e: any) {
      const msg = e?.message ?? "Network error reaching Meta";
      await this.prisma.whatsappMessageLog.update({ where: { id: log.id }, data: { status: "failed", error: msg } });
      return { ok: false, logId: log.id, error: msg };
    }
  }

  /** Mock-mode helper: simulate Meta delivery progression for demos/tests. */
  async simulateStatus(wamid: string, status: "delivered" | "read" | "failed", error?: string) {
    return this.prisma.whatsappMessageLog.updateMany({
      where: { wamid },
      data: { status, ...(error ? { error } : {}) },
    });
  }

  async recentLogs(take = 50) {
    return this.prisma.whatsappMessageLog.findMany({ orderBy: { createdAt: "desc" }, take });
  }
}
