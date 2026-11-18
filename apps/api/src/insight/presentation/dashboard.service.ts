import { Injectable } from "@nestjs/common";
import { ReportsService } from "../reports/reports.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";
import { getBrandingConfig } from "../../common/branding";

@Injectable()
export class DashboardService {
  constructor(private readonly reports: ReportsService, private readonly prisma: PrismaService, private readonly cache: CacheService) {}

  async executive(query:any){
    const exec=await this.reports.executive(query);
    // add branding & comparison
    const branding=await getBrandingConfig(this.prisma).catch(()=>null);
    const comparison = query.compare ? await this.reports.comparison({
      from: query.from, to: query.to,
      compareFrom: query.compareFrom ?? new Date(new Date(query.from).getTime() - 30*86400000).toISOString(),
      compareTo: query.compareTo ?? new Date(new Date(query.to).getTime() - 30*86400000).toISOString(),
      clientId: query.clientId, provider: query.provider,
    }).catch(()=>null) : null;
    return { ...exec, branding: branding ? { logoUrl: branding.logoUrl, appName: branding.appName, primaryColor: branding.primaryColor } : null, comparison };
  }

  async whiteLabel(){
    const branding=await getBrandingConfig(this.prisma);
    return branding ?? { appName:"Zoolyum OS", primaryColor:"#FF5001" };
  }
}
