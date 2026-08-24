import { IsHexColor, IsOptional, IsString, Matches, MaxLength } from "class-validator";

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
}
