import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/decorators/current-user.decorator";

export interface SearchHit {
  type: "lead" | "client" | "project" | "invoice" | "task";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

/**
 * Cross-module type-ahead used by the topbar search.
 *
 * Results are filtered by the caller's module permissions on the server, so a
 * role never discovers a module it cannot open (the input is not a back door).
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  private can(user: AuthUser, module: string): boolean {
    if (user.role === "Owner") return true;
    return user.permissions?.[module]?.view === true;
  }

  async search(rawQuery: string, user: AuthUser): Promise<SearchHit[]> {
    const q = String(rawQuery ?? "").trim();
    if (q.length < 2) return [];
    const contains = { contains: q, mode: "insensitive" as const };

    const [leads, clients, projects, invoices, tasks] = await Promise.all([
      this.can(user, "PULSE")
        ? this.prisma.lead.findMany({
            where: { OR: [{ name: contains }, { company: contains }, { uid: contains }] },
            select: { id: true, name: true, company: true, stage: true },
            take: 5,
            orderBy: { createdAt: "desc" },
          })
        : [],
      this.can(user, "ACCOUNTS")
        ? this.prisma.client.findMany({
            where: { companyName: contains },
            select: { id: true, companyName: true, healthLevel: true },
            take: 5,
            orderBy: { createdAt: "desc" },
          })
        : [],
      this.can(user, "FLOW")
        ? this.prisma.project.findMany({
            where: { OR: [{ name: contains }, { uid: contains }] },
            select: { id: true, name: true, uid: true, status: true },
            take: 5,
            orderBy: { createdAt: "desc" },
          })
        : [],
      this.can(user, "CAPITAL")
        ? this.prisma.invoice.findMany({
            where: { OR: [{ invoiceNumber: contains }, { client: { companyName: contains } }] },
            select: { id: true, invoiceNumber: true, status: true, client: { select: { companyName: true } } },
            take: 5,
            orderBy: { issueDate: "desc" },
          })
        : [],
      this.can(user, "TASKS")
        ? this.prisma.task.findMany({
            where: { title: contains, archivedAt: null },
            select: { id: true, title: true, status: true },
            take: 5,
            orderBy: { createdAt: "desc" },
          })
        : [],
    ]);

    return [
      ...leads.map((l) => ({
        type: "lead" as const,
        id: l.id,
        title: l.name,
        subtitle: [l.company, l.stage].filter(Boolean).join(" · "),
        href: `/pulse?lead=${l.id}`,
      })),
      ...clients.map((c) => ({
        type: "client" as const,
        id: c.id,
        title: c.companyName,
        subtitle: `${c.healthLevel} health`,
        href: `/accounts?client=${c.id}`,
      })),
      ...projects.map((p) => ({
        type: "project" as const,
        id: p.id,
        title: p.name,
        subtitle: [p.uid, p.status].filter(Boolean).join(" · "),
        href: `/flow/${p.id}`,
      })),
      ...invoices.map((i) => ({
        type: "invoice" as const,
        id: i.id,
        title: i.invoiceNumber,
        subtitle: [i.client?.companyName, i.status].filter(Boolean).join(" · "),
        href: `/capital/invoices?inv=${i.id}`,
      })),
      ...tasks.map((t) => ({
        type: "task" as const,
        id: t.id,
        title: t.title,
        subtitle: t.status,
        href: `/tasks?task=${t.id}`,
      })),
    ];
  }
}
