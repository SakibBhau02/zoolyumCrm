/**
 * Production bootstrap.
 *
 * Creates ONLY the configuration a fresh install needs — roles, GL chart of
 * accounts, pipeline stages, settings, branding and one Owner login. It never
 * inserts demo leads/clients/invoices and never uses a known password.
 *
 * Usage:
 *   BOOTSTRAP_OWNER_EMAIL=you@company.com \
 *   BOOTSTRAP_OWNER_PASSWORD='a-long-random-password' \
 *   npx tsx prisma/bootstrap.ts
 *
 * Safe to re-run: every write is idempotent.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const perm = (view: boolean, edit: boolean, approve: boolean): Prisma.JsonObject => ({ view, edit, approve });

const MODULES = (spec: Record<string, [boolean, boolean, boolean]>) =>
  Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, perm(v[0], v[1], v[2])]));

const ROLES = [
  {
    name: "Owner",
    description: "Full visibility and control across every module",
    modulePermissions: MODULES({
      PULSE: [true, true, true], ACCOUNTS: [true, true, true], FLOW: [true, true, true],
      TASKS: [true, true, true], PEOPLE: [true, true, true], CAPITAL: [true, true, true],
      INSIGHT: [true, true, true], PORTAL: [true, true, true], CALENDAR: [true, true, true],
      CONTROL: [true, true, true],
    }),
  },
  {
    name: "Finance",
    description: "Money, invoices, expenses and financial reporting",
    modulePermissions: MODULES({
      PULSE: [false, false, false], ACCOUNTS: [true, false, false], FLOW: [true, false, false],
      TASKS: [true, false, false], PEOPLE: [true, false, false], CAPITAL: [true, true, true],
      INSIGHT: [true, false, false], PORTAL: [false, false, false], CALENDAR: [true, false, false],
      CONTROL: [false, false, false],
    }),
  },
  {
    name: "Sales/BD",
    description: "Leads, accounts and pipeline",
    modulePermissions: MODULES({
      PULSE: [true, true, true], ACCOUNTS: [true, true, false], FLOW: [true, false, false],
      TASKS: [true, false, false], PEOPLE: [false, false, false], CAPITAL: [false, false, false],
      INSIGHT: [true, false, false], PORTAL: [false, false, false], CALENDAR: [true, false, false],
      CONTROL: [false, false, false],
    }),
  },
  {
    name: "Project Manager",
    description: "Delivery, projects and tasks",
    modulePermissions: MODULES({
      PULSE: [true, false, false], ACCOUNTS: [true, true, false], FLOW: [true, true, true],
      TASKS: [true, true, false], PEOPLE: [true, false, false], CAPITAL: [true, false, false],
      INSIGHT: [true, false, false], PORTAL: [true, true, false], CALENDAR: [true, true, false],
      CONTROL: [false, false, false],
    }),
  },
  {
    name: "Team Member",
    description: "Own work, no company-wide visibility",
    modulePermissions: MODULES({
      PULSE: [false, false, false], ACCOUNTS: [false, false, false], FLOW: [true, false, false],
      TASKS: [true, true, false], PEOPLE: [true, false, false], CAPITAL: [false, false, false],
      INSIGHT: [false, false, false], PORTAL: [false, false, false], CALENDAR: [true, true, false],
      CONTROL: [false, false, false],
    }),
  },
  {
    name: "HR/Admin",
    description: "People, payroll and admin settings",
    modulePermissions: MODULES({
      PULSE: [false, false, false], ACCOUNTS: [false, false, false], FLOW: [false, false, false],
      TASKS: [false, false, false], PEOPLE: [true, true, true], CAPITAL: [true, false, false],
      INSIGHT: [false, false, false], PORTAL: [false, false, false], CALENDAR: [true, true, true],
      CONTROL: [true, true, false],
    }),
  },
];

const STAGES = [
  { name: "New", order: 0, slaDays: 2 },
  { name: "Contacted", order: 1, slaDays: 3 },
  { name: "Qualified", order: 2, slaDays: 4 },
  { name: "Proposal Sent", order: 3, slaDays: 5 },
  { name: "Negotiation", order: 4, slaDays: 7 },
  { name: "Won", order: 5, slaDays: 0 },
  { name: "Lost", order: 6, slaDays: 0 },
];

const GL_ACCOUNTS: { code: string; name: string; category: any }[] = [
  { code: "1100", name: "Accounts Receivable", category: "ASSET" },
  { code: "1200", name: "Cash & Bank", category: "ASSET" },
  { code: "2000", name: "Accounts Payable", category: "LIABILITY" },
  { code: "2100", name: "VAT Payable", category: "LIABILITY" },
  { code: "2200", name: "TDS / VDS Payable", category: "LIABILITY" },
  { code: "3000", name: "Retained Earnings", category: "LIABILITY" },
  { code: "4000", name: "Agency Revenue", category: "REVENUE" },
  { code: "4100", name: "Management Fees", category: "REVENUE" },
  { code: "4200", name: "Other Income", category: "REVENUE" },
  { code: "4300", name: "Discounts Allowed", category: "REVENUE" },
  { code: "5000", name: "Ad Spend", category: "DIRECT_COST" },
  { code: "5010", name: "Freelancer Payments", category: "DIRECT_COST" },
  { code: "5020", name: "Production Costs", category: "DIRECT_COST" },
  { code: "5030", name: "Salaries & Benefits", category: "OPEX" },
  { code: "5040", name: "Software & Subscriptions", category: "OPEX" },
  { code: "5050", name: "Rent & Office", category: "OPEX" },
  { code: "5060", name: "Utilities", category: "OPEX" },
  { code: "5070", name: "Marketing", category: "OPEX" },
  { code: "5080", name: "Travel", category: "OPEX" },
  { code: "5090", name: "Bank Charges", category: "OPEX" },
  { code: "5100", name: "Professional Fees", category: "OPEX" },
  { code: "6500", name: "Bad Debt", category: "OPEX" },
];

async function main() {
  const email = (process.env.BOOTSTRAP_OWNER_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD ?? "";
  const name = (process.env.BOOTSTRAP_OWNER_NAME ?? "Owner").trim();

  if (!email || !password) {
    throw new Error(
      "BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_PASSWORD are required.\n" +
        "Example: BOOTSTRAP_OWNER_EMAIL=you@company.com BOOTSTRAP_OWNER_PASSWORD='...' npm run bootstrap"
    );
  }
  if (password.length < 12) {
    throw new Error("BOOTSTRAP_OWNER_PASSWORD must be at least 12 characters");
  }

  console.log("Bootstrapping Zoolyum OS configuration…");

  // Roles (canonical module keys — see apps/api/src/common/module-keys.ts).
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }
  console.log(`  roles: ${ROLES.length}`);

  const ownerRole = await prisma.role.findUnique({ where: { name: "Owner" } });
  if (!ownerRole) throw new Error("Owner role missing after upsert");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`  owner: ${email} already exists — left untouched`);
  } else {
    await prisma.user.create({
      data: {
        name,
        email,
        // Cost 12 for staff credentials (portal used 10 before the audit).
        passwordHash: await bcrypt.hash(password, 12),
        roleId: ownerRole.id,
        isActive: true,
      },
    });
    console.log(`  owner: ${email} created`);
  }

  await prisma.settings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  await prisma.attendancePolicy.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  console.log("  settings + attendance policy ready");

  // Pipeline stages: create only when the table is empty (order is unique).
  if ((await prisma.pipelineStage.count()) === 0) {
    await prisma.pipelineStage.createMany({ data: STAGES });
    console.log(`  pipeline stages: ${STAGES.length}`);
  }

  // Chart of accounts: the ledger refuses to post without these codes.
  let accountsCreated = 0;
  for (const acct of GL_ACCOUNTS) {
    const found = await prisma.account.findFirst({ where: { code: acct.code }, select: { id: true } });
    if (!found) {
      await prisma.account.create({ data: acct });
      accountsCreated++;
    }
  }
  console.log(`  GL accounts: ${accountsCreated} created, ${GL_ACCOUNTS.length - accountsCreated} already present`);

  if ((await prisma.brandingConfig.count()) === 0) {
    await prisma.brandingConfig.create({
      data: { appName: "Zoolyum OS", defaultCurrency: "BDT", invoiceNumberingFormat: "ZLM-{year}-{seq}" },
    });
    console.log("  branding: default created");
  }

  console.log("\nBootstrap complete. Sign in with the owner email you provided.");
}

main()
  .catch((e) => {
    console.error(`\nBootstrap failed: ${e?.message ?? e}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
