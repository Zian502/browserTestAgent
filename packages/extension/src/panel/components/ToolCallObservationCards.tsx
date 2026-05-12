import { useMemo, useState, type CSSProperties } from 'react'
import { useTaskStore, type AgentObservationLogEntry } from '../stores/task-store'
import { MarkdownFromStaticText } from './MarkdownFromStaticText'
import { RunTestCodeModal, type RunTestCodeModalParams } from './RunTestCodeModal'

/** 与 `packages/server/src/agents/state.ts` 中 StreamEvent.type 对齐 */
type InvocationStreamKind =
  | 'tool_start'
  | 'tool_success'
  | 'tool_failure'
  | 'skill_start'
  | 'skill_success'
  | 'skill_failure'

function observationKind(data: unknown): InvocationStreamKind | undefined {
  if (!data || typeof data !== 'object') return undefined
  const k = (data as { kind?: string }).kind
  if (
    k === 'tool_start' ||
    k === 'tool_success' ||
    k === 'tool_failure' ||
    k === 'skill_start' ||
    k === 'skill_success' ||
    k === 'skill_failure'
  ) {
    return k
  }
  return undefined
}

function extractTool(data: unknown): string {
  if (data && typeof data === 'object' && 'tool' in data) {
    return String((data as { tool?: unknown }).tool ?? 'tool')
  }
  return 'tool'
}

function extractSkill(data: unknown): string {
  if (data && typeof data === 'object' && 'skill' in data) {
    return String((data as { skill?: unknown }).skill ?? 'skill')
  }
  return 'skill'
}

type MergedCardStatus = 'running' | 'done' | 'failed'

type InvocationRealm = 'tool' | 'skill'

interface MergedInvocationCard {
  id: string
  agentName: string
  realm: InvocationRealm
  /** 工具名或 skill id */
  key: string
  label: string
  status: MergedCardStatus
  summary?: string
  callEntry?: AgentObservationLogEntry
  resultEntry?: AgentObservationLogEntry
}

interface PendingMatch {
  agentName: string
  realm: InvocationRealm
  key: string
  rowIndex: number
}

function startKindToRealm(k: InvocationStreamKind): InvocationRealm | null {
  if (k === 'tool_start') return 'tool'
  if (k === 'skill_start') return 'skill'
  return null
}

function endKindToRealm(k: InvocationStreamKind): InvocationRealm | null {
  if (k === 'tool_success' || k === 'tool_failure') return 'tool'
  if (k === 'skill_success' || k === 'skill_failure') return 'skill'
  return null
}

function extractKey(realm: InvocationRealm, data: unknown): string {
  return realm === 'tool' ? extractTool(data) : extractSkill(data)
}

function isSuccessKind(k: InvocationStreamKind): boolean {
  return k === 'tool_success' || k === 'skill_success'
}

