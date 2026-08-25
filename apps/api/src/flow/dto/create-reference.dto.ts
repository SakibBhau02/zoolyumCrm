import { IsEnum, IsOptional, IsString, IsUrl, MaxLength } from "class-validator";
import { ReferenceType } from "@prisma/client";

export class CreateReferenceDto {
  @IsString()
  @MaxLength(80)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsUrl({ require_protocol: false })
  url?: string;

  @IsOptional()
  @IsEnum(ReferenceType)
  type?: ReferenceType;

  @IsOptional()
  @IsString()
  fileUrl?: string;
}
