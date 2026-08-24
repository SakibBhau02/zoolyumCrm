-- Cross-cutting: Notifications, Preferences, Settings
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationPreference_userId_type_channel_key" ON "NotificationPreference"("userId", "type", "channel");

CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "companyProfile" JSONB NOT NULL DEFAULT '{}',
    "regional" JSONB NOT NULL DEFAULT '{}',
    "invoiceTemplate" JSONB NOT NULL DEFAULT '{}',
    "financeConfig" JSONB NOT NULL DEFAULT '{}',
    "pipelineStages" JSONB NOT NULL DEFAULT '[]',
    "leadCategories" JSONB NOT NULL DEFAULT '[]',
    "clientTiers" JSONB NOT NULL DEFAULT '[]',
    "healthScoreWeights" JSONB NOT NULL DEFAULT '[]',
    "taskStatuses" JSONB NOT NULL DEFAULT '[]',
    "taskAutomation" BOOLEAN NOT NULL DEFAULT true,
    "notifications" JSONB NOT NULL DEFAULT '[]',
    "integrations" JSONB NOT NULL DEFAULT '[]',
    "emailTemplates" JSONB NOT NULL DEFAULT '[]',
    "appearance" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- Task: new columns
ALTER TABLE "Task" ADD COLUMN "tags" TEXT[];
ALTER TABLE "Task" ALTER COLUMN "tags" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Task" ADD COLUMN "isBlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Task" ADD COLUMN "referenceLinks" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Task" ADD COLUMN "activityLog" JSONB NOT NULL DEFAULT '[]';

-- Employee: new columns
ALTER TABLE "Employee" ADD COLUMN "email" TEXT;
ALTER TABLE "Employee" ADD COLUMN "phone" TEXT;
ALTER TABLE "Employee" ADD COLUMN "workLocation" TEXT NOT NULL DEFAULT 'Remote';
ALTER TABLE "Employee" ADD COLUMN "employmentType" TEXT NOT NULL DEFAULT 'full-time';
ALTER TABLE "Employee" ADD COLUMN "salary" DECIMAL(14,2);
ALTER TABLE "Employee" ADD COLUMN "payFrequency" TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE "Employee" ADD COLUMN "documents" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Employee" ADD COLUMN "careerHistory" JSONB NOT NULL DEFAULT '[]';

-- People: Okr, TrainingCourse, TrainingEnrollment, Candidate, Holiday
CREATE TABLE "Okr" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "keyResults" JSONB NOT NULL DEFAULT '[]',
    "overallProgress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'on-track',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Okr_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingCourse" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'optional',
    "category" TEXT NOT NULL DEFAULT 'technical',
    "duration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT 'online',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainingCourse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingEnrollment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'enrolled',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "TrainingEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TrainingEnrollment_courseId_employeeId_key" ON "TrainingEnrollment"("courseId", "employeeId");

CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "position" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT 'applied',
    "source" TEXT NOT NULL DEFAULT '',
    "appliedAt" TEXT NOT NULL,
    "notes" JSONB NOT NULL DEFAULT '[]',
    "interviews" JSONB NOT NULL DEFAULT '[]',
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedSalary" DECIMAL(14,2),
    "skills" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- Calendar: ContentPost, CalendarEvent, DailyTarget
CREATE TYPE "ContentPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'FAILED');

CREATE TABLE "ContentPost" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "platforms" JSONB NOT NULL DEFAULT '[]',
    "scheduledDate" TEXT NOT NULL,
    "scheduledTime" TEXT NOT NULL DEFAULT '10:00',
    "status" "ContentPostStatus" NOT NULL DEFAULT 'DRAFT',
    "projectId" TEXT,
    "hasImage" BOOLEAN NOT NULL DEFAULT false,
    "hasVideo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentPost_pkey" PRIMARY KEY ("id")
);

CREATE TYPE "CalendarEventType" AS ENUM ('CAMPAIGN', 'CONTENT', 'MEETING', 'DEADLINE', 'MILESTONE');

CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "CalendarEventType" NOT NULL DEFAULT 'MEETING',
    "date" TEXT NOT NULL,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyTarget" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "target" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "current" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'sales',
    "period" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyTarget_pkey" PRIMARY KEY ("id")
);

-- Tasks: Templates & Automation
CREATE TABLE "TaskTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultTasks" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Okr" ADD CONSTRAINT "Okr_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "TrainingCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;