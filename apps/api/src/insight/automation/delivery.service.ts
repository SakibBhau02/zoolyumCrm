import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../../notifications/notifications.service";

@Injectable()
export class DeliveryService {
  private readonly logger=new Logger(DeliveryService.name);
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  async test(body:{ email?:string; whatsapp?:string; message?:string }){
    const msg=body.message ?? "Test report delivery from Zoolyum OS Insight";
    if(body.email){
      this.logger.log(`[Email stub] to ${body.email}: ${msg}`);
      await this.notifications.broadcast("report_delivered", "Report Delivery Test", msg, "/insight").catch(()=>{});
    }
    if(body.whatsapp){
      this.logger.log(`[WhatsApp stub] to ${body.whatsapp}: ${msg}`);
    }
    return { sent:true, channels: [body.email?"email":null, body.whatsapp?"whatsapp":null].filter(Boolean), message: msg };
  }

  async deliveries(){ 
    const runs=await this.prisma.reportRun.findMany({ orderBy:{ranAt:"desc"}, take:20, include:{ reportDef:{ select:{ name:true } } }});
    return runs;
  }
}
