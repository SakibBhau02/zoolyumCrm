import { PrismaClient } from "@prisma/client";

/**
 * One-off repair: seed tasks were created with `status: DONE` but no
 * `completedAt`, so burndown/cycle-time treated them as never completed.
 *
 * Scope is deliberately narrow — only rows whose title is in the seed's DONE
 * list AND that still have a null completedAt. We use the task's own dueDate as
 * the stamp because seeded DONE tasks are all in the past; this is a seed
 * artefact, not a general migration, so no heuristic is applied to real data.
 */
const SEED_DONE_TITLES = [
  "Brand film script",
  "Convocation edit final",
  "Site crawl & audit",
  "Write script v2",
  "Meta ads setup",
  "Influencer shortlist",
  "Shoot B-roll footage",
  "Platform setup + posting",
  "Monthly utilization report",
  "Monthly content calendar",
  "Payroll draft July",
];

const prisma = new PrismaClient();

async function main() {
  const candidates = await prisma.task.findMany({
    where: { status: "DONE", completedAt: null, title: { in: SEED_DONE_TITLES } },
    select: { id: true, title: true, dueDate: true, createdAt: true },
  });

  if (!candidates.length) {
    console.log("No seed DONE tasks need a completedAt stamp.");
    return;
  }

  let stamped = 0;
  for (const t of candidates) {
    const stamp = t.dueDate ?? t.createdAt;
    await prisma.task.update({ where: { id: t.id }, data: { completedAt: stamp } });
    console.log(`  stamped "${t.title}" -> ${stamp.toISOString().slice(0, 10)}`);
    stamped++;
  }
  console.log(`\nDone. ${stamped} seed task(s) backfilled.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
