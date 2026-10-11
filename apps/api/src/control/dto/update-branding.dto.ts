import { IsHexColor, IsObject, IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  appName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(https?:\/\/|\/)[^\s]+$/, { message: "logoDarkUrl must be a valid URL or relative path" })
  logoDarkUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(https?:\/\/|\/)[^\s]+$/, { message: "logoLightUrl must be a valid URL or relative path" })
  logoLightUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(https?:\/\/|\/)[^\s]+$/, { message: "logoUrl must be a valid URL or relative path" })
  logoUrl?: string;

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  invoiceNumberingFormat?: string;

  // ── Company profile for invoices ──
  @IsOptional()
  @IsString()
  tagline?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  authorizedSignerName?: string;

  @IsOptional()
  @IsString()
  authorizedSignerTitle?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(https?:\/\/|\/)[^\s]+$/, { message: "signatureImageUrl must be a valid URL or relative path" })
  signatureImageUrl?: string;

  @IsOptional()
  defaultPaymentDetails?: Record<string, any>;

  @IsOptional()
  @IsString()
  defaultCurrency?: string;

  @IsOptional()
  @IsString()
  defaultNotes?: string;

  @IsOptional()
  @IsString()
  defaultTerms?: string;
}
