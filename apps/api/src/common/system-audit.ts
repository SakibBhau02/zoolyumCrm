import type { PrismaService } from "../prisma/prisma.service";

export interface SystemAuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Append to the workspace audit trail.
 *
 * Deliberately swallows errors: an audit table problem must never abort the
 * business write it is describing. Callers that need proof-of-write should
 * also keep the FinanceAuditLog row inside their transaction.
 */
export async function writeSystemAudit(
  prisma: PrismaService,
  entry: SystemAuditEntry
): Promise<void> {
  try {
    await prisma.systemAuditLog.create({
      data: {
        actorUserId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        beforeValue: entry.before === undefined ? undefined : (entry.before as any),
        afterValue: entry.after === undefined ? undefined : (entry.after as any),
      },
    });
  } catch {
    /* auditing is best-effort */
  }
}
