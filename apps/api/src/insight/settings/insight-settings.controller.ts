import { Body, Controller, Get, Patch } from "@nestjs/common";
import { InsightSettingsService } from "./insight-settings.service";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";

@RequirePermission("INSIGHT")
@Controller("insight/settings")
export class InsightSettingsController {
  constructor(private readonly svc: InsightSettingsService) {}

  @Get()
  get() {
    return this.svc.get();
  }

  @Patch()
  @Roles("Owner", "Finance")
  update(@Body() body: any, @CurrentUser("sub") userId: string) {
    return this.svc.update(body, userId);
  }
}
