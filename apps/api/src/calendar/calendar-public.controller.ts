import { Controller, Get, Param } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { CalendarPlanService } from "./calendar-plan.service";

/**
 * Login-free calendar share links. The token is the only credential, so every
 * route below returns exactly what the link was scoped to — never a client
 * list or a staff view.
 */
@Public()
@Controller("public/calendar")
export class CalendarPublicController {
  constructor(private readonly plans: CalendarPlanService) {}

  @Get(":token")
  view(@Param("token") token: string) {
    return this.plans.byShareToken(token);
  }
}
