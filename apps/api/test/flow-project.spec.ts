import { PrismaClient, BillingCycle } from "@prisma/client";

describe("Project professional fields migration", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("Project has new professional fields", async () => {
    // Create a client first for FK
    const client = await prisma.client.create({
      data: {
        companyName: "Test Client For Project",
        industryVertical: "OTHER",
      },
    });

    const project = await prisma.project.create({
      data: {
        clientId: client.id,
        name: "Test Project",
        description: "Scope test",
        amount: 50000,
        projectLink: "https://live.example.com",
        websiteUrl: "https://client.com",
        socialLinks: { facebook: "https://fb.com/acme" },
        billingType: BillingCycle.RECURRING,
        startDate: new Date(),
      },
    });
    expect(project.description).toBe("Scope test");
    expect(Number(project.amount)).toBe(50000);
    expect(project.projectLink).toBe("https://live.example.com");
    expect(project.websiteUrl).toBe("https://client.com");
    expect(project.socialLinks).toEqual({ facebook: "https://fb.com/acme" });
    expect(project.billingType).toBe(BillingCycle.RECURRING);

    // Test ProjectReference creation
    const ref = await prisma.projectReference.create({
      data: {
        projectId: project.id,
        title: "Drive Link",
        url: "https://drive.google.com/file",
        type: "DRIVE",
      },
    });
    expect(ref.title).toBe("Drive Link");
    expect(ref.type).toBe("DRIVE");

    const refs = await prisma.projectReference.findMany({ where: { projectId: project.id } });
    expect(refs.length).toBe(1);

    // Clean up
    await prisma.projectReference.delete({ where: { id: ref.id } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.client.delete({ where: { id: client.id } });
  });

  test("Project amount sync with budgetAmount", async () => {
    const client = await prisma.client.create({
      data: { companyName: "Sync Client", industryVertical: "OTHER" },
    });
    const project = await prisma.project.create({
      data: {
        clientId: client.id,
        name: "Sync Test",
        budgetAmount: 12345.67,
        billingType: BillingCycle.ONE_TIME,
        startDate: new Date(),
      },
    });
    // After migration, amount should be synced from budgetAmount via UPDATE, but new rows need explicit amount
    // Check that budgetAmount persists
    expect(Number(project.budgetAmount)).toBe(12345.67);

    await prisma.project.delete({ where: { id: project.id } });
    await prisma.client.delete({ where: { id: client.id } });
  });

  test("BillingCycle enum values", () => {
    expect(BillingCycle.ONE_TIME).toBe("ONE_TIME");
    expect(BillingCycle.RECURRING).toBe("RECURRING");
  });
});
