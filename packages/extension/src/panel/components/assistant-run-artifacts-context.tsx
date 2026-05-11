import { createContext, useContext } from 'react'

/** 为「当前轮次」助手气泡或等待占位提供：是否在首段文本下展示任务/工具卡片 */
export const AssistantRunArtifactsContext = createContext(false)

export function useAssistantRunArtifacts(): boolean {
  return useContext(AssistantRunArtifactsContext)
}
