/**
 * Idempotent calendar demo seed.
 *
 * Unlike `seed.ts` this never wipes anything: it only fills the calendar when
 * it is empty, assigns client colours, and grants the CALENDAR permission to
 * roles that already had FLOW. Safe to run on an existing dev database.
 *
 *   npx tsx prisma/seed-calendar.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const bdt = (n: string | number) => new Prisma.Decimal(n);

const daysAgo = (n: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const daysFromNow = (n: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const dayKey = (d: Date) => new Date(d.getTime() + 6 * 3600_000).toISOString().slice(0, 10);

const PALETTE = ["#7C3AED", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#14B8A6", "#8B5CF6", "#F97316"];

async function main() {
  // 1) Roles — mirror FLOW into CALENDAR once.
  for (const role of await prisma.role.findMany()) {
    const perms: any = role.modulePermissions ?? {};
    if (!perms.CALENDAR) {
      perms.CALENDAR = perms.FLOW ?? { view: true, edit: false, approve: false };
      await prisma.role.update({ where: { id: role.id }, data: { modulePermissions: perms } });
    }
  }
  console.log("✓ CALENDAR permission present on every role");

  // 2) Client colours + posting targets.
  const clients = await prisma.client.findMany({ orderBy: { companyName: "asc" } });
  let i = 0;
  for (const c of clients) {
    if (c.calendarColor) continue;
    await prisma.client.update({
      where: { id: c.id },
      data: {
        calendarColor: PALETTE[i++ % PALETTE.length],
        postingTargets:
          c.companyName === "Green Valley School"
            ? { INSTAGRAM: 16, FACEBOOK: 12, LINKEDIN: 4 }
            : c.companyName === "GlowSkin Beauty"
              ? { INSTAGRAM: 20, TIKTOK: 12, FACEBOOK: 8 }
              : { FACEBOOK: 8, INSTAGRAM: 8 },
      },
    });
  }
  console.log(`✓ Client colours checked (${clients.length} clients)`);

  const existing = await prisma.contentPost.count();
  if (existing > 0) {
    console.log(`• ${existing} content posts already exist — skipping demo data`);
    return;
  }

  const byName = new Map(clients.map((c) => [c.companyName, c]));
  const gvs = byName.get("Green Valley School") ?? clients[0];
  const glow = byName.get("GlowSkin Beauty") ?? clients[1] ?? clients[0];
  const bangla = byName.get("BanglaMart") ?? clients[2] ?? clients[0];
  if (!gvs) {
    console.log("• No clients found — nothing to seed");
    return;
  }

  const employees = await prisma.employee.findMany({ take: 5, orderBy: { joinDate: "asc" } });
  const owner = await prisma.user.findFirst({ where: { role: { name: "Owner" } } });
  const lamia = (await prisma.employee.findFirst({ where: { name: { contains: "Lamia" } } })) ?? employees[0];

  // 3) Social accounts
  if ((await prisma.clientPlatformAccount.count()) === 0) {
    await prisma.clientPlatformAccount.createMany({
      data: [
        { clientId: gvs.id, platform: "FACEBOOK", handle: "@greenvalleyschool", isPrimary: true, followers: 18400 },
        { clientId: gvs.id, platform: "INSTAGRAM", handle: "@greenvalley.school", isPrimary: true, followers: 12200 },
        { clientId: gvs.id, platform: "LINKEDIN", handle: "green-valley-school", followers: 3100 },
        { clientId: glow.id, platform: "INSTAGRAM", handle: "@glowskin.bd", isPrimary: true, followers: 96800 },
        { clientId: glow.id, platform: "TIKTOK", handle: "@glowskinbd", isPrimary: true, followers: 44100 },
        { clientId: bangla.id, platform: "FACEBOOK", handle: "@BanglaMart", isPrimary: true, followers: 210000 },
      ],
    });
  }

  // 4) Pillars
  let gvsPillars = await prisma.contentPillar.findMany({ where: { clientId: gvs.id } });
  if (!gvsPillars.length) {
    gvsPillars = await Promise.all(
      [
        { name: "Educational", color: "#0EA5E9", targetPct: 40 },
        { name: "Admission promo", color: "#F59E0B", targetPct: 35 },
        { name: "Campus life", color: "#10B981", targetPct: 25 },
      ].map((p) => prisma.contentPillar.create({ data: { clientId: gvs.id, ...p } }))
    );
  }
  let glowPillars = await prisma.contentPillar.findMany({ where: { clientId: glow.id } });
  if (!glowPillars.length) {
    glowPillars = await Promise.all(
      [
        { name: "Product", color: "#8B5CF6", targetPct: 45 },
        { name: "UGC", color: "#14B8A6", targetPct: 35 },
        { name: "Offer", color: "#EF4444", targetPct: 20 },
      ].map((p) => prisma.contentPillar.create({ data: { clientId: glow.id, ...p } }))
    );
  }

  // 5) Campaign + ad flights
  const campGvs = await prisma.campaign.create({
    data: {
      clientId: gvs.id,
      name: "Admission 2027 — Wave 1",
      objective: "leads",
      status: "ACTIVE",
      startDate: daysAgo(6),
      endDate: daysFromNow(24),
      totalBudget: bdt(180000),
      platforms: ["FACEBOOK", "INSTAGRAM"],
      color: "#7C3AED",
      notes: "Lead form + campus visit CTA. Creative refresh every 10 days.",
    },
  });
  const campGlow = await prisma.campaign.create({
    data: {
      clientId: glow.id,
      name: "Winter Glow Launch",
      objective: "sales",
      status: "PLAN",
      startDate: daysFromNow(3),
      endDate: daysFromNow(33),
      totalBudget: bdt(240000),
      platforms: ["INSTAGRAM", "TIKTOK"],
      color: "#8B5CF6",
    },
  });

  await prisma.adFlight.createMany({
    data: [
      {
        clientId: gvs.id,
        campaignId: campGvs.id,
        name: "Admission retargeting — Meta",
        platform: "FACEBOOK",
        objective: "leads",
        startDate: daysAgo(4),
        endDate: daysFromNow(10),
        dailyBudget: bdt(2500),
        totalBudget: bdt(35000),
        status: "LIVE",
        creativeNote: "Carousel of campus photos + testimonial video",
      },
      {
        clientId: gvs.id,
        campaignId: campGvs.id,
        name: "Admission awareness — IG Reels",
        platform: "INSTAGRAM",
        objective: "awareness",
        startDate: daysFromNow(2),
        endDate: daysFromNow(20),
        dailyBudget: bdt(1800),
        status: "PLANNED",
      },
      {
        clientId: glow.id,
        campaignId: campGlow.id,
        name: "Winter Glow — TikTok spark ads",
        platform: "TIKTOK",
        objective: "sales",
        startDate: daysFromNow(3),
        endDate: daysFromNow(33),
        dailyBudget: bdt(3000),
        status: "PLANNED",
      },
    ],
  });

  // 6) Posts
  const posts = [
    { client: gvs, pillar: gvsPillars[0], title: "Admission checklist — carousel", platforms: ["INSTAGRAM"], day: -5, time: "10:00", status: "PUBLISHED", format: "CAROUSEL", campaignId: campGvs.id },
    { client: gvs, pillar: gvsPillars[1], title: "Campus tour reel — 30s", platforms: ["FACEBOOK", "INSTAGRAM"], day: -3, time: "12:30", status: "PUBLISHED", format: "REEL", campaignId: campGvs.id },
    { client: gvs, pillar: gvsPillars[2], title: "Science lab day — photo set", platforms: ["INSTAGRAM"], day: -1, time: "16:00", status: "PUBLISHED", format: "STATIC" },
    { client: gvs, pillar: gvsPillars[1], title: "Admission deadline reminder", platforms: ["FACEBOOK"], day: 0, time: "11:00", status: "SCHEDULED", format: "STATIC", campaignId: campGvs.id },
    { client: gvs, pillar: gvsPillars[0], title: "Parent testimonial — Reel", platforms: ["INSTAGRAM", "FACEBOOK"], day: 1, time: "10:30", status: "SCHEDULED", format: "REEL", campaignId: campGvs.id },
    { client: gvs, pillar: gvsPillars[2], title: "Sports day highlights", platforms: ["INSTAGRAM"], day: 3, time: "17:00", status: "DRAFT", format: "REEL", approval: "INTERNAL_REVIEW" },
    { client: gvs, pillar: gvsPillars[0], title: "Syllabus explainer — LinkedIn article", platforms: ["LINKEDIN"], day: 5, time: "09:00", status: "SCHEDULED", format: "ARTICLE" },
    { client: gvs, pillar: gvsPillars[1], title: "Open day invite", platforms: ["FACEBOOK", "INSTAGRAM"], day: 8, time: "12:00", status: "SCHEDULED", format: "STATIC", campaignId: campGvs.id },
    { client: glow, pillar: glowPillars[0], title: "Winter serum — unboxing", platforms: ["INSTAGRAM", "TIKTOK"], day: -2, time: "19:00", status: "PUBLISHED", format: "REEL" },
    { client: glow, pillar: glowPillars[1], title: "Customer glow-up — UGC", platforms: ["INSTAGRAM"], day: 0, time: "20:00", status: "SCHEDULED", format: "STORY", campaignId: campGlow.id },
    { client: glow, pillar: glowPillars[2], title: "Winter bundle — 25% off", platforms: ["FACEBOOK", "INSTAGRAM"], day: 2, time: "18:30", status: "DRAFT", format: "STATIC", campaignId: campGlow.id, approval: "INTERNAL_REVIEW" },
    { client: glow, pillar: glowPillars[0], title: "Routine for dry skin — carousel", platforms: ["INSTAGRAM"], day: 4, time: "11:00", status: "SCHEDULED", format: "CAROUSEL" },
    { client: bangla, pillar: null, title: "Flash sale — 6 hours only", platforms: ["FACEBOOK"], day: 0, time: "09:00", status: "PUBLISHED", format: "STATIC" },
    { client: bangla, pillar: null, title: "Weekly grocery bundle", platforms: ["FACEBOOK", "INSTAGRAM"], day: 6, time: "10:00", status: "SCHEDULED", format: "STATIC" },
  ];

  for (const p of posts) {
    const at = new Date(daysFromNow(p.day, Number((p.time ?? "10:00").split(":")[0])));
    at.setMinutes(Number((p.time ?? "10:00").split(":")[1] ?? 0));
    await prisma.contentPost.create({
      data: {
        title: p.title,
        content: `${p.title} — demo caption for the calendar walkthrough.`,
        platforms: p.platforms,
        scheduledDate: dayKey(at),
        scheduledTime: p.time,
        scheduledAt: at,
        status: (p.status === "PUBLISHED" ? "PUBLISHED" : p.status === "SCHEDULED" ? "SCHEDULED" : "DRAFT") as any,
        publishStatus: p.status as any,
        approvalStatus: ((p as any).approval ?? (p.status === "PUBLISHED" ? "APPROVED" : "NONE")) as any,
        approvedAt: p.status === "PUBLISHED" ? daysAgo(2) : null,
        approvedById: p.status === "PUBLISHED" ? owner?.id ?? null : null,
        clientId: p.client.id,
        campaignId: (p as any).campaignId ?? null,
        pillarId: p.pillar?.id ?? null,
        assigneeId: lamia?.id ?? null,
        format: p.format as any,
        publishedAt: p.status === "PUBLISHED" ? at : null,
        hasImage: p.format !== "ARTICLE",
        hashtags: ["zoolyum", "demo"],
      },
    });
  }

  // 7) Events
  const events = [
    { title: "Green Valley — monthly review", type: "MEETING", day: -4, start: "11:00", end: "12:00", client: gvs, outcome: "DONE", visibility: "CLIENT" },
    { title: "Admission creative review", type: "MEETING", day: -1, start: "15:00", end: "15:45", client: gvs, outcome: "DONE" },
    { title: "GlowSkin — winter shoot", type: "SHOOT", day: 0, start: "09:30", end: "13:00", client: glow, outcome: "PENDING", visibility: "CLIENT", location: "Studio 4, Banani" },
    { title: "BanglaMart weekly sync", type: "MEETING", day: 0, start: "16:00", end: "16:30", client: bangla, outcome: "PENDING" },
    { title: "Campaign kickoff — Admission Wave 1", type: "CAMPAIGN", day: 1, start: "10:00", end: "11:00", client: gvs, outcome: "PENDING" },
    { title: "Content deadline — November batch", type: "DEADLINE", day: 3, allDay: true, client: gvs, outcome: "PENDING" },
    { title: "Winter Glow launch day", type: "CAMPAIGN", day: 3, allDay: true, client: glow, outcome: "PENDING", visibility: "CLIENT" },
  ];
  for (const e of events) {
    await prisma.calendarEvent.create({
      data: {
        title: e.title,
        type: e.type as any,
        date: dayKey(daysFromNow(e.day, 10)),
        startTime: e.allDay ? null : e.start,
        endTime: e.allDay ? null : e.end,
        allDay: !!e.allDay,
        outcome: (e.outcome ?? "PENDING") as any,
        visibility: (e.visibility ?? "INTERNAL") as any,
        clientId: e.client.id,
        location: (e as any).location ?? null,
        attendeeIds: lamia ? [lamia.id] : [],
        createdById: owner?.id ?? null,
        notes: "Seeded demo event.",
      },
    });
  }

  // 8) Deliverable dates (only where missing)
  const projects = await prisma.project.findMany({ select: { id: true }, take: 4 });
  for (let k = 0; k < projects.length; k++) {
    await prisma.projectDeliverable.updateMany({
      where: { projectId: projects[k].id, dueDate: null },
      data: { dueDate: daysFromNow(4 + k * 3), startDate: daysAgo(2), clientVisible: k < 2 },
    });
  }

  console.log(`✓ Calendar demo seeded: ${posts.length} posts, ${events.length} events`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
