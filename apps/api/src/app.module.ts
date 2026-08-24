import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { CacheModule } from "./cache/cache.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { PulseModule } from "./pulse/pulse.module";
import { AccountsModule } from "./accounts/accounts.module";
import { FlowModule } from "./flow/flow.module";
import { TasksModule } from "./tasks/tasks.module";
import { PeopleModule } from "./people/people.module";
import { CapitalModule } from "./capital/capital.module";
import { InsightModule } from "./insight/insight.module";
import { PortalModule } from "./portal/portal.module";
import { ControlModule } from "./control/control.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { CalendarModule } from "./calendar/calendar.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CacheModule,
    AuthModule,
    UsersModule,
    DashboardModule,
    PulseModule,
    AccountsModule,
    FlowModule,
    TasksModule,
    PeopleModule,
    CapitalModule,
    InsightModule,
    PortalModule,
    ControlModule,
    NotificationsModule,
    CalendarModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
