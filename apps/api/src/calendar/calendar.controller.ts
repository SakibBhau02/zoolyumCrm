import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CalendarService } from "./calendar.service";

@Controller("calendar")
export class CalendarController {
  constructor(private readonly service: CalendarService) {}

  @Get("posts")
  posts(@Query("month") month?: string) {
    return this.service.listPosts(month);
  }

  @Get("stats")
  stats() {
    return this.service.postStats();
  }

  @Post("posts")
  createPost(@Body() dto: any) {
    return this.service.createPost(dto);
  }

  @Patch("posts/:id")
  updatePost(@Param("id") id: string, @Body() dto: any) {
    return this.service.updatePost(id, dto);
  }

  @Delete("posts/:id")
  deletePost(@Param("id") id: string) {
    return this.service.deletePost(id);
  }

  @Get("events")
  events(@Query("month") month?: string) {
    return this.service.listEvents(month);
  }

  @Post("events")
  createEvent(@Body() dto: any) {
    return this.service.createEvent(dto);
  }

  @Delete("events/:id")
  deleteEvent(@Param("id") id: string) {
    return this.service.deleteEvent(id);
  }

  @Get("targets")
  targets(@Query("period") period: string) {
    return this.service.listTargets(period);
  }

  @Post("targets")
  createTarget(@Body() dto: any) {
    return this.service.createTarget(dto);
  }

  @Patch("targets/:id")
  updateTarget(@Param("id") id: string, @Body() dto: any) {
    return this.service.updateTarget(id, dto);
  }

  @Delete("targets/:id")
  deleteTarget(@Param("id") id: string) {
    return this.service.deleteTarget(id);
  }
}