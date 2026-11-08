import { Controller, Get, Param } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { InvoiceService } from "../capital/invoice.service";

/** No-login invoice view for client share links (/p/inv/:token). */
@Public()
@Controller("public")
export class PublicInvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get("invoices/by-token/:token")
  @RateLimit({ limit: 60, windowSec: 60, name: "public.invoice" })
  byToken(@Param("token") token: string) {
    return this.invoices.publicInvoiceByToken(token);
  }
}
