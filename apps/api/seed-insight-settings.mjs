import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
await p.insightSettings.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
console.log("InsightSettings upserted");
await p.$disconnect();
