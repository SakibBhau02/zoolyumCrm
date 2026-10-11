import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { AdAccountService } from "./ad-account.service";
import { SyncService } from "./sync.service";

@Controller("insight/datasource")
export class DatasourceController {
  constructor(private readonly accounts: AdAccountService, private readonly sync: SyncService) {}

  @Get("health")
  health() { return this.accounts.health(); }

  @Get("accounts")
  list(@Query("clientId") clientId?: string, @Query("provider") provider?: string) { return this.accounts.list({ clientId, provider }); }

  @Get("accounts/:id")
  get(@Param("id") id: string) { return this.accounts.get(id); }

  @Post("accounts")
  create(@Body() body: any) { return this.accounts.create(body); }

  @Patch("accounts/:id")
  update(@Param("id") id: string, @Body() body: any) { return this.accounts.update(id, body); }

  @Delete("accounts/:id")
  remove(@Param("id") id: string) { return this.accounts.remove(id); }

  @Post("accounts/:id/sync")
  syncOne(@Param("id") id: string, @Body() body: { from?: string; to?: string }) {
    return this.sync.syncAccount(id, { from: body?.from ? new Date(body.from) : undefined, to: body?.to ? new Date(body.to) : undefined });
  }

  @Post("sync-all")
  syncAll(@Body() body: { from?: string; to?: string }) {
    return this.sync.syncAll({ from: body?.from ? new Date(body.from) : undefined, to: body?.to ? new Date(body.to) : undefined });
  }

  @Get("sync-logs")
  logs(@Query("accountId") accountId?: string, @Query("take") take?: string) { return this.sync.syncLogs({ accountId, take }); }
}
