/**
 * Portal demo data for P1.
 *
 * The portal only shows tasks flagged `isClientVisible`, and task creation
 * defaults that flag to false — so a fresh database has an empty portal.
 * This script picks the busiest client, shares its tasks with the portal, and
 * makes sure a portal login exists.
 *
 *   npx tsx portal-demo.ts
 */
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const PORTAL_PASSWORD = "zoolyum123";

async function main() {
  const client = await prisma.client.findFirst({
    where: { projects: { some: {} } },
    include: {
      contacts: { orderBy: { isPrimary: "desc" } },
      projects: { select: { id: true, name: true, status: true } },
      accountOwner: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!client) throw new Error("No client with projects found — run the seed first.");
  if (!client.contacts.length) throw new Error(`Client "${client.companyName}" has no contacts.`);

  const contact = client.contacts[0];

  // 1) share every task of this client's projects with the portal
  const updated = await prisma.task.updateMany({
    where: { projectId: { in: client.projects.map((p) => p.id) }, archivedAt: null },
    data: { isClientVisible: true },
  });

  // 2) at least a couple of milestones visible, so progress bars have a source
  const milestones = await prisma.milestone.updateMany({
    where: { projectId: { in: client.projects.map((p) => p.id) } },
    data: { clientVisible: true },
  });

  // 3) portal login for the primary contact
  const passwordHash = await bcrypt.hash(PORTAL_PASSWORD, 10);
  const portalUser = await prisma.portalUser.upsert({
    where: { clientContactId: contact.id },
    create: { clientContactId: contact.id, passwordHash, isActive: true },
    update: { passwordHash, isActive: true },
  });
  await prisma.clientContact.update({
    where: { id: contact.id },
    data: { portalAccessEnabled: true, email: contact.email ?? `portal+${contact.id}@zoolyum.test` },
  });

  // 4) a SENT weekly update so the Overview has something to show
  const project = client.projects[0];
  if (project) {
    await prisma.projectReport.deleteMany({ where: { projectId: project.id, title: "Demo weekly update" } });
    await prisma.projectReport.create({
      data: {
        projectId: project.id,
        title: "Demo weekly update",
        periodStart: new Date(Date.now() - 7 * 86400000),
        periodEnd: new Date(),
        status: "SENT",
        sentAt: new Date(),
        completed: [
          { title: "Campaign setup reviewed", done: true },
          { title: "Creative round 1 delivered", done: true },
        ],
        pending: [
          { title: "Landing page copy — awaiting client input", due: new Date(Date.now() + 3 * 86400000).toISOString() },
        ],
        pmNotes: "Solid week: creative round 1 shipped, campaign structure approved. Waiting on landing page copy to launch.",
      },
    });
  }

  console.log(JSON.stringify({
    client: client.companyName,
    portalEmail: contact.email,
    portalPassword: PORTAL_PASSWORD,
    portalUserId: portalUser.id,
    projects: client.projects.length,
    tasksShared: updated.count,
    milestonesShared: milestones.count,
  }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
