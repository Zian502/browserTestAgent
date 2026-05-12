import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ChatMessage, ChatMessageSchema } from './chat-message.schema'
import { ChatSseEvent, ChatSseEventSchema } from './chat-sse-event.schema'
import { ChatSession, ChatSessionSchema } from './chat-session.schema'
import { ChatPersistenceService } from './chat-persistence.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatSession.name, schema: ChatSessionSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: ChatSseEvent.name, schema: ChatSseEventSchema },
    ]),
  ],
  providers: [ChatPersistenceService],
  exports: [ChatPersistenceService],
})
export class ChatModule {}
