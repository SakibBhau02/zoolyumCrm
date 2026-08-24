import { Module } from "@nestjs/common";
import { PulseService } from "./pulse.service";
import { PulseController } from "./pulse.controller";
import { TasksModule } from "../tasks/tasks.module";

@Module({
  imports: [TasksModule],
  controllers: [PulseController],
  providers: [PulseService],
})
export class PulseModule {}
