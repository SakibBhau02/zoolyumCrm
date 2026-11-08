import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { BillingCycle, HealthStatus, ProjectStatus, ProjectType } from "@prisma/client";

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  spentAmount?: number;

  @IsOptional()
  @IsIn(["BDT", "USD", "SAR", "AED"])
  currency?: string;

  @IsOptional()
  @IsEnum(BillingCycle)
  billingType?: BillingCycle;

  @IsOptional()
  @ValidateIf((o) => o.billingType === "RECURRING")
  @IsIn(["7-days", "15-days", "30-days", "monthly"])
  recurringInterval?: string;

  @ValidateIf((o) => o.billingType === "RECURRING")
  @IsNumber()
  @Min(1)
  monthlyRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsUrl({ require_protocol: false })
  projectLink?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsUrl({ require_protocol: false })
  websiteUrl?: string;

  @IsOptional()
  @IsObject()
  socialLinks?: any;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @IsEnum(HealthStatus)
  healthStatus?: HealthStatus;

  /** Free-text reason stored with a manual health override. */
  @IsOptional()
  @IsString()
  healthOverrideReason?: string;

  /** Set true to drop a manual override and go back to the computed level. */
  @IsOptional()
  @IsBoolean()
  clearHealthOverride?: boolean;

  /** PM's 1-5 confidence, the subjective input to the project score. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  confidenceScore?: number;

  @IsOptional()
  @IsEnum(ProjectType)
  type?: ProjectType;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  team?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  targetEndDate?: string;

  @IsOptional()
  @IsDateString()
  nextBillingDate?: string;

  @IsOptional()
  @IsString()
  assignedPmId?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  briefLink?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  driveLink?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  researchLink?: string;

  @IsOptional()
  @IsString()
  paymentStatus?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalBilled?: number;

  /** AUTOMATIC makes the nightly cron generate a report every `reportFrequency`. */
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
