import { IsOptional, IsObject, IsString, IsBoolean, IsArray, IsInt, Min, Max } from "class-validator";

export class UpdateInsightSettingsDto {
  @IsOptional() @IsObject()
  reportDefaults?: {
    datePreset?: string;
    metrics?: string[];
    dimensions?: string[];
    timezone?: string;
    currency?: string;
    comparePreset?: string;
  };

  @IsOptional() @IsObject()
  syncConfig?: {
    interval?: string;
    backfillDays?: number;
    retentionDays?: number;
  };

  @IsOptional() @IsObject()
  alertDefaults?: {
    windowDays?: number;
    ctrDropPct?: number;
    spendSpikeX?: number;
    cplLimit?: number;
    dedupMinutes?: number;
  };

  @IsOptional() @IsObject()
  branding?: {
    template?: string;
    includeCharts?: boolean;
  };

  @IsOptional() @IsObject()
  automation?: {
    defaultCron?: string;
    defaultRecipients?: string[];
    format?: string;
  };

  @IsOptional() @IsObject()
  exportConfig?: {
    defaultFormat?: string;
    includeCharts?: boolean;
    locale?: string;
  };
}
