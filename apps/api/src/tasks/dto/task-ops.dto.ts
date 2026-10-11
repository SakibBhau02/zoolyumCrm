import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

const BULK_OPS = ["status", "assign", "priority", "dueDate", "archive", "unarchive", "delete"] as const;

export class BulkTaskDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];

  @IsIn(BULK_OPS as unknown as string[])
  op!: (typeof BULK_OPS)[number];

  @IsOptional()
  value?: any;
}

export class ChecklistItemDto {
  @IsString()
  @MaxLength(500)
  content!: string;

  @IsOptional()
  @IsString()
  taskId?: string;
}

export class UpdateChecklistItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  content?: string;

  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

export class SprintDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  goal?: string;

  @IsOptional()
  @IsString()
  projectId?: string | null;

  @IsString()
  startDate!: string;

  @IsString()
  endDate!: string;

  @IsOptional()
  @IsIn(["PLANNED", "ACTIVE", "COMPLETED"])
  status?: "PLANNED" | "ACTIVE" | "COMPLETED";

  @IsOptional()
  capacityHours?: number;
}

export class SavedViewDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  filters?: Record<string, any>;

  @IsOptional()
  @IsIn(["board", "list", "calendar", "gantt"])
  viewMode?: string;

  @IsOptional()
  @IsIn(["project", "assignee", "priority", "status", "tag", "none"])
  groupBy?: string;

  @IsOptional()
  @IsBoolean()
  isShared?: boolean;
}
