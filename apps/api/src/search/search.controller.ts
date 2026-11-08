import { Controller, Get, Query } from "@nestjs/common";
import { SearchService } from "./search.service";
import { CurrentUser, AuthUser } from "../common/decorators/current-user.decorator";

/**
 * Global type-ahead. No `@RequirePermission` on the controller: the service
 * filters every collection by the caller's matrix, which keeps the endpoint
 * useful for any role while still hiding modules they cannot open.
 */
@Controller("search")
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  find(@Query("q") q: string, @CurrentUser() user: AuthUser) {
    return this.search.search(q, user);
  }
}