/** 将 tool_start / skill_start 与同 agent 的 success、failure 配对合并 */
function mergeInvocationObservationLog(log: AgentObservationLogEntry[]): MergedInvocationCard[] {
  const merged: MergedInvocationCard[] = []
  const pending: PendingMatch[] = []

  for (const entry of log) {
    const k = observationKind(entry.data)
    if (!k) continue

    const startRealm = startKindToRealm(k)
    if (startRealm) {
      const key = extractKey(startRealm, entry.data)
      const rowIndex = merged.length
      merged.push({
        id: entry.id,
        agentName: entry.agentName,
        realm: startRealm,
        key,
        label: entry.label,
        status: 'running',
        summary: entry.summary,
        callEntry: entry,
      })
      pending.push({ agentName: entry.agentName, realm: startRealm, key, rowIndex })
      continue
    }

    const endRealm = endKindToRealm(k)
    if (!endRealm) continue

    const key = extractKey(endRealm, entry.data)
    const idx = pending.findIndex((p) => p.agentName === entry.agentName && p.realm === endRealm && p.key === key)
    const ok = isSuccessKind(k)

    if (idx >= 0) {
      const { rowIndex } = pending[idx]
      pending.splice(idx, 1)
      const row = merged[rowIndex]
      merged[rowIndex] = {
        ...row,
        status: ok ? 'done' : 'failed',
        resultEntry: entry,
        summary: entry.summary ?? row.summary,
      }
    } else {
      merged.push({
        id: entry.id,
        agentName: entry.agentName,
        realm: endRealm,
        key,
        label: entry.label,
        status: ok ? 'done' : 'failed',
        summary: entry.summary,
        resultEntry: entry,
      })
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

function realmLabelZh(realm: InvocationRealm): string {
  return realm === 'tool' ? '工具' : 'Skill'
}

/** 卡片标题：工具用 tool 名；Skill 优先展示友好 name，否则 skill id */
function cardDisplayTitle(card: MergedInvocationCard): string {
  if (card.realm === 'tool') return card.key
  const raw = card.callEntry?.data ?? card.resultEntry?.data
  if (raw && typeof raw === 'object' && 'name' in raw) {
    const n = String((raw as { name?: unknown }).name ?? '').trim()
    if (n) return n
  }
  return card.key
}

const RUN_TEST_CODE_SKILL_ID = 'run-test-code'

function isRunTestCodeSkill(card: MergedInvocationCard): boolean {
  return card.realm === 'skill' && card.key === RUN_TEST_CODE_SKILL_ID
}

/** 从 skill_start 等观测 `data`（含 `skill` + `input`）解析弹窗所需参数 */
function extractRunTestCodeParamsFromObservationData(data: unknown): RunTestCodeModalParams | null {
  if (!data || typeof data !== 'object') return null
  const root = data as Record<string, unknown>
  if (String(root.skill ?? '') !== RUN_TEST_CODE_SKILL_ID) return null
  const input = root.input
  if (!input || typeof input !== 'object') return null
  const inp = input as Record<string, unknown>
  const code = String(inp.code ?? '')
  const sessionId = String(inp.sessionId ?? '').trim()
  if (!sessionId || !code) return null
  return {
    code,
    sessionId,
    targetUrl: String(inp.targetUrl ?? ''),
    timeoutMs:
      inp.timeoutMs != null && Number.isFinite(Number(inp.timeoutMs)) ? Number(inp.timeoutMs) : 90_000,
  }
}

function runTestCodeModalParamsFromCard(card: MergedInvocationCard): RunTestCodeModalParams | null {
  if (!isRunTestCodeSkill(card)) return null
  return (
    extractRunTestCodeParamsFromObservationData(card.callEntry?.data) ??
    extractRunTestCodeParamsFromObservationData(card.resultEntry?.data)
  )
}

function mergedCardMarkdown(card: MergedInvocationCard): string {
  const title = cardDisplayTitle(card)
  const lines: string[] = [
    `## ${title}`,
    '',
    `- **类型**：${realmLabelZh(card.realm)}`,
    `- **Agent**：\`${card.agentName}\``,
    `- **${card.realm === 'tool' ? '工具' : 'Skill'}**：\`${card.key}\``,
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

const realmBadge: CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
}

function statusAriaLabel(status: MergedCardStatus): string {
  if (status === 'running') return '执行中'
  if (status === 'done') return '已完成'
  return '失败'
}

function StatusIcon(props: { status: MergedCardStatus }) {
  if (props.status === 'running') {
    return <span style={spinner} role="status" aria-label={statusAriaLabel('running')} />
  }
  if (props.status === 'done') {
    return (
      <span style={iconDone} role="img" aria-label={statusAriaLabel('done')}>
        ✓
      </span>
    )
  }
  return (
    <span style={iconFailed} role="img" aria-label={statusAriaLabel('failed')}>
      ✕
    </span>
  )
}

/** 代码图标：`</>`，表示「打开代码编辑器」 */
function CodeEditorGlyph(props: { size?: number }) {
  const s = props.size ?? 14
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8.5 9 5 12l3.5 3M15.5 9 19 12l-3.5 3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const codeActionBtn: CSSProperties = {
  flexShrink: 0,
  alignSelf: 'flex-start',
  marginTop: 6,
  marginRight: 6,
  width: 28,
  height: 28,
  padding: 0,
  boxSizing: 'border-box',
  border: '1px solid #e4e4e7',
  borderRadius: 7,
  background: '#ffffff',
  cursor: 'pointer',
  color: '#52525b',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 0,
  outline: 'none',
  transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease',
}

function InvocationCard(props: { card: MergedInvocationCard }) {
  const [open, setOpen] = useState(false)
  const [codeModalOpen, setCodeModalOpen] = useState(false)
  const [codeModalParams, setCodeModalParams] = useState<RunTestCodeModalParams | null>(null)
  const [codeBtnHover, setCodeBtnHover] = useState(false)
  const [codeBtnFocus, setCodeBtnFocus] = useState(false)
  const { card } = props

  const runTestSnapshot = runTestCodeModalParamsFromCard(card)
  const canOpenRunTestCodeModal = Boolean(runTestSnapshot)

  function openRunTestCodeModal() {
    const p = runTestCodeModalParamsFromCard(card)
    if (!p) return
    setCodeModalParams(p)
    setCodeModalOpen(true)
  }

  function closeRunTestCodeModal() {
    setCodeModalOpen(false)
    setCodeModalParams(null)
  }

  return (
    <div style={cardOuter}>
      <div style={{ display: 'flex', alignItems: 'stretch', width: '100%', minWidth: 0 }}>
        <button
          type="button"
          style={{
            ...cardHeader,
            flex: 1,
            minWidth: 0,
            width: 'auto',
          }}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-busy={card.status === 'running'}
          aria-label={`${cardDisplayTitle(card)}，${statusAriaLabel(card.status)}`}
        >
          <div style={statusCol}>
            <StatusIcon status={card.status} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={realmBadge}>{card.realm === 'tool' ? 'TOOL' : 'SKILL'}</span>
                <div style={titleStyle}>{cardDisplayTitle(card)}</div>
              </div>
              {card.summary ? <div style={summaryStyle}>{card.summary}</div> : null}
            </div>
          </div>
          <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0, whiteSpace: 'nowrap', marginTop: 2 }}>
            {open ? '▼' : '▶'}
          </span>
        </button>
        {canOpenRunTestCodeModal ? (
          <button
            type="button"
            style={{
              ...codeActionBtn,
              background: codeBtnHover ? '#f4f4f5' : '#ffffff',
              borderColor: codeBtnHover ? '#d4d4d8' : '#e4e4e7',
              color: codeBtnHover ? '#2563eb' : '#52525b',
              boxShadow: codeBtnFocus ? '0 0 0 2px #ffffff, 0 0 0 4px #93c5fd' : 'none',
            }}
            title="打开编辑器并执行测试代码"
            aria-label="打开编辑器并执行测试代码"
            onPointerEnter={() => setCodeBtnHover(true)}
            onPointerLeave={() => setCodeBtnHover(false)}
            onFocus={() => setCodeBtnFocus(true)}
            onBlur={() => setCodeBtnFocus(false)}
            onClick={(e) => {
              e.preventDefault()
              openRunTestCodeModal()
            }}
          >
            <CodeEditorGlyph size={14} />
          </button>
        ) : null}
      </div>
      <RunTestCodeModal open={codeModalOpen} onClose={closeRunTestCodeModal} params={codeModalParams} />
      {open ? (
        <div
          style={{
            padding: '0 10px 10px',
            borderTop: '1px solid #e5e7eb',
            minWidth: 0,
            maxHeight: 'min(45vh, 360px)',
            overflowY: 'auto',
            overflowX: 'auto',
            overscrollBehavior: 'contain',
          }}
        >
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
  const cards = useMemo(() => mergeInvocationObservationLog(observationLog), [observationLog])

  if (cards.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <style>{`@keyframes tool-obs-card-spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', margin: 0 }}>工具与 Skill</p>
      {cards.map((c) => (
        <InvocationCard key={`${c.id}-${c.realm}-${c.key}`} card={c} />
      ))}
    </div>
  )
}
