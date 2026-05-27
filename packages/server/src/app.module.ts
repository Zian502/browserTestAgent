import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AuthModule } from './auth/auth.module'
import { ChatModule } from './chat/chat.module'
import { GithubModule } from './github/github.module'
import { AgentController } from './gateway/agent.controller'

const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/browser-test-agent'

@Module({
  imports: [MongooseModule.forRoot(mongoUri), ChatModule, AuthModule, GithubModule],
  controllers: [AgentController],
})
export class AppModule {}
