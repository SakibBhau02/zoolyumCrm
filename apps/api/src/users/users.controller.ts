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

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
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
