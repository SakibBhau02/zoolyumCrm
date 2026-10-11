-- CreateTable
CREATE TABLE "InsightSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "reportDefaults" JSONB NOT NULL DEFAULT '{"datePreset": "30d", "metrics": ["spend","ctr","roas"], "dimensions": ["date"], "timezone": "Asia/Dhaka", "currency": "BDT", "comparePreset": "prev_period"}',
    "syncConfig" JSONB NOT NULL DEFAULT '{"interval": "6h", "backfillDays": 30, "retentionDays": 365}',
    "alertDefaults" JSONB NOT NULL DEFAULT '{"windowDays": 7, "ctrDropPct": 30, "spendSpikeX": 2, "cplLimit": 400, "dedupMinutes": 30}',
    "branding" JSONB NOT NULL DEFAULT '{"template": "executive", "includeCharts": true}',
    "automation" JSONB NOT NULL DEFAULT '{"defaultCron": "daily", "defaultRecipients": [], "format": "pdf"}',
    "exportConfig" JSONB NOT NULL DEFAULT '{"defaultFormat": "pdf", "includeCharts": true, "locale": "en-BD"}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "InsightSettings_pkey" PRIMARY KEY ("id")
);
