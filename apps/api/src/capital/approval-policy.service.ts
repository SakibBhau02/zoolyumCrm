import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export type ApprovalRule = { role: string; limit: number };

export type ApprovalPolicy = {
  /** When off, any finance-capable role may approve any amount (legacy behaviour). */
  enabled: boolean;
  /** Per-role ceiling. A role can approve up to (and including) its limit. */
  rules: ApprovalRule[];
  /** The person who submitted an expense may not approve it. */
  requireDifferentApprover: boolean;
};

export const DEFAULT_POLICY: ApprovalPolicy = {
  enabled: true,
  rules: [
    { role: "Finance", limit: 20000 },
    { role: "HR/Admin", limit: 50000 },
    { role: "Admin", limit: 100000 },
    { role: "Owner", limit: 0 }, // 0 = unlimited
  ],
  requireDifferentApprover: true,
};

/**
 * Expense approval matrix.
 *
 * Before this, any signed-in user could PATCH `approvalStatus: APPROVED` on any
 * expense — including their own, at any amount. In an agency that is the single
 * easiest way to lose money quietly, so the rule now lives server-side:
 *
 *   who (role) × how much (amount) × was it their own submission
 *
 * Limits are stored in `Settings.financeConfig.approvalPolicy` so they are
 * editable without a migration, and the check is applied on every transition
 * into APPROVED — new records and edits alike.
 */
@Injectable()
export class ApprovalPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  private async read(): Promise<ApprovalPolicy> {
    const s = await this.prisma.settings.findUnique({ where: { id: "default" }, select: { financeConfig: true } });
    const cfg: any = s?.financeConfig ?? {};
    const stored = cfg?.approvalPolicy;
    if (!stored) return DEFAULT_POLICY;
    return {
      enabled: stored.enabled !== false,
      rules: Array.isArray(stored.rules) && stored.rules.length ? stored.rules.map((r: any) => ({ role: String(r.role ?? ""), limit: Number(r.limit ?? 0) })) : DEFAULT_POLICY.rules,
      requireDifferentApprover: stored.requireDifferentApprover !== false,
    };
  }

  async get() {
    return this.read();
  }

  async update(body: Partial<ApprovalPolicy>) {
    const current = await this.read();
    const rules = Array.isArray(body.rules)
      ? body.rules
          .filter((r) => r?.role && String(r.role).trim())
          .map((r) => ({ role: String(r.role).trim(), limit: Math.max(0, Number(r.limit) || 0) }))
      : current.rules;
    const next: ApprovalPolicy = {
      enabled: body.enabled ?? current.enabled,
      rules,
      requireDifferentApprover: body.requireDifferentApprover ?? current.requireDifferentApprover,
    };
    const s = await this.prisma.settings.findUnique({ where: { id: "default" }, select: { financeConfig: true } });
    const cfg: any = (s?.financeConfig as any) ?? {};
    await this.prisma.settings.upsert({
      where: { id: "default" },
      update: { financeConfig: { ...cfg, approvalPolicy: next } },
      create: { id: "default", financeConfig: { approvalPolicy: next } },
    });
    return next;
  }

  /** The actor's ceiling. `null` means "not allowed to approve at all". */
  limitFor(policy: ApprovalPolicy, roleName: string): number | null {
    const rule = policy.rules.find((r) => r.role.toLowerCase() === roleName.toLowerCase());
    if (!rule) return null;
    return rule.limit; // 0 = unlimited
  }

  /**
   * Throws unless the actor may approve this specific expense.
   * Called on the APPROVED transition — never on ordinary edits.
   */
  async assertCanApprove(input: { actorId?: string; amount: number; submittedById?: string | null }) {
    const policy = await this.read();
    if (!policy.enabled) return { allowed: true as const, limit: 0, policy };

    const actor = input.actorId
      ? await this.prisma.user.findUnique({ where: { id: input.actorId }, select: { id: true, role: { select: { name: true } } } })
      : null;
    const roleName = String((actor as any)?.role?.name ?? "");
    if (!roleName) throw new ForbiddenException("Only staff with a finance role can approve expenses");

    // Self-approval: the submitter cannot wave their own spend through.
    if (policy.requireDifferentApprover && input.actorId && input.submittedById && input.actorId === input.submittedById) {
      throw new ForbiddenException("You cannot approve an expense you submitted yourself");
    }

    const limit = this.limitFor(policy, roleName);
    if (limit === null) throw new ForbiddenException(`${roleName} is not on the approval matrix`);
    if (limit > 0 && Number(input.amount) > limit) {
      throw new ForbiddenException(
        `${roleName} can approve up to ৳${limit.toLocaleString("en-US")} — this expense is ৳${Number(input.amount).toLocaleString("en-US")}. Ask a higher approver.`
      );
    }
    return { allowed: true as const, limit, policy };
  }

  /**
   * UI-facing capability map, so the buttons tell the truth before a click.
   * Returns null when the caller is not a finance approver at all.
   */
  async capability(actorRole: string | undefined | null, amount: number, submittedById?: string | null, actorId?: string) {
    const policy = await this.read();
    if (!policy.enabled) return { canApprove: true, reason: null as string | null, limit: 0 };
    const roleName = String(actorRole ?? "");
    const limit = this.limitFor(policy, roleName);
    if (limit === null) return { canApprove: false, reason: "Your role is not an expense approver", limit: null };
    if (policy.requireDifferentApprover && actorId && submittedById && actorId === submittedById) {
      return { canApprove: false, reason: "You submitted this expense", limit };
    }
    if (limit > 0 && amount > limit) {
      return { canApprove: false, reason: `Above your limit of ৳${limit.toLocaleString("en-US")}`, limit };
    }
    return { canApprove: true, reason: null as string | null, limit };
  }

  validate(body: Partial<ApprovalPolicy>) {
    if (body.rules) {
      for (const r of body.rules) {
        if (!r?.role) throw new BadRequestException("Each rule needs a role");
        if (Number.isNaN(Number(r.limit))) throw new BadRequestException("Limit must be a number (0 = unlimited)");
      }
    }
    return true;
  }
}
