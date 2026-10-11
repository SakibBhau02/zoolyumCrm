/**
 * Verify the per-day dedupe of overdue reminders without exposing a cron
 * endpoint. Runs the same query the cron uses, twice, and reports what would
 * be sent vs skipped on each pass.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function run(label) {
  const now = new Date();
  const in24h = new Date(now.getTime() + 86400000);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const tasks = await prisma.task.findMany({
    where: { status: { not: "DONE" }, archivedAt: null, isBlocked: false, dueDate: { not: null, lte: in24h } },
    select: { id: true, title: true, dueDate: true, assignedToId: true },
  });

  let wouldSend = 0;
  let skipped = 0;
  let noUser = 0;
  for (const t of tasks) {
    const emp = await prisma.employee.findUnique({
      where: { id: t.assignedToId ?? "__none__" },
      include: { user: { select: { id: true } } },
    });
    if (!emp?.user) { noUser++; continue; }

    const overdue = t.dueDate && t.dueDate < now;
    const type = overdue ? "TASK_OVERDUE" : "TASK_DUE_SOON";
    const link = `/tasks?task=${t.id}`;

    const already = await prisma.notification.findFirst({
      where: { userId: emp.user.id, type, link, createdAt: { gte: startOfDay } },
      select: { id: true },
    });
    if (already) { skipped++; continue; }
    wouldSend++;
    // actually write it so the second pass has something to find
    await prisma.notification.create({
      data: {
        userId: emp.user.id,
        type,
        title: overdue ? "Task overdue" : "Task due soon",
        message: overdue ? `"${t.title}" is past its due date.` : `"${t.title}" is due within 24 hours.`,
        link,
      },
    });
  }
  console.log(`${label}: scanned=${tasks.length} sent=${wouldSend} skipped=${skipped} noLinkedUser=${noUser}`);
  return { wouldSend, skipped };
}

async function main() {
  console.log("pass 1 (cold):");
  const p1 = await run("  first run ");
  console.log("pass 2 (should skip everything pass 1 sent):");
  const p2 = await run("  second run");

  const ok = p2.wouldSend === 0 && p2.skipped === p1.wouldSend;
  console.log(`\nDEDUPE ${ok ? "OK" : "FAILED"} — second pass sent ${p2.wouldSend}, skipped ${p2.skipped}`);

  // cleanup: remove the rows this script created
  const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const del = await prisma.notification.deleteMany({
    where: { type: { in: ["TASK_OVERDUE", "TASK_DUE_SOON"] }, createdAt: { gte: today } },
  });
  console.log(`cleanup: removed ${del.count} notification row(s)`);
  process.exit(ok ? 0 : 1);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
