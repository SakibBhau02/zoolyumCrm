import { Module } from "@nestjs/common";
import { DirectoryService } from "./directory.service";
import { AttendanceService } from "./attendance.service";
import { LeaveService } from "./leave.service";
import { PayrollService } from "./payroll.service";
import { PerformanceService } from "./performance.service";
import { TrainingService } from "./training.service";
import { RecruitmentService } from "./recruitment.service";
import { PeopleController } from "./people.controller";
import { IclockController } from "./iclock.controller";
import { CapitalModule } from "../capital/capital.module";

@Module({
  imports: [CapitalModule],
  controllers: [PeopleController, IclockController],
  providers: [DirectoryService, AttendanceService, LeaveService, PayrollService, PerformanceService, TrainingService, RecruitmentService],
})
export class PeopleModule {}
