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
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from "class-validator";
import { PartialType } from "@nestjs/mapped-types";
import {
  DeliverableStatus,
  FileApprovalStatus,
  MilestoneStatus,
  ReportStatus,
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
