import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaModule } from "./prisma/prisma.module";
import { CacheModule } from "./cache/cache.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { RateLimitGuard } from "./common/guards/rate-limit.guard";
import { AdminPolicyGuard } from "./common/guards/admin-policy.guard";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { PulseModule } from "./pulse/pulse.module";
import { AccountsModule } from "./accounts/accounts.module";
import { ScoringModule } from "./scoring/scoring.module";
import { FlowModule } from "./flow/flow.module";
import { TasksModule } from "./tasks/tasks.module";
import { PeopleModule } from "./people/people.module";
import { CapitalModule } from "./capital/capital.module";
import { InsightModule } from "./insight/insight.module";
import { PortalModule } from "./portal/portal.module";
import { ControlModule } from "./control/control.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { CalendarModule } from "./calendar/calendar.module";
import { WhatsappModule } from "./whatsapp/whatsapp.module";
import { TelegramModule } from "./telegram/telegram.module";
import { SearchModule } from "./search/search.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Enables @Cron discovery. Without this, every @Cron in the codebase
    // (task reminders, snapshotter, timer watchdog) is silently dead code.
    ScheduleModule.forRoot(),
    PrismaModule,
    CacheModule,
    AuthModule,
    UsersModule,
    DashboardModule,
    PulseModule,
    AccountsModule,
    ScoringModule,
    FlowModule,
    TasksModule,
    PeopleModule,
    CapitalModule,
    InsightModule,
    PortalModule,
    ControlModule,
    NotificationsModule,
    CalendarModule,
    WhatsappModule,
    TelegramModule,
    SearchModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: AdminPolicyGuard },
  ],
})
export class AppModule {}
