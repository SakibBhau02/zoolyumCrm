import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { CapitalService } from "./capital.service";
import { CapitalController } from "./capital.controller";
import { LedgerService } from "./ledger.service";
import { InvoiceService } from "./invoice.service";
import { ExpenseService } from "./expense.service";
import { ReportingService } from "./reporting.service";
import { BillingService } from "./billing.service";
import { MastersService } from "./masters.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { WhatsappModule } from "../whatsapp/whatsapp.module";
import { PublicInvoiceController } from "../whatsapp/public-invoice.controller";

@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule, WhatsappModule],
  controllers: [CapitalController, PublicInvoiceController],
  providers: [
    CapitalService,
    LedgerService,
    InvoiceService,
    ExpenseService,
    ReportingService,
    BillingService,
    MastersService,
  ],
  exports: [CapitalService],
})
export class CapitalModule {}
