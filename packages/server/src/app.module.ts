import { Module } from '@nestjs/common'
import { AgentController } from './gateway/agent.controller'

@Module({
  controllers: [AgentController],
})
export class AppModule {}
