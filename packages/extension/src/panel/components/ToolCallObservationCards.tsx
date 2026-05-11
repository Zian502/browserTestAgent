import { useMemo, useState, type CSSProperties } from 'react'
import { useTaskStore, type AgentObservationLogEntry } from '../stores/task-store'
import { MarkdownFromStaticText } from './MarkdownFromStaticText'

function toolKind(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const k = (data as { kind?: string }).kind
  return typeof k === 'string' ? k : undefined
}

function extractTool(data: unknown): string {
  if (data && typeof data === 'object' && 'tool' in data) {
    return String((data as { tool?: unknown }).tool ?? 'tool')
  }
  return 'tool'
}

function resultOk(data: unknown): boolean {
  return Boolean(data && typeof data === 'object' && (data as { ok?: unknown }).ok === true)
}

type MergedToolStatus = 'running' | 'done' | 'failed'

interface MergedToolCard {
  id: string
  agentName: string
  tool: string
  label: string
  status: MergedToolStatus
  summary?: string
  callEntry?: AgentObservationLogEntry
  resultEntry?: AgentObservationLogEntry
}

/** 将同一轮 tool_call + tool_result 合并为一条；按 agentName + tool 与 FIFO 队列配对 */
function mergeToolObservationLog(log: AgentObservationLogEntry[]): MergedToolCard[] {
  const merged: MergedToolCard[] = []
  const pending: { agentName: string; tool: string; rowIndex: number }[] = []

  for (const entry of log) {
    const k = toolKind(entry.data)
    if (k === 'tool_call') {
      const tool = extractTool(entry.data)
      const rowIndex = merged.length
      merged.push({
        id: entry.id,
        agentName: entry.agentName,
        tool,
        label: entry.label,
        status: 'running',
        summary: entry.summary,
        callEntry: entry,
      })
      pending.push({ agentName: entry.agentName, tool, rowIndex })
    } else if (k === 'tool_result') {
      const tool = extractTool(entry.data)
      const idx = pending.findIndex((p) => p.agentName === entry.agentName && p.tool === tool)
      if (idx >= 0) {
        const { rowIndex } = pending[idx]
        pending.splice(idx, 1)
        const row = merged[rowIndex]
        const ok = resultOk(entry.data)
        merged[rowIndex] = {
          ...row,
          status: ok ? 'done' : 'failed',
          resultEntry: entry,
          summary: entry.summary ?? row.summary,
        }
      } else {
        const ok = resultOk(entry.data)
        merged.push({
          id: entry.id,
          agentName: entry.agentName,
          tool,
          label: entry.label,
          status: ok ? 'done' : 'failed',
          summary: entry.summary,
          resultEntry: entry,
        })
      }
    }
  }

  return merged
}

function sliceJsonBody(data: unknown, max = 8000): string {
  try {
    const body = JSON.stringify(data, null, 2)
    return body.length > max ? `${body.slice(0, max)}\n…` : body
  } catch {
    const s = String(data)
    return s.length > max ? `${s.slice(0, max)}\n…` : s
  }
}

function mergedCardMarkdown(card: MergedToolCard): string {
  const lines: string[] = [
    `## ${card.label}`,
    '',
    `- **Agent**：\`${card.agentName}\``,
    `- **工具**：\`${card.tool}\``,
    `- **状态**：\`${card.status === 'running' ? '执行中' : card.status === 'done' ? '已完成' : '失败'}\``,
  ]
  if (card.summary) lines.push('', card.summary)
  if (card.callEntry?.data) {
    lines.push('', '### 调用参数', '', '```json', sliceJsonBody(card.callEntry.data), '```')
  }
  if (card.resultEntry?.data) {
    lines.push('', '### 执行结果', '', '```json', sliceJsonBody(card.resultEntry.data), '```')
  }
  return lines.join('\n')
}

const cardOuter: CSSProperties = {
  borderRadius: 10,
  border: '1px solid #e5e7eb',
  background: '#fafafa',
  overflow: 'hidden',
  minWidth: 0,
}

const cardHeader: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 8,
  padding: '8px 10px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
  boxSizing: 'border-box',
}

const statusCol: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  flex: 1,
  minWidth: 0,
}

const spinner: CSSProperties = {
  width: 14,
  height: 14,
  marginTop: 2,
  border: '2px solid #e5e7eb',
  borderTopColor: '#2563eb',
  borderRadius: '50%',
  flexShrink: 0,
  animation: 'tool-obs-card-spin 0.65s linear infinite',
}

const iconDone: CSSProperties = {
  width: 14,
  height: 14,
  marginTop: 2,
  flexShrink: 0,
  borderRadius: '50%',
  background: '#dcfce7',
  color: '#166534',
  fontSize: 10,
  lineHeight: '14px',
  textAlign: 'center',
  fontWeight: 700,
}

const iconFailed: CSSProperties = {
  ...iconDone,
  background: '#fee2e2',
  color: '#b91c1c',
}

const titleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#111827',
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
}

const summaryStyle: CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  marginTop: 2,
  lineHeight: 1.35,
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
}

function StatusIcon(props: { status: MergedToolStatus }) {
  if (props.status === 'running') {
    return <span style={spinner} aria-hidden />
  }
  if (props.status === 'done') {
    return (
      <span style={iconDone} aria-hidden title="已完成">
        ✓
      </span>
    )
  }
  return (
    <span style={iconFailed} aria-hidden title="失败">
      ✕
    </span>
  )
}

function ToolCallCard(props: { card: MergedToolCard }) {
  const [open, setOpen] = useState(false)
  const { card } = props

  return (
    <div style={cardOuter}>
      <button
        type="button"
        style={cardHeader}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-busy={card.status === 'running'}
      >
        <div style={statusCol}>
          <StatusIcon status={card.status} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={titleStyle}>{card.label}</div>
            {card.summary ? <div style={summaryStyle}>{card.summary}</div> : null}
          </div>
        </div>
        <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0, whiteSpace: 'nowrap', marginTop: 2 }}>
          {open ? '▼' : '▶'}
        </span>
      </button>
      {open ? (
        <div style={{ padding: '0 10px 10px', borderTop: '1px solid #e5e7eb', minWidth: 0 }}>
          <MarkdownFromStaticText
            markdown={mergedCardMarkdown(card)}
            containerStyle={{
              marginTop: 8,
              fontSize: 12,
              lineHeight: 1.55,
              color: '#18181b',
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
              minWidth: 0,
              maxWidth: '100%',
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

export function ToolCallObservationCards() {
  const observationLog = useTaskStore((s) => s.agentObservationLog)
  const cards = useMemo(() => mergeToolObservationLog(observationLog), [observationLog])

  if (cards.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <style>{`@keyframes tool-obs-card-spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', margin: 0 }}>工具调用</p>
      {cards.map((c) => (
        <ToolCallCard key={c.id} card={c} />
      ))}
    </div>
  )
}
