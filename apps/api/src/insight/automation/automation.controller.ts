import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { SchedulerService } from "./scheduler.service";
import { AlertsService } from "./alerts.service";
import { DeliveryService } from "./delivery.service";

@Controller("insight/automation")
export class AutomationController {
  constructor(private readonly scheduler: SchedulerService, private readonly alerts: AlertsService, private readonly delivery: DeliveryService) {}

  @Get("schedules")
  schedules(){ return this.scheduler.list(); }
  @Post("schedules")
  createSched(@Body() body:any){ return this.scheduler.create(body); }
  @Patch("schedules/:id")
  updateSched(@Param("id") id:string, @Body() body:any){ return this.scheduler.update(id,body); }
  @Delete("schedules/:id")
  deleteSched(@Param("id") id:string){ return this.scheduler.remove(id); }
  @Post("schedules/:id/run-now")
  runNow(@Param("id") id:string){ return this.scheduler.runNow(id); }

  @Get("alerts")
  alertList(){ return this.alerts.list(); }
  @Post("alerts")
  createAlert(@Body() body:any){ return this.alerts.create(body); }
  @Patch("alerts/:id")
  updateAlert(@Param("id") id:string, @Body() body:any){ return this.alerts.update(id,body); }
  @Delete("alerts/:id")
  deleteAlert(@Param("id") id:string){ return this.alerts.remove(id); }
  @Post("alerts/evaluate")
  evalAlerts(){ return this.alerts.evaluate(); }

  @Post("deliveries/test")
  testDelivery(@Body() body:any){ return this.delivery.test(body); }
  @Get("deliveries")
  deliveries(){ return this.delivery.deliveries(); }
}
