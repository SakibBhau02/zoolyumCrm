import { Module } from "@nestjs/common";
import { WhatsappConfigService } from "./whatsapp-config.service";
import { WhatsappSenderService } from "./whatsapp-sender.service";
import { WhatsappTriggersService } from "./whatsapp-triggers.service";
import { WhatsappAdminController } from "./whatsapp.controller";
import { WhatsappWebhookController } from "./whatsapp-webhook.controller";

@Module({
  controllers: [WhatsappAdminController, WhatsappWebhookController],
  providers: [WhatsappConfigService, WhatsappSenderService, WhatsappTriggersService],
  exports: [WhatsappConfigService, WhatsappSenderService, WhatsappTriggersService],
})
export class WhatsappModule {}
