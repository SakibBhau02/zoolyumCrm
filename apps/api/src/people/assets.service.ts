import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export const ASSET_STATUSES = ["AVAILABLE", "ASSIGNED", "REPAIR", "RETIRED"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * Company asset register.
 *
 * An agency's second-biggest cost after salary is gear: laptops, cameras,
 * lenses, phones, licences. Before this, `employmentType: contract` existed but
 * nothing recorded who holds the camera. Assign/return keeps `status` and
 * `assignedToId` in lockstep so the two can never disagree.
 */
@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  /** AST-0001, AST-0002 … derived from the current numeric max (deletes would collide). */
  private async nextTag() {
    const rows = await this.prisma.asset.findMany({ select: { tag: true } });
    let max = 0;
    for (const r of rows) {
      const m = /^AST-(\d+)$/.exec(r.tag ?? "");
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `AST-${String(max + 1).padStart(4, "0")}`;
  }

  async list() {
    const rows = await this.prisma.asset.findMany({
      include: { assignedTo: { select: { id: true, name: true, roleTitle: true, department: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    return rows.map((a) => ({ ...a, value: a.value != null ? Number(a.value) : null }));
  }

  async summary() {
    const rows = await this.prisma.asset.findMany({ select: { status: true, value: true } });
    const byStatus = ASSET_STATUSES.reduce((acc, s) => ({ ...acc, [s]: rows.filter((r) => r.status === s).length }), {} as Record<AssetStatus, number>);
    const totalValue = rows.reduce((s, r) => s + Number(r.value ?? 0), 0);
    return { total: rows.length, byStatus, assigned: byStatus.ASSIGNED ?? 0, available: byStatus.AVAILABLE ?? 0, repair: byStatus.REPAIR ?? 0, totalValue };
  }

  async create(body: any) {
    if (!body?.name?.trim()) throw new BadRequestException("name is required");
    const status: AssetStatus = ASSET_STATUSES.includes(body.status) ? body.status : "AVAILABLE";
    // "Assigned to nobody" must not exist: the register would claim gear is out.
    if (status === "ASSIGNED" && !body.assignedToId) {
      throw new BadRequestException("Pick an employee before saving an asset as ASSIGNED");
    }
    if (body.assignedToId) {
      const emp = await this.prisma.employee.findUnique({ where: { id: body.assignedToId }, select: { id: true } });
      if (!emp) throw new BadRequestException("assignedToId does not match any employee");
    }
    return this.prisma.asset.create({
      data: {
        tag: body.tag?.trim() || (await this.nextTag()),
        name: body.name.trim(),
        category: body.category?.trim() || "Laptop",
        serialNumber: body.serialNumber?.trim() || null,
        status,
        purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : null,
        value: body.value != null && body.value !== "" ? Number(body.value) : null,
        notes: body.notes?.trim() || null,
        assignedToId: status === "ASSIGNED" ? (body.assignedToId ?? null) : null,
        assignedAt: status === "ASSIGNED" ? new Date() : null,
      },
    });
  }

  async update(id: string, body: any) {
    const existing = await this.prisma.asset.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Asset not found");
    const data: any = {};
    for (const f of ["name", "category", "serialNumber", "notes", "tag"]) {
      if (body[f] !== undefined) data[f] = body[f] === "" ? null : body[f];
    }
    if (body.value !== undefined) data.value = body.value === "" || body.value === null ? null : Number(body.value);
    if (body.purchaseDate !== undefined) data.purchaseDate = body.purchaseDate ? new Date(body.purchaseDate) : null;
    if (body.status !== undefined) {
      if (!ASSET_STATUSES.includes(body.status)) throw new BadRequestException("Unknown status");
      data.status = body.status;
      // Leaving ASSIGNED clears the holder; the two fields stay consistent.
      if (body.status !== "ASSIGNED") {
        data.assignedToId = null;
        data.assignedAt = null;
      }
    }
    return this.prisma.asset.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.prisma.asset.delete({ where: { id } }).catch((err) => {
      if (err?.code === "P2025") throw new NotFoundException("Asset not found");
      throw err;
    });
    return { ok: true };
  }

  async assign(id: string, employeeId: string) {
    if (!employeeId) throw new BadRequestException("employeeId is required");
    const [asset, emp] = await Promise.all([
      this.prisma.asset.findUnique({ where: { id } }),
      this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } }),
    ]);
    if (!asset) throw new NotFoundException("Asset not found");
    if (!emp) throw new NotFoundException("Employee not found");
    if (asset.status === "RETIRED") throw new BadRequestException("Retired assets cannot be assigned");
    // Silent re-assignment is how one laptop ends up "held" by two people.
    if (asset.status === "ASSIGNED" && asset.assignedToId && asset.assignedToId !== employeeId) {
      const holder = await this.prisma.employee.findUnique({ where: { id: asset.assignedToId }, select: { name: true } });
      throw new BadRequestException(`${asset.tag} is already with ${holder?.name ?? "another employee"} — return it first`);
    }
    return this.prisma.asset.update({
      where: { id },
      data: { status: "ASSIGNED", assignedToId: employeeId, assignedAt: new Date() },
    });
  }

  async returnAsset(id: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException("Asset not found");
    return this.prisma.asset.update({
      where: { id },
      data: { status: "AVAILABLE", assignedToId: null, assignedAt: null },
    });
  }

  async forEmployee(employeeId: string) {
    return this.prisma.asset.findMany({
      where: { assignedToId: employeeId },
      select: { id: true, tag: true, name: true, category: true, status: true, assignedAt: true, serialNumber: true },
      orderBy: { assignedAt: "desc" },
    });
  }

  /** Gear still attached to an employee who is leaving — used by offboarding UI. */
  async openForEmployee(employeeId: string) {
    return this.prisma.asset.count({ where: { assignedToId: employeeId } });
  }
}
