import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import type { HydratedDocument } from 'mongoose'

export type ChatSseEventDocument = HydratedDocument<ChatSseEvent>

/** 与扩展 SSE `data: {...}` 一一对应，便于回放与审计。 */
@Schema({ collection: 'chat_sse_events', timestamps: true })
export class ChatSseEvent {
  @Prop({ required: true, index: true })
  sessionId!: string

  /** GitHub 用户 id；未登录时为 undefined */
  @Prop({ index: true })
  userId?: string

  @Prop({ required: true, index: true })
  threadId!: string

  /** 与客户端收到的 JSON 中 `event` 字段一致（如 `text`、`plan_created`）；无则空串 */
  @Prop({ default: '' })
  eventType!: string

  @Prop({ type: Object, required: true })
  payload!: Record<string, unknown>
}

export const ChatSseEventSchema = SchemaFactory.createForClass(ChatSseEvent)
ChatSseEventSchema.index({ sessionId: 1, threadId: 1, createdAt: 1 })
