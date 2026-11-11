import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { AttendanceService } from "./attendance.service";
import { Public } from "../common/decorators/public.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";

// ZKTeco Push (ADMS) protocol endpoints — the fingerprint device polls
// GET /api/iclock/getrequest?SN=xxx and POSTs punch logs to
// /api/iclock/cdata?SN=xxx&table=ATTLOG as tab-separated rows:
//   <PIN>\t<YYYY-MM-DD HH:MM:SS>\t<verify>\t<workcode>
// The device has no JWT, so these routes are @Public. Devices speak
// text/plain (NOT JSON), so cdata must read the raw body — see the
// express.text() middleware wired in PeopleModule. All replies are plain
// "OK" with text/plain content type, which is what the firmware expects.
//
// A device cannot present a login, so the only defence is a shared key in the
// device's server URL: /api/iclock/cdata?SN=xxx&key=<ICLOCK_DEVICE_KEY>.
// When ICLOCK_DEVICE_KEY is unset (local development) the check is skipped so
// existing devices keep working; production must set it.
@Controller("iclock")
export class IclockController {
  constructor(private readonly attendance: AttendanceService) {}

  /**
   * Reject a request that did not present the configured device key.
   *
   * Fails CLOSED in production: a missing ICLOCK_DEVICE_KEY used to mean "no
   * authentication at all", so anyone on the network could post punches for any
   * PIN and fabricate attendance / overtime. Local development stays open so an
   * unconfigured terminal still works, but production refuses to serve.
   */
  private assertDevice(key?: string, sn?: string) {
    const expected = process.env.ICLOCK_DEVICE_KEY?.trim();
    if (!expected) {
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException("Attendance device key is not configured (set ICLOCK_DEVICE_KEY)");
      }
      if (!sn) throw new BadRequestException("SN is required");
      return;
    }
    const given = Buffer.from(String(key ?? ""), "utf8");
    const want = Buffer.from(expected, "utf8");
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throw new ForbiddenException("Unknown attendance device");
    }
    if (!sn) throw new BadRequestException("SN is required");
  }

  @Public()
  @RateLimit({ limit: 240, windowSec: 60, name: "iclock.getrequest" })
  @Get("getrequest")
  @Header("Content-Type", "text/plain")
  async getRequest(@Query("SN") sn: string, @Query("key") key?: string) {
    this.assertDevice(key, sn);
    await this.attendance.touchDevice(sn).catch(() => {});
    return this.attendance.iclockGetRequest(sn);
  }

  // Some firmware polls options via GET cdata (handshake).
  @Public()
  @RateLimit({ limit: 240, windowSec: 60, name: "iclock.cdata.get" })
  @Get("cdata")
  @Header("Content-Type", "text/plain")
  async cdataGet(@Query("SN") sn: string, @Query("key") key?: string) {
    this.assertDevice(key, sn);
    await this.attendance.touchDevice(sn).catch(() => {});
    return "OK";
  }

  @Public()
  @RateLimit({ limit: 60, windowSec: 60, name: "iclock.devicecmd" })
  @Get("devicecmd")
  @Header("Content-Type", "text/plain")
  deviceCmd(@Query("SN") sn: string, @Query("key") key?: string) {
    this.assertDevice(key, sn);
    return "OK";
  }

  // Firmware posts command results here (some models use POST).
  @Public()
  @RateLimit({ limit: 60, windowSec: 60, name: "iclock.devicecmd.post" })
  @Post("devicecmd")
  @Header("Content-Type", "text/plain")
  deviceCmdPost(@Query("SN") sn: string, @Query("key") key?: string) {
    this.assertDevice(key, sn);
    return "OK";
  }

  @Public()
  @RateLimit({ limit: 240, windowSec: 60, name: "iclock.cdata" })
  @Post("cdata")
  @Header("Content-Type", "text/plain")
  async cdata(
    @Query("SN") sn: string,
    @Query("table") table: string,
    @Query("key") key: string | undefined,
    @Body() body: any,
    @Req() req: any
  ) {
    this.assertDevice(key, sn);
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
