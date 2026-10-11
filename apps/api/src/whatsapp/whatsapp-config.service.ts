import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { decryptSecret, encryptSecret } from "../common/crypto";
import { DEFAULT_WA_TEMPLATES, WA_PROVIDER_NAME } from "./whatsapp.constants";

export type WaMode = "mock" | "live";

export type WaSettings = {
  enabled: boolean;
  mode: WaMode;
  displayNumber?: string;
  defaultLanguage: string;
  auto: {
    invoiceSent: boolean;
    paymentReceived: boolean;
    dueToday: boolean;
    overdue: boolean;
    taskAssigned: boolean;
    taskClientUpdate: boolean;
  };
};

export type WaSecrets = {
  accessToken?: string;
  phoneNumberId?: string;
  wabaId?: string;
  appSecret?: string;
  verifyToken?: string;
};

export type WaConfig = WaSettings & WaSecrets;

const DEFAULT_SETTINGS: WaSettings = {
  enabled: false,
  mode: "mock",
  displayNumber: "",
  defaultLanguage: "en",
  auto: {
    invoiceSent: true,
    paymentReceived: true,
    dueToday: true,
    overdue: true,
    taskAssigned: false,
    taskClientUpdate: true,
  },
};

@Injectable()
export class WhatsappConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lazily ensure the WHATSAPP integration row + default template catalogue. */
  async ensureDefaults() {
    let row = await this.prisma.integration.findFirst({ where: { providerName: WA_PROVIDER_NAME } });
    if (!row) {
      row = await this.prisma.integration.create({
        data: {
          providerName: WA_PROVIDER_NAME,
          type: "MESSAGING",
          status: "DISCONNECTED",
          credentialsEnc: encryptSecret(JSON.stringify({ settings: DEFAULT_SETTINGS, secrets: {} })),
        },
      });
    }
    for (const t of DEFAULT_WA_TEMPLATES) {
      await this.prisma.whatsappTemplate.upsert({
        where: { name_language: { name: t.name, language: t.language } },
        update: {},
        create: {
          name: t.name,
          language: t.language,
          category: t.category,
          description: t.description,
          variables: t.variables,
          bodyPreview: t.bodyPreview,
          buttons: (t.buttons ?? null) as any,
          isActive: true,
        },
      });
    }
    return row;
  }

  private parseBlob(blob: string | null): { settings: WaSettings; secrets: WaSecrets } {
    const raw = decryptSecret(blob);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        return {
          settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}), auto: { ...DEFAULT_SETTINGS.auto, ...(parsed.settings?.auto ?? {}) } },
          secrets: parsed.secrets ?? {},
        };
      } catch {
        // fall through to defaults
      }
    }
    return { settings: { ...DEFAULT_SETTINGS }, secrets: {} };
  }

  async getConfig(): Promise<WaConfig> {
    const row = await this.ensureDefaults();
    const { settings, secrets } = this.parseBlob(row.credentialsEnc);
    return { ...settings, ...secrets };
  }

  /** Staff-safe view: secrets masked, templates + recent logs included. */
  async getPublicConfig() {
    const cfg = await this.getConfig();
    const templates = await this.prisma.whatsappTemplate.findMany({ orderBy: [{ name: "asc" }, { language: "asc" }] });
    return {
      enabled: cfg.enabled,
      mode: cfg.mode,
      displayNumber: cfg.displayNumber ?? "",
      defaultLanguage: cfg.defaultLanguage,
      auto: cfg.auto,
      phoneNumberId: cfg.phoneNumberId ?? "",
      wabaId: cfg.wabaId ?? "",
      accessTokenSet: !!cfg.accessToken,
      appSecretSet: !!cfg.appSecret,
      verifyTokenSet: !!cfg.verifyToken,
      templates,
    };
  }

  async updateConfig(body: Partial<WaConfig>, actorId?: string) {
    const row = await this.ensureDefaults();
    const current = this.parseBlob(row.credentialsEnc);
    const settings: WaSettings = {
      enabled: body.enabled ?? current.settings.enabled,
      mode: body.mode ?? current.settings.mode,
      displayNumber: body.displayNumber ?? current.settings.displayNumber,
      defaultLanguage: body.defaultLanguage ?? current.settings.defaultLanguage,
      auto: { ...current.settings.auto, ...(body as any).auto },
    };
    const secrets: WaSecrets = { ...current.secrets };
    // empty string = keep existing secret (masked inputs submit "" when untouched)
    for (const k of ["accessToken", "phoneNumberId", "wabaId", "appSecret", "verifyToken"] as const) {
      const v = (body as any)[k];
      if (typeof v === "string" && v.length > 0) secrets[k] = v;
      if (v === null) delete secrets[k];
    }
    await this.prisma.integration.update({
      where: { id: row.id },
      data: {
        credentialsEnc: encryptSecret(JSON.stringify({ settings, secrets })),
        status: settings.enabled ? "CONNECTED" : "DISCONNECTED",
        connectedById: actorId ?? row.connectedById,
        connectedAt: settings.enabled ? new Date() : row.connectedAt,
      },
    });
    return this.getPublicConfig();
  }

  async toggleTemplate(id: string, isActive: boolean) {
    return this.prisma.whatsappTemplate.update({ where: { id }, data: { isActive } });
  }

  /** Live-mode connectivity check against Meta (mock mode just validates config presence). */
  async testConnection() {
    const cfg = await this.getConfig();
    if (cfg.mode === "mock") {
      return { ok: true, mode: "mock" as const, detail: "Mock mode — no Meta call made. Messages are logged, not sent." };
    }
    if (!cfg.accessToken || !cfg.phoneNumberId) {
      return { ok: false, mode: "live" as const, detail: "accessToken and phoneNumberId are required for live mode." };
    }
    try {
      const res = await fetch(
        `https://graph.facebook.com/v23.0/${encodeURIComponent(cfg.phoneNumberId)}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${cfg.accessToken}` } }
      );
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) return { ok: false, mode: "live" as const, detail: data?.error?.message ?? `Meta responded ${res.status}` };
      return { ok: true, mode: "live" as const, detail: `Connected as ${data?.verified_name ?? data?.display_phone_number ?? cfg.phoneNumberId}` };
    } catch (e: any) {
      return { ok: false, mode: "live" as const, detail: e?.message ?? "Network error reaching Meta" };
    }
  }
}
