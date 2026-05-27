/** 与扩展 `agent-runtime.tsx` 中 SSE 渲染逻辑对齐，用于持久化 assistant 完整回复文本。 */

const AGENT_LABELS: Record<string, string> = {
  mainAgent: '入口与工具',
  planAgent: '规划',
  parseHtmlAgent: 'HTML 解析',
  testCodeAgent: 'Playwright 测试',
  seoAgent: 'SEO',
  pagespeedAgent: 'PageSpeed',
  reportAgent: '报告',
}

function agentLabel(name?: string): string {
  if (!name) return 'Agent'
  return AGENT_LABELS[name] ?? name
}

function payloadRecord(data: Record<string, unknown>): Record<string, unknown> {
  const p = data.payload
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : {}
}

/** 将单条 SSE JSON（`data: {...}` 内容）格式化为 assistant 可见文本片段。 */
export function formatSseDataForAssistantContent(data: Record<string, unknown>): string {
  const event = String(data.event ?? data.type ?? '')

  if (event === 'plan_created') {
    return '📋 已生成任务计划\n\n'
  }

  if (event === 'agent_start') {
    const name = data.agentName != null ? String(data.agentName) : undefined
    return `\n⚙️ **${agentLabel(name)}** 开始…\n\n`
  }

  if (event === 'agent_done') {
    const name = data.agentName != null ? String(data.agentName) : undefined
    return `✅ **${agentLabel(name)}** 完成\n\n`
  }

  if (event === 'agent_failed') {
    const name = data.agentName != null ? String(data.agentName) : undefined
    return `❌ **${agentLabel(name)}** 失败\n\n`
  }

  if (event === 'report_ready') {
    const payload = payloadRecord(data)
    const reportType = payload.reportType != null ? String(payload.reportType) : ''
    if (payload.ok === false) {
      return `❌ 报告生成失败（**${reportType}**）：${String(payload.error ?? 'unknown').slice(0, 400)}\n\n`
    }
    if (reportType && payload.reportPath != null) {
      return `📄 报告：**${reportType}** → \`${String(payload.reportPath)}\`\n\n`
    }
    return ''
  }

  if (event === 'tool_start') {
    const payload = payloadRecord(data)
    const tool = String(payload.tool ?? 'tool')
    const page = payload.pageUrl != null ? String(payload.pageUrl) : ''
    const startedAt = payload.startedAt != null ? Number(payload.startedAt) : undefined
    return (
      `\n🔧 **工具开始** \`${tool}\`${page ? ` · ${page}` : ''}` +
      `${startedAt != null && !Number.isNaN(startedAt) ? ` · startedAt=${startedAt}` : ''}\n\n`
    )
  }

  if (event === 'tool_success') {
    const payload = payloadRecord(data)
    const tool = String(payload.tool ?? 'tool')
    const ms = payload.durationMs != null ? Number(payload.durationMs) : undefined
    const len = payload.pageHtmlLength != null ? Number(payload.pageHtmlLength) : undefined
    return (
      `\n✅ **工具成功** \`${tool}\`${ms != null && !Number.isNaN(ms) ? ` · ${ms}ms` : ''}` +
      `${len != null && !Number.isNaN(len) ? ` · HTML ${len} 字符` : ''}\n\n`
    )
  }

  if (event === 'tool_failure') {
    const payload = payloadRecord(data)
    const tool = String(payload.tool ?? 'tool')
    const ms = payload.durationMs != null ? Number(payload.durationMs) : undefined
    const err = payload.error != null ? String(payload.error) : ''
    return (
      `\n❌ **工具失败** \`${tool}\`${ms != null && !Number.isNaN(ms) ? ` · ${ms}ms` : ''}` +
      `${err ? `\n${err}` : ''}\n\n`
    )
  }

  if (event === 'skill_start') {
    const payload = payloadRecord(data)
    const skill = String(payload.skill ?? 'skill')
    const name = payload.name != null ? String(payload.name).trim() : ''
    return `\n🧩 **Skill 开始** \`${skill}\`${name ? `（${name}）` : ''}\n\n`
  }

  if (event === 'skill_success') {
    const payload = payloadRecord(data)
    const skill = String(payload.skill ?? 'skill')
    const ms = payload.durationMs != null ? Number(payload.durationMs) : undefined
    return `\n✅ **Skill 成功** \`${skill}\`${ms != null && !Number.isNaN(ms) ? ` · ${ms}ms` : ''}\n\n`
  }

  if (event === 'skill_failure') {
    const payload = payloadRecord(data)
    const skill = String(payload.skill ?? 'skill')
    const ms = payload.durationMs != null ? Number(payload.durationMs) : undefined
    const err = payload.error != null ? String(payload.error) : ''
    return (
      `\n❌ **Skill 失败** \`${skill}\`${ms != null && !Number.isNaN(ms) ? ` · ${ms}ms` : ''}` +
      `${err ? `\n${err}` : ''}\n\n`
    )
  }

  if (event === 'mcp_call') {
    const payload = payloadRecord(data)
    const mcp = String(payload.mcp ?? 'mcp')
    return `\n🔗 **MCP** \`${mcp}\`\n\n`
  }

  if (event === 'mcp_result') {
    const payload = payloadRecord(data)
    const mcp = String(payload.mcp ?? 'mcp')
    const ok = payload.ok === true
    const ms = payload.durationMs != null ? Number(payload.durationMs) : undefined
    const err = payload.error != null ? String(payload.error) : ''
    return (
      `\n${ok ? '✅' : '❌'} **MCP 结果** \`${mcp}\`${ms != null && !Number.isNaN(ms) ? ` · ${ms}ms` : ''}` +
      `${!ok && err ? `\n${err}` : ''}\n\n`
    )
  }

  if (event === 'agent_observation') {
    const agentName = data.agentName != null ? String(data.agentName) : ''
    const payload = payloadRecord(data)
    const phase = payload.phase != null ? String(payload.phase) : ''
    const label = payload.label != null ? String(payload.label) : agentLabel(agentName)
    const summary = payload.summary != null ? String(payload.summary) : undefined
    const obsData = payload.data
    let dataSnippet = ''
    if (obsData !== undefined && obsData !== null) {
      try {
        const raw = JSON.stringify(obsData, null, 2)
        dataSnippet = raw.length > 900 ? `${raw.slice(0, 900)}\n…` : raw
      } catch {
        dataSnippet = String(obsData)
      }
    }
    return (
      `\n📡 **${label}**（\`${agentName}\`）· **${phase}**` +
      (summary ? `\n${summary}` : '') +
      (dataSnippet ? `\n\`\`\`json\n${dataSnippet}\n\`\`\`\n` : '\n')
    )
  }

  if (event === 'text') {
    const payload = payloadRecord(data)
    const body = typeof payload.content === 'string' ? payload.content : ''
    return body ? `${body}\n\n` : ''
  }

  if (event === 'complete') {
    return '\n---\n✨ **全部完成**\n'
  }

  if (event === 'error') {
    const msg = data.message != null ? String(data.message) : String(data)
    return `\n❌ ${msg}\n`
  }

  return ''
}
