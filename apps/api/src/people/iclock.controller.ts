import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { AttendanceService } from "./attendance.service";
import { Public } from "../common/decorators/public.decorator";

// ZKTeco Push SDK protocol endpoints — the fingerprint device polls
// GET /api/iclock/getrequest?SN=xxx and POSTs punch logs to
// /api/iclock/cdata?SN=xxx&table=ATTLOG as tab-separated rows:
//   <PIN>\t<YYYY-MM-DD HH:MM:SS>\t<verify>\t<workcode>
// The device has no JWT, so these routes are @Public.
@Controller("iclock")
export class IclockController {
  constructor(private readonly attendance: AttendanceService) {}

  @Public()
  @Get("getrequest")
  getRequest(@Query("SN") sn: string) {
    return this.attendance.iclockGetRequest(sn);
  }

  @Public()
  @Get("devicecmd")
  deviceCmd(@Query("SN") sn: string) {
    return "OK";
  }

  @Public()
  @Post("cdata")
  async cdata(@Query("SN") sn: string, @Query("table") table: string, @Body() body: any) {
    let raw = typeof body === "string" ? body : "";
    if (!raw && body && typeof body === "object") {
      raw = Object.keys(body)
        .filter((k) => k.includes("\t") || k.includes("-"))
        .join("\n");
    }
    const reply = await this.attendance.iclockPushData(sn, table, raw);
    return reply;
  }
}