import { Module } from "@nestjs/common";
import { PeopleModule } from "../people/people.module";
import { TelegramConfigService } from "./telegram-config.service";
import { TelegramSenderService } from "./telegram-sender.service";
import { TelegramLinkService } from "./telegram-link.service";
import { TelegramCommandService } from "./telegram-command.service";
import { TelegramPollingService } from "./telegram-polling.service";
import { TelegramTriggersService } from "./telegram-triggers.service";
import { TelegramController } from "./telegram.controller";
import { TelegramWebhookController } from "./telegram-webhook.controller";

/**
 * Telegram delivery channel.
 *
 * Reads PeopleModule for the attendance/leave services the bot commands use.
 * `NotificationsService` deliberately does NOT import this module — it resolves
 * `TelegramSenderService` lazily through ModuleRef, which keeps the
 * notifications → telegram → people → notifications chain from becoming a
 * circular import.
 */
@Module({
  imports: [PeopleModule],
  controllers: [TelegramController, TelegramWebhookController],
  providers: [
    TelegramConfigService,
    TelegramSenderService,
    TelegramLinkService,
    TelegramCommandService,
    TelegramPollingService,
    TelegramTriggersService,
  ],
  exports: [TelegramConfigService, TelegramSenderService, TelegramLinkService],
})
export class TelegramModule {}
