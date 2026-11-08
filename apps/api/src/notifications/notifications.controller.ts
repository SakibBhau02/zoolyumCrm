import { Controller, Get, Patch, Post, Delete, Query, Param, Body, UnauthorizedException, Sse, MessageEvent } from "@nestjs/common";
import { Observable, from, interval, merge } from "rxjs";
import { map, startWith, switchMap } from "rxjs/operators";
import { NotificationsService } from "./notifications.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get("sse-token")
  sseToken(@CurrentUser("sub") userId: string) {
    return { token: this.service.signSseToken(userId), expiresIn: 120 };
  }

  @Public()
  @Sse("sse")
  sse(@Query("token") token: string): Observable<MessageEvent> {
    let payload;
    try {
      payload = this.service.verifySseToken(token);
    } catch {
      throw new UnauthorizedException("Invalid token");
    }
    const userId = payload.sub;
    const live = this.service.subscribe(userId);
    const count$ = interval(30000).pipe(
      startWith(0),
      switchMap(() => from(this.service.getUnreadCount(userId))),
      map((count) => ({ data: JSON.stringify({ type: "count", count }) }))
    );
    return merge(live.asObservable() as Observable<MessageEvent>, count$);
  }

  @Get()
  list(@CurrentUser("sub") userId: string, @Query() query: any) {
    return this.service.getForUser(userId, {
      limit: query.limit ? Number(query.limit) : undefined,
      skip: query.skip ? Number(query.skip) : undefined,
      unread: query.unread === "true" || query.unread === "1",
      category: query.category || undefined,
    });
  }

  @Get("summary")
  summary(@CurrentUser("sub") userId: string) {
    return this.service.getSummary(userId);
  }

  @Post()
  create(@CurrentUser("sub") userId: string, @Body() dto: { type: string; title: string; message: string; link?: string }) {
    return this.service.create(userId, dto.type, dto.title, dto.message, dto.link);
  }

  @Get("count")
  count(@CurrentUser("sub") userId: string) {
    return this.service.getUnreadCount(userId);
  }

  @Patch("read-all")
  readAll(@CurrentUser("sub") userId: string) {
    return this.service.markAllRead(userId);
  }

  @Delete()
  clear(@CurrentUser("sub") userId: string) {
    return this.service.clearAll(userId);
  }

  @Patch(":id/read")
  read(@CurrentUser("sub") userId: string, @Param("id") id: string) {
    return this.service.markRead(userId, id);
  }

  @Delete(":id")
  remove(@CurrentUser("sub") userId: string, @Param("id") id: string) {
    return this.service.deleteOne(userId, id);
  }

  // ── Preferences ──────────────────────────────────────────────────────
  @Get("preferences")
  preferences(@CurrentUser("sub") userId: string) {
    return this.service.getPreferences(userId);
  }

  @Post("preferences")
  updatePreference(
    @CurrentUser("sub") userId: string,
    @Body() dto: { type: string; channel: string; enabled: boolean }
  ) {
    return this.service.updatePreference(userId, dto.type, dto.channel, dto.enabled);
  }
}