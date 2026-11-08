import type { PrismaService } from "../prisma/prisma.service";

/**
 * Keep the denormalised project KPIs truthful.
 *
 * `Project.spentAmount` and `Project.progress` used to be independent editable
 * fields, which is how a project could show "60% / 49% burn" while its tasks
 * were 0/2 done and its approved expenses were higher than the stored figure.
 * The task board, the portal and the finance report all derive those numbers,
 * so the stored copy has to be recomputed from the same source whenever a task
 * or an approved expense changes.
 *
 * - spent  = sum of APPROVED expenses (the same definition the profitability
 *            report uses, so the two screens can never disagree)
 * - progress = completed tasks / live tasks, but only when the project has
 *              tasks. A project tracked manually (0 tasks) keeps its own value.
 */
export async function recomputeProjectStats(
  prisma: PrismaService,
  projectId: string | null | undefined
): Promise<void> {
  if (!projectId) return;

  const [grouped, expenseSum, project] = await Promise.all([
    prisma.task.groupBy({
      by: ["status"],
      where: { projectId, archivedAt: null },
      _count: { _all: true },
    }),
    prisma.expense.aggregate({
      where: { projectId, approvalStatus: "APPROVED" },
      _sum: { amount: true },
    }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { progress: true },
    }),
  ]);

  if (!project) return;

  const total = grouped.reduce((sum, row) => sum + row._count._all, 0);
  const done = grouped.find((row) => row.status === "DONE")?._count._all ?? 0;

  const data: { spentAmount: number | string; progress?: number } = {
    spentAmount: Number(expenseSum._sum.amount ?? 0),
  };
  if (total > 0) {
    data.progress = Math.round((done / total) * 100);
  }

  await prisma.project.update({ where: { id: projectId }, data });
}
