import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import type { HydratedDocument } from 'mongoose'

export type ChatSessionDocument = HydratedDocument<ChatSession>

@Schema({ collection: 'chat_sessions', timestamps: true })
export class ChatSession {
  @Prop({ required: true, unique: true })
  sessionId!: string

  /** 摘要标题，通常取最近一次用户输入前若干字 */
  @Prop()
  title?: string

  @Prop()
  lastPageUrl?: string

  @Prop()
  lastThreadId?: string
}

export const ChatSessionSchema = SchemaFactory.createForClass(ChatSession)
ChatSessionSchema.index({ updatedAt: -1 })
