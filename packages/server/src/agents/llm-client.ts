import { ChatOpenAI } from '@langchain/openai'

/**
 * 所有 Agent LLM 走 OpenAI 兼容协议，默认接入 **DeepSeek**（api.deepseek.com）。
 * 密钥优先级：LLM_API_KEY（总覆盖）> DEEPSEEK_API_KEY > CODEANY_API_KEY > OPENAI_API_KEY
 */
export function llmApiKey(): string {
  return (
    process.env.LLM_API_KEY?.trim() ||
    process.env.DEEPSEEK_API_KEY?.trim() ||
    process.env.CODEANY_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    ''
  )
}

/** Base URL：LLM_BASE_URL > DEEPSEEK_BASE_URL > CODEANY_BASE_URL，默认 DeepSeek 官方 */
export function llmBaseUrl(): string {
  const raw =
    process.env.LLM_BASE_URL?.trim() ||
    process.env.DEEPSEEK_BASE_URL?.trim() ||
    process.env.CODEANY_BASE_URL?.trim() ||
    'https://api.deepseek.com/v1'
  return raw.replace(/\/$/, '')
}

/** 模型名：LLM_MODEL > DEEPSEEK_MODEL > CODEANY_MODEL，默认 deepseek-chat */
export function llmModel(): string {
  return (
    process.env.LLM_MODEL?.trim() ||
    process.env.DEEPSEEK_MODEL?.trim() ||
    process.env.CODEANY_MODEL?.trim() ||
    'deepseek-chat'
  )
}

export function hasChatLlm(): boolean {
  return llmApiKey().length > 0
}

export function createChatLlm(options: { temperature: number; model?: string }) {
  return new ChatOpenAI({
    model: options.model ?? llmModel(),
    temperature: options.temperature,
    apiKey: llmApiKey(),
    configuration: { baseURL: llmBaseUrl() },
  })
}
