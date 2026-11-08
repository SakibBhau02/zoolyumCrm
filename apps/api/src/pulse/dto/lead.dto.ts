import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from "class-validator";
import {
  FollowUpStatus,
  LeadPriority,
  LeadSource,
  LeadStage,
  LeadTemperature,
  LostReasonCategory,
  MeetingStatus,
  MeetingType,
  Vertical,
} from "@prisma/client";

const ACTIVITY_TYPES = ["CALL", "EMAIL", "MEETING", "NOTE", "WHATSAPP", "LINKEDIN"] as const;
const PROPOSAL_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED"] as const;
/**
 * What came out of a touch, not just that a touch happened. Drives the
 * follow-up cockpit: `NO_ANSWER` means try again, `INTERESTED` means push the
 * stage, `NOT_INTERESTED` is the honest exit.
 */
const OUTCOMES = [
  "CONNECTED",
  "NO_ANSWER",
  "LEFT_MESSAGE",
  "INTERESTED",
  "NEEDS_INFO",
  "CALLBACK_REQUESTED",
  "MEETING_BOOKED",
  "NOT_INTERESTED",
] as const;

export class CreateLeadDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional()
  @IsEnum(Vertical)
  vertical?: Vertical;

  @IsOptional()
  @IsEnum(LeadTemperature)
  temperature?: LeadTemperature;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @IsOptional()
  @IsBoolean()
  starred?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  pageLink?: string;

  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedDealSize?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsISO8601()
  nextFollowUpAt?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional()
  @IsEnum(Vertical)
  vertical?: Vertical;

  @IsOptional()
  @IsEnum(LeadTemperature)
  temperature?: LeadTemperature;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @IsOptional()
  @IsBoolean()
  starred?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  pageLink?: string;

  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @IsOptional()
  @IsEnum(LeadStage)
  stage?: LeadStage;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedDealSize?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsISO8601()
  nextFollowUpAt?: string | null;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AddActivityDto {
  @IsEnum(ACTIVITY_TYPES)
  type!: (typeof ACTIVITY_TYPES)[number];

  @IsString()
  content!: string;
}

export class CreateFollowUpDto {
  @IsISO8601()
  date!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  assignToId?: string;

  @IsOptional()
  @IsString()
  taskTitle?: string;
}

export class UpdateFollowUpDto {
  @IsOptional()
  @IsISO8601()
  date?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(FollowUpStatus)
  status?: FollowUpStatus;
}

export class CreateProposalDto {
  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsUrl({ require_protocol: false }, { message: "Proposal link must be a valid URL" })
  portalLink?: string;

  @IsOptional()
  @IsEnum(PROPOSAL_STATUSES)
  status?: (typeof PROPOSAL_STATUSES)[number];
}

export class UpdateProposalDto {
  @IsOptional()
  @IsEnum(PROPOSAL_STATUSES)
  status?: (typeof PROPOSAL_STATUSES)[number];

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsUrl({ require_protocol: false }, { message: "Proposal link must be a valid URL" })
  portalLink?: string;
}

export class CreateMeetingDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsEnum(MeetingType)
  type?: MeetingType;

  @IsISO8601()
  scheduledAt!: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  durationMins?: number;

  @IsOptional()
  @IsString()
  meetingLink?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsArray()
  attendees?: { id: string; name: string }[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  assignToId?: string;

  @IsOptional()
  @IsString()
  taskTitle?: string;
}

export class UpdateMeetingDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsEnum(MeetingType)
  type?: MeetingType;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  durationMins?: number;

  @IsOptional()
  @IsString()
  meetingLink?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsArray()
  attendees?: { id: string; name: string }[];

  @IsOptional()
  @IsEnum(MeetingStatus)
  status?: MeetingStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class MarkLostDto {
  @IsEnum(LostReasonCategory)
  reasonCategory!: LostReasonCategory;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateCategoryDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  color?: string;
}

export class ConvertLeadDto {
  @IsString()
  companyName!: string;

  @IsOptional()
  @IsEnum(Vertical)
  vertical?: Vertical;

  @IsOptional()
  @IsString()
  accountOwnerId?: string;

  @IsOptional()
  @IsString()
  projectName?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  healthScore?: number;
}

/* ── Follow-up workflow ──────────────────────────────────────────────────── */

/**
 * One call, WhatsApp, email or meeting — logged with its outcome and the next
 * step in a single request. This is the primary write path from the Today
 * cockpit; it keeps the lead's agenda, activity history and stage in sync.
 */
export class QuickLogDto {
  @IsEnum(ACTIVITY_TYPES)
  type!: (typeof ACTIVITY_TYPES)[number];

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsEnum(OUTCOMES)
  outcome?: (typeof OUTCOMES)[number];

  /** When the next touch should happen. Omit to keep the current plan. */
  @IsOptional()
  @IsISO8601()
  nextFollowUpAt?: string;

  /**
   * Explicitly drop the open plan ("No next step"). Omit the date AND set this
   * to true to clear every scheduled follow-up, instead of silently keeping it.
   */
  @IsOptional()
  @IsBoolean()
  clearNextStep?: boolean;

  /** Forward stage moves only — the service refuses to walk a lead backwards. */
  @IsOptional()
  @IsEnum(LeadStage)
  stage?: LeadStage;

  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @IsOptional()
  @IsEnum(LeadTemperature)
  temperature?: LeadTemperature;

  /** Optionally mirror the next step into Tasks for someone on the team. */
  @IsOptional()
  @IsString()
  assignToId?: string;

  @IsOptional()
  @IsString()
  taskTitle?: string;
}

export class SnoozeLeadDto {
  /** Push the open follow-up this many days from now (1–90). */
  @IsInt()
  @Min(1)
  @Max(90)
  days!: number;
}

export class UpdateFollowUpStatusDto {
  @IsEnum(FollowUpStatus)
  status!: FollowUpStatus;
}

export class BulkUpdateLeadsDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];

  @IsOptional()
  @IsEnum(LeadStage)
  stage?: LeadStage;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @IsOptional()
  @IsEnum(LeadTemperature)
  temperature?: LeadTemperature;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  addTags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  removeTags?: string[];
}

