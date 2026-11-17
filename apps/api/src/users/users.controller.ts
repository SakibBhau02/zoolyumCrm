import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
} from "@nestjs/common";
import { UsersService } from "./users.service";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { modulePermission } from "../common/module-keys";

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: any) {
    // Owner sees everything; otherwise the caller needs the PEOPLE module (HR
    // directory) or CONTROL (user administration) to receive email addresses.
    const canSeeEmails =
      user?.role === "Owner" ||
      !!(modulePermission(user?.permissions, "PEOPLE")?.view ||
        modulePermission(user?.permissions, "PEOPLE")?.edit ||
        modulePermission(user?.permissions, "CONTROL")?.edit);
    return this.users.list(canSeeEmails);
  }

  @Patch(":id/role")
  @Roles("Owner")
  updateRole(@Param("id") id: string, @Body() body: { roleId: string }, @CurrentUser("sub") actorId: string) {
    return this.users.updateRole(id, body.roleId, actorId);
  }

  @Patch(":id/active")
  @Roles("Owner")
  toggleActive(@Param("id") id: string, @Body() body: { isActive: boolean }, @CurrentUser("sub") actorId: string) {
    return this.users.toggleActive(id, body.isActive, actorId);
  }
}
