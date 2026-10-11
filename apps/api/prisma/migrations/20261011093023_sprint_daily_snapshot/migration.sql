-- CreateTable
CREATE TABLE "SprintDailySnapshot" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "total" INTEGER NOT NULL,
    "done" INTEGER NOT NULL,
    "open" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "estimatedHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "actualHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SprintDailySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SprintDailySnapshot_sprintId_idx" ON "SprintDailySnapshot"("sprintId");

-- CreateIndex
CREATE UNIQUE INDEX "SprintDailySnapshot_sprintId_date_key" ON "SprintDailySnapshot"("sprintId", "date");

-- AddForeignKey
ALTER TABLE "SprintDailySnapshot" ADD CONSTRAINT "SprintDailySnapshot_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
