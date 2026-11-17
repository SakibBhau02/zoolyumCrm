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
import { ApprovalPolicyService } from "./approval-policy.service";
import { LiabilitiesService } from "./liabilities.service";
import { DollarService } from "./dollar.service";
import { PeriodsService } from "./periods.service";
import { ManualJournalService } from "./manual-journal.service";
import { FixedAssetsService } from "./fixed-assets.service";
import { VatService } from "./vat.service";
import { BankReconciliationService } from "./bank-reconciliation.service";
import { FxRevaluationService } from "./fx-revaluation.service";
import { RevenueRecognitionService } from "./revenue-recognition.service";
import { ProvisionService } from "./provision.service";
import { TreasuryService } from "./treasury.service";
import { AuditExportService } from "./audit-export.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { WhatsappModule } from "../whatsapp/whatsapp.module";
import { AccountsModule } from "../accounts/accounts.module";
import { PublicInvoiceController } from "../whatsapp/public-invoice.controller";

@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule, WhatsappModule, AccountsModule],
  controllers: [CapitalController, PublicInvoiceController],
  providers: [
    CapitalService,
    LedgerService,
    InvoiceService,
    ExpenseService,
    ReportingService,
    BillingService,
    MastersService,
    ApprovalPolicyService,
    LiabilitiesService,
    DollarService,
    PeriodsService,
    ManualJournalService,
    FixedAssetsService,
    VatService,
    BankReconciliationService,
    FxRevaluationService,
    RevenueRecognitionService,
    ProvisionService,
    TreasuryService,
    AuditExportService,
  ],
  exports: [CapitalService],
})
export class CapitalModule {}
