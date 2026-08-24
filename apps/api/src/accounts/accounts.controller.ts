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

@Controller("accounts")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get("overview")
  overview() {
    return this.accounts.overview();
  }

  @Get("clients")
  list(@Query() query: { q?: string; health?: string; vertical?: string; ownerId?: string }) {
    return this.accounts.list(query);
  }

  @Get("clients/:id")
  detail(@Param("id") id: string) {
    return this.accounts.detail(id);
  }

  @Post("clients")
  create(@Body() body: CreateClientBody) {
    return this.accounts.create(body);
  }

  @Patch("clients/:id")
  update(@Param("id") id: string, @Body() body: ClientUpdateBody) {
    return this.accounts.update(id, body);
  }

  @Delete("clients/:id")
  remove(@Param("id") id: string) {
    return this.accounts.remove(id);
  }

  @Post("clients/:id/recompute-health")
  recomputeHealth(@Param("id") id: string) {
    return this.accounts.recomputeHealth(id);
  }

  @Post("recompute-all")
  recomputeAll() {
    return this.accounts.recomputeAll();
  }

  @Post("clients/:id/contacts")
  addContact(@Param("id") id: string, @Body() body: { name: string; roleTitle?: string; email?: string; phone?: string; isPrimary?: boolean }) {
    return this.accounts.addContact(id, body);
  }

  @Patch("clients/:id/contacts/:contactId")
  updateContact(
    @Param("id") id: string,
    @Param("contactId") contactId: string,
    @Body() body: { name?: string; roleTitle?: string; email?: string; phone?: string; isPrimary?: boolean }
  ) {
    return this.accounts.updateContact(id, contactId, body);
  }

  @Delete("clients/:id/contacts/:contactId")
  removeContact(@Param("id") id: string, @Param("contactId") contactId: string) {
    return this.accounts.removeContact(id, contactId);
  }

  @Post("clients/:id/documents")
  addDocument(
    @Param("id") id: string,
    @Body() body: { type: string; fileUrl: string },
    @CurrentUser() user: AuthUser
  ) {
    return this.accounts.addDocument(id, body, user?.sub);
  }

  @Delete("clients/:id/documents/:docId")
  removeDocument(@Param("id") id: string, @Param("docId") docId: string) {
    return this.accounts.removeDocument(id, docId);
  }

  @Get("health/distribution")
  healthDistribution() {
    return this.accounts.healthDistribution();
  }
}