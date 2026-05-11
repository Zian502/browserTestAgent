import { type ReactNode, useMemo } from 'react'
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type ChatModelRunResult,
  type ThreadMessage,
} from '@assistant-ui/react'
import { useTaskStore } from './stores/task-store'
import { getPageContextForAgent, isAcceptablePageUrl, isExtensionRuntime } from '../lib/page-context'
import { resolveLatestUserInput } from '../lib/user-intent-url'
import { AGENT_API_BASE } from './agent-api-base'

function agentLabel(name?: string) {
  const map: Record<string, string> = {
    mainAgent: '入口与工具',
    planAgent: '规划',
    parseHtmlAgent: 'HTML 解析',
    testCodeAgent: 'Playwright 测试',
    seoAgent: 'SEO',
    pagespeedAgent: 'PageSpeed',
    reportAgent: '报告',
  }
  return name ? (map[name] ?? name) : 'Agent'
}

function createAdapter(): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const { reset, setTasksFromPlan, updateByAgent, addReport, pushAgentObservation } = useTaskStore.getState()
      reset()

      const userInput = resolveLatestUserInput(messages)
      if (!userInput.trim()) {
        yield { content: [{ type: 'text' as const, text: '请输入任务描述。' }] }
        return
      }

      let text = ''

      function* bump(chunk: string): Generator<ChatModelRunResult, void, void> {
        text += chunk
        yield { content: [{ type: 'text' as const, text }] }
      }

      try {
        let pageUrl: string
        try {
          ;({ pageUrl } = await getPageContextForAgent({ webComposerText: userInput }))
        } catch (err) {
          yield* bump(`❌ ${String(err)}\n`)
          return
        }

        if (!isAcceptablePageUrl(pageUrl)) {
          if (isExtensionRuntime()) {
            yield* bump(
              '当前**无法从标签页得到有效的 http(s) 地址**（例如：空白页、内置页）。\n\n' +
                '请先**在要分析的标签页打开目标网站**，再发送任务。\n',
            )
          } else {
            yield* bump(
              '当前**无法得到有效的 pageUrl**。\n\n' +
                '请在**输入框**里写上完整 `http(s)://…` 链接（可与说明写在同一条消息里），服务端会从文案中提取 URL；' +
                '也可通过 `saveWebPageContext` / sessionStorage 写入固定页面地址。\n',
            )
          }
          return
        }

        const response = await fetch(`${AGENT_API_BASE}/api/agent/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userInput,
            pageUrl,
            /** 扩展侧默认用 Playwright+CDP 打开真实浏览器，与 parse / 测试共用页签 */
            usePlaywright: import.meta.env.VITE_USE_PLAYWRIGHT !== '0',
            headless: import.meta.env.VITE_PLAYWRIGHT_HEADLESS === '1',
          }),
          signal: abortSignal,
        })

        if (!response.ok || !response.body) {
          yield* bump(`❌ 请求失败：${response.status}\n`)
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6).trim()
            if (raw === '[DONE]') continue

            let data: Record<string, unknown>
            try {
              data = JSON.parse(raw) as Record<string, unknown>
            } catch {
              continue
            }

            const event = String(data.event ?? '')

            if (event === 'plan_created') {
              setTasksFromPlan(data.payload)
              yield* bump(`📋 已生成任务计划\n\n`)
            } else if (event === 'agent_start') {
              const name = data.agentName as string | undefined
              if (name) updateByAgent(name, { status: 'running' })
              yield* bump(`\n⚙️ **${agentLabel(name)}** 开始…\n\n`)
            } else if (event === 'agent_done') {
              const name = data.agentName as string | undefined
              if (name) updateByAgent(name, { status: 'done', result: data.payload })
              yield* bump(`✅ **${agentLabel(name)}** 完成\n\n`)
            } else if (event === 'agent_failed') {
              const name = data.agentName as string | undefined
              if (name) updateByAgent(name, { status: 'failed' })
              yield* bump(`❌ **${agentLabel(name)}** 失败\n\n`)
            } else if (event === 'report_ready') {
              const payload = data.payload as
                | { reportType?: string; reportPath?: string; ok?: boolean; error?: string }
                | undefined
              if (payload?.reportType && payload.ok === false) {
                yield* bump(
                  `❌ 报告生成失败（**${payload.reportType}**）：${String(payload.error ?? 'unknown').slice(0, 400)}\n\n`,
                )
              } else if (payload?.reportType && payload.reportPath) {
                addReport(payload.reportType, payload.reportPath)
                yield* bump(`📄 报告：**${payload.reportType}** → \`${payload.reportPath}\`\n\n`)
              }
            } else if (event === 'tool_start') {
              const payload = (data.payload ?? {}) as Record<string, unknown>
              const tool = String(payload.tool ?? 'tool')
              const page = payload.pageUrl != null ? String(payload.pageUrl) : ''
              const startedAt = payload.startedAt != null ? Number(payload.startedAt) : undefined
              pushAgentObservation({
                agentName: String(data.agentName ?? 'mainAgent'),
                label: tool,
                phase: 'start',
                summary: page ? `目标 ${page}` : undefined,
                data: { ...payload, kind: 'tool_start' },
              })
              yield* bump(
                `\n🔧 **工具开始** \`${tool}\`${page ? ` · ${page}` : ''}${startedAt != null && !Number.isNaN(startedAt) ? ` · startedAt=${startedAt}` : ''}\n\n`,
              )
            } else if (event === 'tool_success') {
              const payload = (data.payload ?? {}) as Record<string, unknown>
              const tool = String(payload.tool ?? 'tool')
              const ms = payload.durationMs != null ? Number(payload.durationMs) : undefined
              const len = payload.pageHtmlLength != null ? Number(payload.pageHtmlLength) : undefined
              const parts: string[] = []
              if (ms != null && !Number.isNaN(ms)) parts.push(`耗时 ${ms}ms`)
              if (len != null && !Number.isNaN(len)) parts.push(`HTML 长度 ${len}`)
              const toolSummary = parts.length > 0 ? parts.join(' · ') : undefined
              pushAgentObservation({
                agentName: String(data.agentName ?? 'mainAgent'),
                label: `工具成功：${tool}`,
                phase: 'done',
                summary: toolSummary,
                data: { ...payload, kind: 'tool_success' },
              })
              yield* bump(
                `\n✅ **工具成功** \`${tool}\`${ms != null && !Number.isNaN(ms) ? ` · ${ms}ms` : ''}${len != null && !Number.isNaN(len) ? ` · HTML ${len} 字符` : ''}\n\n`,
              )
            } else if (event === 'tool_failure') {
              const payload = (data.payload ?? {}) as Record<string, unknown>
              const tool = String(payload.tool ?? 'tool')
              const ms = payload.durationMs != null ? Number(payload.durationMs) : undefined
              const err = payload.error != null ? String(payload.error) : ''
              const toolSummary = err ? err.slice(0, 200) : undefined
              pushAgentObservation({
                agentName: String(data.agentName ?? 'mainAgent'),
                label: `工具失败：${tool}`,
                phase: 'failed',
                summary: toolSummary,
                data: { ...payload, kind: 'tool_failure' },
              })
              yield* bump(
                `\n❌ **工具失败** \`${tool}\`${ms != null && !Number.isNaN(ms) ? ` · ${ms}ms` : ''}${err ? `\n${err}` : ''}\n\n`,
              )
            } else if (event === 'skill_start') {
              const payload = (data.payload ?? {}) as Record<string, unknown>
              const skill = String(payload.skill ?? 'skill')
              const name = payload.name != null ? String(payload.name).trim() : ''
              pushAgentObservation({
                agentName: String(data.agentName ?? 'mainAgent'),
                label: name ? name : skill,
                phase: 'start',
                summary: skill,
                data: { ...payload, kind: 'skill_start' },
              })
              yield* bump(`\n🧩 **Skill 开始** \`${skill}\`${name ? `（${name}）` : ''}\n\n`)
            } else if (event === 'skill_success') {
              const payload = (data.payload ?? {}) as Record<string, unknown>
              const skill = String(payload.skill ?? 'skill')
              const ms = payload.durationMs != null ? Number(payload.durationMs) : undefined
              pushAgentObservation({
                agentName: String(data.agentName ?? 'mainAgent'),
                label: `Skill 成功：${skill}`,
                phase: 'done',
                summary: ms != null && !Number.isNaN(ms) ? `耗时 ${ms}ms` : undefined,
                data: { ...payload, kind: 'skill_success' },
              })
              yield* bump(
                `\n✅ **Skill 成功** \`${skill}\`${ms != null && !Number.isNaN(ms) ? ` · ${ms}ms` : ''}\n\n`,
              )
            } else if (event === 'skill_failure') {
              const payload = (data.payload ?? {}) as Record<string, unknown>
              const skill = String(payload.skill ?? 'skill')
              const ms = payload.durationMs != null ? Number(payload.durationMs) : undefined
              const err = payload.error != null ? String(payload.error) : ''
              pushAgentObservation({
                agentName: String(data.agentName ?? 'mainAgent'),
                label: `Skill 失败：${skill}`,
                phase: 'failed',
                summary: err ? err.slice(0, 200) : undefined,
                data: { ...payload, kind: 'skill_failure' },
              })
              yield* bump(
                `\n❌ **Skill 失败** \`${skill}\`${ms != null && !Number.isNaN(ms) ? ` · ${ms}ms` : ''}${err ? `\n${err}` : ''}\n\n`,
              )
            } else if (event === 'mcp_call') {
              const payload = (data.payload ?? {}) as Record<string, unknown>
              const mcp = String(payload.mcp ?? 'mcp')
              pushAgentObservation({
                agentName: String(data.agentName ?? 'pagespeedAgent'),
                label: `MCP：${mcp}`,
                phase: 'start',
                data: { ...payload, kind: 'mcp_call' },
              })
              yield* bump(`\n🔗 **MCP** \`${mcp}\`\n\n`)
            } else if (event === 'mcp_result') {
              const payload = (data.payload ?? {}) as Record<string, unknown>
              const mcp = String(payload.mcp ?? 'mcp')
              const ok = payload.ok === true
              const ms = payload.durationMs != null ? Number(payload.durationMs) : undefined
              const err = payload.error != null ? String(payload.error) : ''
              pushAgentObservation({
                agentName: String(data.agentName ?? 'pagespeedAgent'),
                label: `MCP：${mcp}`,
                phase: ok ? 'done' : 'failed',
                summary: ok && ms != null && !Number.isNaN(ms) ? `耗时 ${ms}ms` : err ? err.slice(0, 200) : undefined,
                data: { ...payload, kind: 'mcp_result' },
              })
              yield* bump(
                `\n${ok ? '✅' : '❌'} **MCP 结果** \`${mcp}\`${ms != null && !Number.isNaN(ms) ? ` · ${ms}ms` : ''}${!ok && err ? `\n${err}` : ''}\n\n`,
              )
            } else if (event === 'agent_observation') {
              const agentName = String(data.agentName ?? '')
              const payload = (data.payload ?? {}) as Record<string, unknown>
              const phase = String(payload.phase ?? '')
              const label = String(payload.label ?? agentLabel(agentName))
              const summary = payload.summary != null ? String(payload.summary) : undefined
              const taskId = data.taskId != null ? String(data.taskId) : undefined
              const obsData = payload.data
              pushAgentObservation({
                agentName,
                label,
                phase,
                taskId: taskId || undefined,
                summary,
                data: obsData,
              })
              let dataSnippet = ''
              if (obsData !== undefined && obsData !== null) {
                try {
                  const raw = JSON.stringify(obsData, null, 2)
                  dataSnippet = raw.length > 900 ? `${raw.slice(0, 900)}\n…` : raw
                } catch {
                  dataSnippet = String(obsData)
                }
              }
              yield* bump(
                `\n📡 **${label}**（\`${agentName}\`）· **${phase}**` +
                  (summary ? `\n${summary}` : '') +
                  (dataSnippet ? `\n\`\`\`json\n${dataSnippet}\n\`\`\`\n` : '\n'),
              )
            } else if (event === 'text') {
              const payload = data.payload as { content?: string } | undefined
              const body = typeof payload?.content === 'string' ? payload.content : ''
              if (body) yield* bump(`${body}\n\n`)
            } else if (event === 'complete') {
              yield* bump(`\n---\n✨ **全部完成**\n`)
            } else if (event === 'error') {
              yield* bump(`\n❌ ${String(data.message ?? data)}\n`)
            }
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        yield* bump(`\n❌ ${String(e)}\n`)
      }
    },
  }
}

export function AgentRuntimeProvider({ children }: { children: ReactNode }) {
  const adapter = useMemo(() => createAdapter(), [])
  const runtime = useLocalRuntime(adapter)

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  )
}
