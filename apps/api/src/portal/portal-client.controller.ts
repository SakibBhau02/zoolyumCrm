import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { PortalAuthGuard } from "./portal-auth.guard";
import { PortalClientService } from "./portal-client.service";

@Public()
@Controller("portal-client")
export class PortalClientController {
  constructor(private readonly portal: PortalClientService) {}

  @Post("login")
  login(@Body() body: { email: string; password: string }) {
    return this.portal.login(body.email, body.password);
  }

  @UseGuards(PortalAuthGuard)
  @Get("me")
  me(@Req() req: any) {
    return this.portal.me(req.portalUser.sub);
  }

  @UseGuards(PortalAuthGuard)
  @Get("dashboard")
  dashboard(@Req() req: any) {
    return this.portal.dashboard(req.portalUser.sub);
  }

  @UseGuards(PortalAuthGuard)
  @Get("projects")
  projects(@Req() req: any) {
    return this.portal.projects(req.portalUser.sub);
  }

  @UseGuards(PortalAuthGuard)
  @Get("invoices")
  invoices(@Req() req: any) {
    return this.portal.invoices(req.portalUser.sub);
  }

  @UseGuards(PortalAuthGuard)
  @Get("activity")
  activity(@Req() req: any) {
    return this.portal.activity(req.portalUser.sub);
  }

  @UseGuards(PortalAuthGuard)
  @Get("messages")
  messages(@Req() req: any, @Query("projectId") projectId?: string) {
    return this.portal.messages(req.portalUser.sub, projectId);
  }

  @UseGuards(PortalAuthGuard)
  @Post("projects/:projectId/messages")
  postMessage(@Req() req: any, @Param("projectId") projectId: string, @Body() body: { content: string }) {
    return this.portal.postMessage(req.portalUser.sub, projectId, body.content);
  }

  @UseGuards(PortalAuthGuard)
  @Post("files/:fileId/approval")
  approve(@Req() req: any, @Param("fileId") fileId: string, @Body() body: { decision: "APPROVED" | "REVISION_REQUESTED"; revisionNotes?: string }) {
    return this.portal.approveDeliverable(req.portalUser.sub, fileId, body.decision, body.revisionNotes);
  }
}