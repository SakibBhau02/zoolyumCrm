import { Body, Controller, Get, Post, Query, Req, Res } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import type { Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsappConfigService } from "./whatsapp-config.service";
import { toWaNumber } from "./whatsapp.constants";

/**
 * Meta Cloud API webhook (public). GET = verification handshake,
 * POST = inbound messages + delivery statuses. Always answers fast;
 * signature is HMAC-SHA256 over the RAW body keyed by the App Secret.
 */
@Public()
@Controller("whatsapp")
export class WhatsappWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WhatsappConfigService
  ) {}

  @Get("webhook")
  async verify(@Query() q: any, @Res() res: Response) {
    const cfg = await this.config.getConfig();
    const mode = q["hub.mode"] ?? q["hub_mode"];
    const token = String(q["hub.verify_token"] ?? q["hub_verify_token"] ?? "");
    const challenge = q["hub.challenge"] ?? q["hub_challenge"];
    // Constant-time compare, and an unconfigured token can never match.
    const expected = String(cfg.verifyToken ?? "");
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    const tokenOk = expected.length > 0 && a.length === b.length && timingSafeEqual(a, b);
    if (mode === "subscribe" && tokenOk) {
      return res.status(200).send(String(challenge ?? ""));
    }
    return res.status(403).send("Forbidden");
  }

  @Post("webhook")
  async incoming(@Req() req: any, @Res() res: Response, @Body() body: any) {
    const cfg = await this.config.getConfig();
    // Fail closed: without an App Secret we cannot tell Meta from an attacker,
    // and this endpoint can rewrite client WhatsApp opt-in state. Refusing is
    // the only safe default; the settings page tells the owner what to paste.
    if (!cfg.appSecret) {
      return res.status(503).send("Webhook secret is not configured");
    }
    const header = String(req.headers["x-hub-signature-256"] ?? "");
    const raw: Buffer = req.rawBody ?? Buffer.from(JSON.stringify(body ?? {}));
    const expected = "sha256=" + createHmac("sha256", cfg.appSecret).update(raw).digest("hex");
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return res.status(401).send("Bad signature");
    }
    try {
      await this.process(body);
    } catch {
      // never fail the webhook: Meta retries, poison messages must not loop
    }
    return res.status(200).send("ok");
  }

  private async process(body: any) {
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value ?? {};
        for (const st of value?.statuses ?? []) await this.applyStatus(st);
        for (const msg of value?.messages ?? []) await this.applyInbound(msg);
      }
    }
  }

  private async applyStatus(st: any) {
    if (!st?.id) return;
    const status = String(st.status ?? "").toLowerCase();
    if (!["sent", "delivered", "read", "failed"].includes(status)) return;
    const errMsg = st.errors?.map((e: any) => e?.message ?? e?.code).filter(Boolean).join("; ") ?? null;
    await this.prisma.whatsappMessageLog
      .update({ where: { wamid: String(st.id) }, data: { status, ...(errMsg ? { error: errMsg } : {}) } })
      .catch(() => null);
  }

  private async applyInbound(msg: any) {
    const from = String(msg?.from ?? "").replace(/\D/g, "");
    const text =
      msg?.type === "text" ? String(msg?.text?.body ?? "") : msg?.type === "button" ? String(msg?.button?.text ?? "") : "";
    const norm = text.trim().toLowerCase();
    await this.prisma.whatsappMessageLog
      .create({
        data: {
          to: from,
          messageType: `inbound_${msg?.type ?? "unknown"}`,
          params: { body: text.slice(0, 1000), wamid: msg?.id ?? null } as any,
          status: "read",
          wamid: msg?.id ? `in_${msg.id}` : null,
        },
      })
      .catch(() => null);
    if (!from) return;
    if (["stop", "unsubscribe", "cancel", "opt out", "optout", "বন্ধ"].includes(norm)) {
      await this.setOptIn(from, false);
    } else if (["start", "subscribe", "opt in", "optin", "চালু"].includes(norm)) {
      await this.setOptIn(from, true);
    }
  }

  private async setOptIn(from: string, optIn: boolean) {
    const contacts = await this.prisma.clientContact.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true } });
    for (const c of contacts) {
      const n = toWaNumber(c.phone);
      if (n && (n === from || from.endsWith(n.slice(-10)) || n.endsWith(from.slice(-10)))) {
        await this.prisma.clientContact.update({ where: { id: c.id }, data: { whatsappOptIn: optIn } }).catch(() => null);
      }
    }
  }
}
