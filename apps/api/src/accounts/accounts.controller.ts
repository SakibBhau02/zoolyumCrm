import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { AccountsService, CreateClientBody, ClientUpdateBody } from "./accounts.service";
import { CurrentUser, AuthUser } from "../common/decorators/current-user.decorator";
import {
  RequirePermission,
  SkipPermission,
} from "../common/decorators/require-permission.decorator";

@Controller("accounts")
@RequirePermission("ACCOUNTS")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get("overview")
  overview() {
    return this.accounts.overview();
  }

  /**
   * Minimal id/name list for pickers in Flow, Calendar and Capital. Those
   * modules are used by roles that may not have the Accounts module, so this
   * endpoint deliberately exposes no money or contact data.
   */
  @Get("client-lookup")
  @SkipPermission()
  clientLookup() {
    return this.accounts.clientLookup();
  }

  @Get("clients")
  list(@Query() query: { q?: string; health?: string; vertical?: string; ownerId?: string; category?: string }) {
    return this.accounts.list(query);
  }

  @Get("clients/:id")
  detail(@Param("id") id: string) {
    return this.accounts.detail(id);
  }

  @Post("clients")
  @RequirePermission("ACCOUNTS", "edit")
  create(@Body() body: CreateClientBody) {
    return this.accounts.create(body);
  }

  @Patch("clients/:id")
  @RequirePermission("ACCOUNTS", "edit")
  update(@Param("id") id: string, @Body() body: ClientUpdateBody) {
    return this.accounts.update(id, body);
  }

  @Delete("clients/:id")
  @RequirePermission("ACCOUNTS", "edit")
  remove(@Param("id") id: string) {
    return this.accounts.remove(id);
  }

  @Post("clients/:id/recompute-health")
  @RequirePermission("ACCOUNTS", "edit")
  recomputeHealth(@Param("id") id: string) {
    return this.accounts.recomputeHealth(id);
  }

  @Post("recompute-all")
  @RequirePermission("ACCOUNTS", "edit")
  recomputeAll() {
    return this.accounts.recomputeAll();
  }

  @Post("clients/:id/contacts")
  @RequirePermission("ACCOUNTS", "edit")
  addContact(@Param("id") id: string, @Body() body: { name: string; roleTitle?: string; email?: string; phone?: string; isPrimary?: boolean }) {
    return this.accounts.addContact(id, body);
  }

  @Patch("clients/:id/contacts/:contactId")
  @RequirePermission("ACCOUNTS", "edit")
  updateContact(
    @Param("id") id: string,
    @Param("contactId") contactId: string,
    @Body() body: { name?: string; roleTitle?: string; email?: string; phone?: string; isPrimary?: boolean }
  ) {
    return this.accounts.updateContact(id, contactId, body);
  }

  @Delete("clients/:id/contacts/:contactId")
  @RequirePermission("ACCOUNTS", "edit")
  removeContact(@Param("id") id: string, @Param("contactId") contactId: string) {
    return this.accounts.removeContact(id, contactId);
  }

  @Post("clients/:id/documents")
  @RequirePermission("ACCOUNTS", "edit")
  addDocument(
    @Param("id") id: string,
    @Body() body: { type: string; fileUrl: string },
    @CurrentUser() user: AuthUser
  ) {
    return this.accounts.addDocument(id, body, user?.sub);
  }

  @Delete("clients/:id/documents/:docId")
  @RequirePermission("ACCOUNTS", "edit")
  removeDocument(@Param("id") id: string, @Param("docId") docId: string) {
    return this.accounts.removeDocument(id, docId);
  }

  @Get("health/distribution")
  healthDistribution() {
    return this.accounts.healthDistribution();
  }
}