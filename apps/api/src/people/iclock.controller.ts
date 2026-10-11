import { Body, Controller, Get, Header, Post, Query, Req } from "@nestjs/common";
import { AttendanceService } from "./attendance.service";
import { Public } from "../common/decorators/public.decorator";

// ZKTeco Push (ADMS) protocol endpoints — the fingerprint device polls
// GET /api/iclock/getrequest?SN=xxx and POSTs punch logs to
// /api/iclock/cdata?SN=xxx&table=ATTLOG as tab-separated rows:
//   <PIN>\t<YYYY-MM-DD HH:MM:SS>\t<verify>\t<workcode>
// The device has no JWT, so these routes are @Public. Devices speak
// text/plain (NOT JSON), so cdata must read the raw body — see the
// express.text() middleware wired in PeopleModule. All replies are plain
// "OK" with text/plain content type, which is what the firmware expects.
@Controller("iclock")
export class IclockController {
  constructor(private readonly attendance: AttendanceService) {}

  @Public()
  @Get("getrequest")
  @Header("Content-Type", "text/plain")
  async getRequest(@Query("SN") sn: string) {
    await this.attendance.touchDevice(sn).catch(() => {});
    return this.attendance.iclockGetRequest(sn);
  }

  // Some firmware polls options via GET cdata (handshake).
  @Public()
  @Get("cdata")
  @Header("Content-Type", "text/plain")
  async cdataGet(@Query("SN") sn: string) {
    await this.attendance.touchDevice(sn).catch(() => {});
    return "OK";
  }

  @Public()
  @Get("devicecmd")
  @Header("Content-Type", "text/plain")
  deviceCmd(@Query("SN") sn: string) {
    return "OK";
  }

  // Firmware posts command results here (some models use POST).
  @Public()
  @Post("devicecmd")
  @Header("Content-Type", "text/plain")
  deviceCmdPost() {
    return "OK";
  }

  @Public()
  @Post("cdata")
  @Header("Content-Type", "text/plain")
  async cdata(@Query("SN") sn: string, @Query("table") table: string, @Body() body: any, @Req() req: any) {
    let raw = "";
    if (typeof body === "string") raw = body;
    else if (Buffer.isBuffer(body)) raw = body.toString("utf-8");
    else if (req?.rawBody && Buffer.isBuffer(req.rawBody)) raw = req.rawBody.toString("utf-8");
    else if (body && typeof body === "object") {
      raw = Object.keys(body)
        .filter((k) => k.includes("\t") || k.includes("-"))
        .join("\n");
    }
    const reply = await this.attendance.iclockPushData(sn, table, raw);
    return reply;
  }
}
