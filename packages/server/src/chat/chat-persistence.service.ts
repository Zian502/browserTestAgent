import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import type { Model } from 'mongoose'
import { ChatMessage } from './chat-message.schema'
import { ChatSession } from './chat-session.schema'

function clipTitle(s: string, max = 120): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

@Injectable()
export class ChatPersistenceService {
  private readonly log = new Logger(ChatPersistenceService.name)

  constructor(
    @InjectModel(ChatSession.name) private readonly sessions: Model<ChatSession>,
    @InjectModel(ChatMessage.name) private readonly messages: Model<ChatMessage>,
  ) {}

  async recordUserTurn(params: {
    sessionId: string
    threadId: string
    userInput: string
    pageUrl: string
  }): Promise<void> {
    try {
      const title = clipTitle(params.userInput)
      await this.sessions.findOneAndUpdate(
        { sessionId: params.sessionId },
        {
          $set: {
            title,
            lastPageUrl: params.pageUrl,
            lastThreadId: params.threadId,
          },
        },
        { upsert: true, new: true },
      )
      await this.messages.create({
        sessionId: params.sessionId,
        threadId: params.threadId,
        role: 'user',
        content: params.userInput,
        pageUrl: params.pageUrl,
      })
    } catch (e) {
      this.log.warn(`recordUserTurn failed: ${String(e)}`)
    }
  }

  async recordAssistantTurn(params: {
    sessionId: string
    threadId: string
    content: string
  }): Promise<void> {
    const body = params.content.trim()
    if (!body) return
    try {
      await this.messages.create({
        sessionId: params.sessionId,
        threadId: params.threadId,
        role: 'assistant',
        content: body,
      })
      await this.sessions.updateOne(
        { sessionId: params.sessionId },
        { $set: { lastThreadId: params.threadId } },
      )
    } catch (e) {
      this.log.warn(`recordAssistantTurn failed: ${String(e)}`)
    }
  }

  async listSessions(limit = 50): Promise<
    Array<{
      sessionId: string
      title?: string
      lastPageUrl?: string
      lastThreadId?: string
      createdAt?: Date
      updatedAt?: Date
    }>
  > {
    const rows = await this.sessions
      .find()
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean()
      .exec()
    return rows.map((r) => {
      const x = r as typeof r & { createdAt?: Date; updatedAt?: Date }
      return {
        sessionId: r.sessionId,
        title: r.title,
        lastPageUrl: r.lastPageUrl,
        lastThreadId: r.lastThreadId,
        createdAt: x.createdAt,
        updatedAt: x.updatedAt,
      }
    })
  }

  async listMessages(sessionId: string, limit = 300): Promise<
    Array<{
      threadId: string
      role: 'user' | 'assistant'
      content: string
      pageUrl?: string
      createdAt?: Date
    }>
  > {
    const rows = await this.messages
      .find({ sessionId })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean()
      .exec()
    return rows.map((r) => {
      const x = r as typeof r & { createdAt?: Date }
      return {
        threadId: r.threadId,
        role: r.role,
        content: r.content,
        pageUrl: r.pageUrl,
        createdAt: x.createdAt,
      }
    })
  }
}
