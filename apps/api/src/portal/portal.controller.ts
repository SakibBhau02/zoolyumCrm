import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { PortalService } from "./portal.service";

@Controller("portal")
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get("users")
  users() {
    return this.portal.users();
  }

  @Get("activity")
  activity() {
    return this.portal.activity();
  }

  @Get("comments")
  comments() {
    return this.portal.comments();
  }

  @Get("approvals")
  approvals() {
    return this.portal.approvals();
  }

  @Get("clients")
  clients() {
    return this.portal.clients();
  }

  @Post("users")
  createUser(@Body() body: { clientContactId: string; password: string }) {
    return this.portal.createPortalUser(body.clientContactId, body.password);
  }

  @Patch("users/:id/password")
  resetPassword(@Param("id") id: string, @Body() body: { password: string }) {
    return this.portal.resetPortalPassword(id, body.password);
  }

  @Patch("users/:id/access")
  setAccess(@Param("id") id: string, @Body() body: { isActive: boolean }) {
    return this.portal.setPortalAccess(id, body.isActive);
  }
}