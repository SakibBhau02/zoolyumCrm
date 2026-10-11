import { Controller, Get } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("overview")
  overview() {
    return this.dashboard.overview();
  }

  @Get("scoped")
  scoped(@CurrentUser("role") role: string) {
    return this.dashboard.scoped(role);
  }

  @Get("my-day")
  myDay(@CurrentUser() user: any) {
    return this.dashboard.myDay(user?.sub);
  }
}
