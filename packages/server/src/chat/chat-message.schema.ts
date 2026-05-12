import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import type { HydratedDocument } from 'mongoose'

export type ChatMessageDocument = HydratedDocument<ChatMessage>

@Schema({ collection: 'chat_messages', timestamps: true })
export class ChatMessage {
  @Prop({ required: true, index: true })
  sessionId!: string

  /** 单次 agent/run 对应 LangGraph thread */
  @Prop({ required: true, index: true })
  threadId!: string

  @Prop({ required: true, enum: ['user', 'assistant'] })
  role!: 'user' | 'assistant'

  @Prop({ required: true })
  content!: string

  @Prop()
  pageUrl?: string
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage)
ChatMessageSchema.index({ sessionId: 1, createdAt: 1 })
