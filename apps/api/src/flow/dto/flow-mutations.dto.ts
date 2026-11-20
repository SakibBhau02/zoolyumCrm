import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { PartialType } from "@nestjs/mapped-types";
import {
  DeliverableKind,
  DeliverableStatus,
  FileApprovalStatus,
  MilestoneStatus,
  Priority,
  ReportGrouping,
  ReportStatus,
  ShootCrewRole,
  ShootCrewSource,
  ShootDuration,
  ShootStatus,
} from "@prisma/client";

const UPLOAD_PREFIX = "/api/flow/uploads/";

export class AddFileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(new RegExp(`^(${UPLOAD_PREFIX}|https?://)`, "i"), {
    message: "fileUrl must be an uploaded file or an http(s) link",
  })
  fileUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  fileName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  size?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;

  @IsOptional()
  @IsString()
  milestoneId?: string;
}

export class SetFileApprovalDto {
  /** `status` is canonical; `approvalStatus` is accepted for older clients. */
  @IsOptional()
  @IsEnum(FileApprovalStatus)
  status?: FileApprovalStatus;

  @IsOptional()
  @IsEnum(FileApprovalStatus)
  approvalStatus?: FileApprovalStatus;
}

export class AddMilestoneDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsEnum(MilestoneStatus)
  status?: MilestoneStatus;

  @IsOptional()
  @IsBoolean()
  clientVisible?: boolean;
}

export class UpdateMilestoneDto extends PartialType(AddMilestoneDto) {
  @IsOptional()
  @IsDateString()
  completedAt?: string;
}

export class AddDiscussionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;
}

export class BulkAssignTasksDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  taskIds!: string[];
}

export class AddDeliverableDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** What kind of asset this is — the split reports group by. */
  @IsOptional()
  @IsEnum(DeliverableKind)
  kind?: DeliverableKind;

  /** What the item actually is, e.g. "Eid greeting post — peacock motif". */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;

  /** Why it exists, e.g. Awareness / Launch / Conversion. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  objective?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsBoolean()
  clientVisible?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  taskIds?: string[];
}

export class UpdateDeliverableDto extends PartialType(AddDeliverableDto) {
  @IsOptional()
  @IsEnum(DeliverableStatus)
  status?: DeliverableStatus;
}

/** Paste mode: one row per item, created in a single request. */
export class BulkAddDeliverablesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AddDeliverableDto)
  items!: AddDeliverableDto[];
}

/**
 * One-click "turn these commitments into work". One task per deliverable is
 * created; deliverables that already own a task are skipped, never duplicated.
 */
export class AssignDeliverableTasksDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  deliverableIds!: string[];

  @IsString()
  @IsNotEmpty()
  assigneeId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  coAssigneeIds?: string[];

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsDateString()
  dueDateOverride?: string;

  @IsOptional()
  @IsBoolean()
  clientVisible?: boolean;

  /** Overrides the kind → taskType mapping when set. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  taskType?: string;

  /** Optional sub-category inside the chosen task category. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  taskSubType?: string;
}

export class GenerateReportDto {
  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  pmNotes?: string;

  /** Scope the report to a single campaign. */
  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsEnum(ReportGrouping)
  groupBy?: ReportGrouping;
}

export class UpdateReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  pmNotes?: string;

  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;
}

export class UpdateProjectReportSettingsDto {
  @IsOptional()
  @IsIn(["MANUAL", "AUTOMATIC"])
  reportMode?: string;

  @IsOptional()
  @IsIn(["15-days", "30-days"])
  reportFrequency?: string;

  @IsOptional()
  @IsDateString()
  nextReportDate?: string;
}

/**
 * The project's one final proposal. A save replaces the whole record, so the
 * client sends every field it wants to keep; a missing field is cleared.
 */
export class UpsertProjectProposalDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  /** Uploaded PDF path (`/api/flow/uploads/…`) or any http(s) file. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(new RegExp(`^(${UPLOAD_PREFIX}|https?://)`, "i"), {
    message: "fileUrl must be an uploaded file or an http(s) link",
  })
  fileUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  fileName?: string;

  /** Google Doc / Notion / any shared link. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^(https?:\/\/|www\.)/i, {
    message: "link must start with http(s):// or www.",
  })
  link?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsIn(["DRAFT", "SENT", "APPROVED"])
  status?: string;

  @IsOptional()
  @IsDateString()
  sentDate?: string;
}

// ── Shoots (production call-sheets) ────────────────────────────────────
const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateShootDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title!: string;

  /** The shoot day — required; a shoot without a date is not a shoot. */
  @IsDateString()
  shootDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(ShootDuration)
  durationType?: ShootDuration;

  @IsOptional()
  @IsString()
  @Matches(TIME_HHMM, { message: "callTime must be HH:MM (24h)" })
  callTime?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_HHMM, { message: "wrapTime must be HH:MM (24h)" })
  wrapTime?: string;

  @IsOptional()
  @IsBoolean()
  isDateLocked?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  locationUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  locationNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  equipment?: string[];

  @IsOptional()
  @IsEnum(ShootStatus)
  status?: ShootStatus;

  @IsOptional()
  @IsString()
  campaignId?: string;
}

export class UpdateShootDto extends PartialType(CreateShootDto) {}

export class AddShootCrewDto {
  @IsEnum(ShootCrewRole)
  role!: ShootCrewRole;

  @IsOptional()
  @IsEnum(ShootCrewSource)
  source?: ShootCrewSource;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  /** Required for EXTERNAL crew, optional override otherwise. */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_HHMM, { message: "callTime must be HH:MM (24h)" })
  callTime?: string;

  @IsOptional()
  @IsBoolean()
  isConfirmed?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fee?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateShootCrewDto extends PartialType(AddShootCrewDto) {}
