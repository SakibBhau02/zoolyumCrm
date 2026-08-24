import { IsHexColor, IsOptional, IsString, IsUrl } from "class-validator";

export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  appName?: string;

  @IsOptional()
  @IsUrl()
  logoDarkUrl?: string;

  @IsOptional()
  @IsUrl()
  logoLightUrl?: string;

  @IsOptional()
  @IsUrl()
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
