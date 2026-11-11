import { Type } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/** Kept in sync with PortalAccessService.PORTAL_MODULES. */
export const PORTAL_MODULES = ["WORK", "PERFORMANCE", "MESSAGES", "FILES", "BILLING"] as const;
export type PortalModuleName = (typeof PORTAL_MODULES)[number];

const TASK_STATUSES = ["TODO", "IN_PROGRESS", "REVIEW", "DONE", "BLOCKED"] as const;

// ── Session ─────────────────────────────────────────────────────────────
export class PortalLoginDto {
  @IsString()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class PortalChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

// ── Staff → portal administration ───────────────────────────────────────
export class CreatePortalUserDto {
  @IsString()
  @MaxLength(64)
  clientContactId!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class ResetPortalPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class SetPortalAccessDto {
  @IsBoolean()
  isActive!: boolean;
}

export class StaffReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  threadKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientId?: string;
}

export class ContactAccessDto {
  @IsOptional()
  @IsIn(["ALL", "CUSTOM"])
  scope?: "ALL" | "CUSTOM";

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  projectIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PORTAL_MODULES, { each: true })
  modules?: PortalModuleName[];

  @IsOptional()
  @IsBoolean()
  canSeeAdSpend?: boolean;
}

export class SetTaskVisibilityDto {
  @IsBoolean()
  isClientVisible!: boolean;
}

export class BulkTaskVisibilityDto {
  @IsBoolean()
  isClientVisible!: boolean;
}

// ── Client portal ───────────────────────────────────────────────────────
export class PortalTaskQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: (typeof TASK_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(["week", "overdue", "all"])
  due?: "week" | "overdue" | "all";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class PortalMessageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PortalPostMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentId?: string;
}

export class PortalApprovalDto {
  @IsIn(["APPROVED", "REVISION_REQUESTED"])
  decision!: "APPROVED" | "REVISION_REQUESTED";

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  revisionNotes?: string;
}

export class PortalNotificationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PortalAdsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  to?: string;

  @IsOptional()
  @IsIn(["day", "week"])
  granularity?: "day" | "week";
}
