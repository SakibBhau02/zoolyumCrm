import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { WhatsappConfigService } from "./whatsapp-config.service";
import { WhatsappSenderService } from "./whatsapp-sender.service";
import { WhatsappTriggersService } from "./whatsapp-triggers.service";

/** Control-panel management (credentials from here, never from env files). */
@Controller("control/whatsapp")
export class WhatsappAdminController {
  constructor(
    private readonly config: WhatsappConfigService,
    private readonly sender: WhatsappSenderService,
    private readonly triggers: WhatsappTriggersService
  ) {}

  @Roles("Owner", "CONTROL")
  @Get("config")
  config_() {
    return this.config.getPublicConfig();
  }

  @Roles("Owner", "CONTROL")
  @Patch("config")
  updateConfig(@Body() body: any, @CurrentUser() user: any) {
    return this.config.updateConfig(body ?? {}, user?.sub);
  }

  @Roles("Owner", "CONTROL")
  @Post("test-connection")
  testConnection() {
    return this.config.testConnection();
  }

  @Roles("Owner", "CONTROL")
  @Post("test-send")
  testSend(@Body() body: { to: string; templateName?: string; language?: string; params?: (string | number)[] }) {
    if (!body?.to) return { ok: false, error: "Recipient phone (to) is required" };
    return this.sender.send({
      to: body.to,
      templateName: body.templateName || "invoice_ready",
      language: body.language,
      params: body.params ?? ["Test Client", "TEST-0001", "Demo Project", "1,000", "2026-10-10", "https://example.com"],
      force: true,
    });
  }

  @Get("logs")
  logs(@Query("take") take?: string) {
    const n = Math.min(Math.max(Number(take ?? 50) || 50, 1), 200);
    return this.sender.recentLogs(n);
  }

  @Roles("Owner", "CONTROL")
  @Post("simulate")
  simulate(@Body() body: { wamid: string; status: "delivered" | "read" | "failed"; error?: string }) {
    if (!body?.wamid || !body?.status) return { ok: false, error: "wamid and status are required" };
    return this.sender.simulateStatus(body.wamid, body.status, body.error).then((r) => ({ ok: true, updated: r.count }));
  }

  @Roles("Owner", "CONTROL", "Finance")
  @Post("sweep")
  sweep() {
    return this.triggers.runSweepNow();
  }

  @Roles("Owner", "CONTROL")
  @Patch("templates/:id")
  toggleTemplate(@Param("id") id: string, @Body() body: { isActive: boolean }) {
    return this.config.toggleTemplate(id, !!body?.isActive);
  }
}
