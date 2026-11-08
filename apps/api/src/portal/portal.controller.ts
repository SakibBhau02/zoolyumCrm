import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { PortalService } from "./portal.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";

@RequirePermission("PORTAL")
@Controller("portal")
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  // ── Portal users & monitoring ──────────────────────────────────────────
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

  // ── Staff → client messaging ───────────────────────────────────────────
  @Post("comments")
  reply(
    @Body() body: { threadKey: string; content: string; parentId?: string; clientId?: string },
    @CurrentUser("sub") authorId: string
  ) {
    return this.portal.replyToThread(body, authorId);
  }

  // ── Task visibility ────────────────────────────────────────────────────
  @Get("tasks/visibility-audit")
  visibilityAudit() {
    return this.portal.visibilityAudit();
  }

  @Patch("tasks/:id/visibility")
  setTaskVisibility(@Param("id") id: string, @Body() body: { isClientVisible: boolean }) {
    return this.portal.setTaskVisibility(id, !!body.isClientVisible);
  }

  @Post("projects/:id/tasks/visibility")
  bulkTaskVisibility(@Param("id") id: string, @Body() body: { isClientVisible: boolean }) {
    return this.portal.bulkTaskVisibility(id, !!body.isClientVisible);
  }

  // ── Per-contact access ─────────────────────────────────────────────────
  @Get("contacts/:id/access")
  contactAccess(@Param("id") id: string) {
    return this.portal.contactAccess(id);
  }

  @Patch("contacts/:id/access")
  updateContactAccess(
    @Param("id") id: string,
    @Body()
    body: { scope?: "ALL" | "CUSTOM"; projectIds?: string[]; modules?: string[]; canSeeAdSpend?: boolean }
  ) {
    return this.portal.updateContactAccess(id, body);
  }

  /** Renders the portal exactly as this contact sees it (no token issued). */
  @Get("preview/:id")
  preview(@Param("id") id: string) {
    return this.portal.preview(id);
  }
}
