/**
 * Demo advertising data for the client portal (P2).
 *
 * Creates a Meta + Google ad account for one client, a few campaigns, and
 * ~90 days of campaign-grain AdInsight rows so the portal Performance tab has
 * something realistic to render.
 *
 *   npx tsx prisma/portal-ads-demo.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function rnd(seed: number) {
  // Deterministic pseudo-random so re-runs produce the same chart.
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

async function main() {
  const client = await prisma.client.findFirst({
    where: { projects: { some: {} } },
    orderBy: { createdAt: "asc" },
    select: { id: true, companyName: true },
  });
  if (!client) throw new Error("Run the seed first.");

  // Clean previous demo rows for this client so the script is idempotent.
  await prisma.adInsight.deleteMany({ where: { clientId: client.id } });
  await prisma.adSyncLog.deleteMany({ where: { adAccount: { clientId: client.id } } });
  await prisma.adCampaign.deleteMany({ where: { adAccount: { clientId: client.id } } });
  await prisma.adAccount.deleteMany({ where: { clientId: client.id } });

  const accounts = await Promise.all([
    prisma.adAccount.create({
      data: {
        clientId: client.id,
        provider: "META",
        externalId: `demo_meta_${client.id.slice(-6)}`,
        name: `${client.companyName} — Meta Ads`,
        status: "CONNECTED",
        lastSyncAt: new Date(Date.now() - 2 * 3600 * 1000),
      },
    }),
    prisma.adAccount.create({
      data: {
        clientId: client.id,
        provider: "GOOGLE",
        externalId: `demo_google_${client.id.slice(-6)}`,
        name: `${client.companyName} — Google Ads`,
        status: "CONNECTED",
        lastSyncAt: new Date(Date.now() - 3 * 3600 * 1000),
      },
    }),
  ]);
  const [meta, google] = accounts;

  const campaignSpecs = [
    { acc: meta, name: "Admission — Lead Gen (Meta)", budget: 60000, objective: "LEAD_GENERATION", cpm: 145, ctr: 1.9, cvr: 0.055, aov: 700 },
    { acc: meta, name: "Retargeting — Website Visitors", budget: 25000, objective: "CONVERSIONS", cpm: 190, ctr: 2.6, cvr: 0.09, aov: 500 },
    { acc: google, name: "Search — Admission Keywords", budget: 45000, objective: "SEARCH", cpm: 320, ctr: 4.4, cvr: 0.075, aov: 550 },
    { acc: google, name: "Performance Max — Brand", budget: 20000, objective: "PERFORMANCE_MAX", cpm: 260, ctr: 3.1, cvr: 0.06, aov: 650 },
  ];

  const campaigns = [];
  for (const spec of campaignSpecs) {
    campaigns.push(
      await prisma.adCampaign.create({
        data: {
          adAccountId: spec.acc.id,
          externalId: `demo_${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 28)}`,
          name: spec.name,
          status: "ENABLED",
          budget: spec.budget,
          objective: spec.objective,
        },
      })
    );
  }

  const days = 90;
  const today = new Date();
  let rows = 0;

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    for (let c = 0; c < campaignSpecs.length; c++) {
      const spec = campaignSpecs[c];
      const campaign = campaigns[c];
      const r = rnd(i * 7919 + c * 104729 + 17);

      // Gentle weekly seasonality + noise; spend capped near daily budget.
      const dow = date.getUTCDay();
      const seasonal = dow === 0 || dow === 6 ? 0.72 : 1;
      const growth = 1 + ((days - i) / days) * 0.18;
      const dailyBudget = spec.budget / 30;
      const spend = Math.min(dailyBudget * 1.15, dailyBudget * (0.72 + r() * 0.5) * seasonal * growth);

      const cpm = spec.cpm * (0.88 + r() * 0.24);
      const impressions = Math.round((spend / cpm) * 1000);
      const ctr = spec.ctr * (0.82 + r() * 0.36) / 100;
      const clicks = Math.max(0, Math.round(impressions * ctr));
      const cvr = spec.cvr * (0.75 + r() * 0.5);
      const conversions = Math.max(0, Math.round(clicks * cvr));
      const aov = spec.aov * (0.9 + r() * 0.2);
      const conversionValue = Math.round(conversions * aov);

      const cpc = clicks ? spend / clicks : 0;

      await prisma.adInsight.create({
        data: {
          provider: spec.acc.provider,
          date,
          campaignId: campaign.id,
          adSetId: null,
          adId: null,
          adAccountId: spec.acc.id,
          clientId: client.id,
          impressions,
          clicks,
          spend: Math.round(spend * 100) / 100,
          conversions,
          conversionValue,
          reach: Math.round(impressions * 0.62),
          frequency: Math.round((impressions / Math.max(1, impressions * 0.62)) * 100) / 100,
          ctr: Math.round(ctr * 10000) / 100,
          cpc: Math.round(cpc * 10000) / 10000,
          cpm: Math.round(cpm * 10000) / 10000,
          cpa: conversions ? Math.round((spend / conversions) * 10000) / 10000 : null,
          roas: spend ? Math.round((conversionValue / spend) * 100) / 100 : null,
        },
      });
      rows++;
    }
  }

  const agg = await prisma.adInsight.aggregate({
    where: { clientId: client.id },
    _sum: { spend: true, conversions: true, conversionValue: true },
  });

  console.log(
    JSON.stringify(
      {
        client: client.companyName,
        accounts: accounts.length,
        campaigns: campaigns.length,
        insightRows: rows,
        totalSpend: Number(agg._sum.spend ?? 0).toFixed(2),
        conversions: agg._sum.conversions ?? 0,
        conversionValue: Number(agg._sum.conversionValue ?? 0).toFixed(2),
        roas: (Number(agg._sum.conversionValue ?? 0) / Number(agg._sum.spend ?? 1)).toFixed(2),
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
