import { Controller, Get, Query } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("overview")
  overview(@CurrentUser() user: any, @Query("period") period?: string) {
    return this.dashboard.overview(period, user?.role, user?.permissions);
  }

  @Get("home")
  home(@CurrentUser() user: any, @Query("period") period?: string) {
    return this.dashboard.home(user?.role, user?.sub, user?.permissions, period);
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
