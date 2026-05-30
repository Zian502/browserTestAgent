import { useMemo, useState, type CSSProperties } from 'react'
import { useTaskStore, type AgentObservationLogEntry } from '../stores/task-store'
import { AGENT_API_BASE } from '../agent-api-base'
import { authFetch } from '../auth/auth-api'
import { MarkdownFromStaticText } from './MarkdownFromStaticText'
import { RunTestCodeModal, PlayIcon, type RunTestCodeModalParams } from './RunTestCodeModal'

/** 与 `packages/server/src/agents/state.ts` 中 StreamEvent.type 对齐（含 MCP 观测） */
type InvocationStreamKind =
  | 'tool_start'
  | 'tool_success'
  | 'tool_failure'
  | 'skill_start'
  | 'skill_success'
  | 'skill_failure'
  | 'mcp_call'
  | 'mcp_result'

function observationKind(data: unknown): InvocationStreamKind | undefined {
  if (!data || typeof data !== 'object') return undefined
  const k = (data as { kind?: string }).kind
  if (
    k === 'tool_start' ||
    k === 'tool_success' ||
    k === 'tool_failure' ||
    k === 'skill_start' ||
    k === 'skill_success' ||
    k === 'skill_failure' ||
    k === 'mcp_call' ||
    k === 'mcp_result'
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

function extractMcp(data: unknown): string {
  if (data && typeof data === 'object' && 'mcp' in data) {
    return String((data as { mcp?: unknown }).mcp ?? 'mcp')
  }
  return 'mcp'
}

type MergedCardStatus = 'running' | 'done' | 'failed'

type InvocationRealm = 'tool' | 'skill' | 'mcp'

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
  if (k === 'mcp_call') return 'mcp'
  return null
}

function endKindToRealm(k: InvocationStreamKind): InvocationRealm | null {
  if (k === 'tool_success' || k === 'tool_failure') return 'tool'
  if (k === 'skill_success' || k === 'skill_failure') return 'skill'
  if (k === 'mcp_result') return 'mcp'
  return null
}

function extractKey(realm: InvocationRealm, data: unknown): string {
  if (realm === 'tool') return extractTool(data)
  if (realm === 'skill') return extractSkill(data)
  return extractMcp(data)
}

/** 结束事件是否视为成功（mcp_result 需读 payload.ok） */
function isEndSuccess(kind: InvocationStreamKind, data: unknown): boolean {
  if (kind === 'tool_success' || kind === 'skill_success') return true
  if (kind === 'mcp_result') {
    if (!data || typeof data !== 'object') return false
    return (data as Record<string, unknown>).ok === true
  }
  return false
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
    const ok = isEndSuccess(k, entry.data)

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
  if (realm === 'tool') return '工具'
  if (realm === 'skill') return 'Skill'
  return 'MCP'
}

/** 卡片标题：工具用 tool 名；Skill 优先展示友好 name，否则 skill id */
function cardDisplayTitle(card: MergedInvocationCard): string {
  if (card.realm === 'tool' || card.realm === 'mcp') return card.key
  const raw = card.callEntry?.data ?? card.resultEntry?.data
  if (raw && typeof raw === 'object' && 'name' in raw) {
    const n = String((raw as { name?: unknown }).name ?? '').trim()
    if (n) return n
  }
  return card.key
}

const RUN_TEST_CODE_SKILL_ID = 'run-test-code'
const REPORT_SKILL_ID = 'report'

const SEO_ANALYSIS_TOOL_KEY = 'seo_llm_analysis'
const PAGESPEED_MCP_KEY = 'pagespeed'

const REPORT_TYPE_ORDER = ['test', 'seo', 'pagespeed'] as const

function isRunTestCodeSkill(card: MergedInvocationCard): boolean {
  return card.realm === 'skill' && card.key === RUN_TEST_CODE_SKILL_ID
}

function isReportSkill(card: MergedInvocationCard): boolean {
  return card.realm === 'skill' && card.key === REPORT_SKILL_ID
}

/** SEO 分析工具卡片（与 `seo-agent` 中 `SEO_LLM_ANALYSIS_TOOL` 一致） */
function isSeoAnalysisToolCard(card: MergedInvocationCard): boolean {
  return card.realm === 'tool' && card.agentName === 'seoAgent' && card.key === SEO_ANALYSIS_TOOL_KEY
}

/** PageSpeed MCP 卡片（与 `pagespeed-agent` 中 mcp 名 `pagespeed` 一致） */
function isPagespeedMcpCard(card: MergedInvocationCard): boolean {
  return card.realm === 'mcp' && card.agentName === 'pagespeedAgent' && card.key === PAGESPEED_MCP_KEY
}

/** `report_ready` 写入 store 后的 HTML 报告路径（相对 `.agent-cache`） */
function storeReportPathForAgentCard(card: MergedInvocationCard, reports: Record<string, string>): string | null {
  if (isSeoAnalysisToolCard(card)) {
    const p = reports['seo']?.trim()
    return p || null
  }
  if (isPagespeedMcpCard(card)) {
    const p = reports['pagespeed']?.trim()
    return p || null
  }
  return null
}

function extractReportsMapFromPayload(data: unknown): Record<string, string> | null {
  if (!data || typeof data !== 'object') return null
  const reports = (data as Record<string, unknown>).reports
  if (!reports || typeof reports !== 'object') return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(reports)) {
    const p = String(v ?? '').trim()
    if (p) out[k] = p
  }
  return Object.keys(out).length > 0 ? out : null
}

function reportTypeLabelZh(type: string): string {
  if (type === 'test') return '测试报告'
  if (type === 'seo') return 'SEO 报告'
  if (type === 'pagespeed') return '性能报告'
  return type
}

/** 从 skill_success / 观测 payload 中解析报告相对路径（相对 `.agent-cache`） */
function reportEntriesFromCard(card: MergedInvocationCard): { type: string; path: string; label: string }[] {
  const map =
    extractReportsMapFromPayload(card.resultEntry?.data) ?? extractReportsMapFromPayload(card.callEntry?.data)
  if (!map) return []
  const seen = new Set<string>()
  const out: { type: string; path: string; label: string }[] = []
  for (const t of REPORT_TYPE_ORDER) {
    const p = map[t]
    if (p && !seen.has(p)) {
      seen.add(p)
      out.push({ type: t, path: p, label: reportTypeLabelZh(t) })
    }
  }
  for (const [t, p] of Object.entries(map)) {
    if (seen.has(p)) continue
    seen.add(p)
    out.push({ type: t, path: p, label: reportTypeLabelZh(t) })
  }
  return out
}

async function fetchReportHtmlAndOpenTab(relativePath: string): Promise<void> {
  const url = new URL('/api/agent/report-html', AGENT_API_BASE)
  url.searchParams.set('path', relativePath)
  const res = await authFetch(url.toString())
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(errText || `${res.status} ${res.statusText}`)
  }
  const html = await res.text()
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const blobUrl = URL.createObjectURL(blob)
  window.open(blobUrl, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000)
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

function runTestCodeParamsFromCard(card: MergedInvocationCard): RunTestCodeModalParams | null {
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
    `- **${card.realm === 'tool' ? '工具' : card.realm === 'skill' ? 'Skill' : 'MCP'}**：\`${card.key}\``,
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

/** 文档 / 报告预览 */
function ReportDocGlyph(props: { size?: number }) {
  const s = props.size ?? 14
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 13h8M8 17h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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

function actionBtnStyle(hover: boolean, focus: boolean, accent?: 'blue' | 'green'): CSSProperties {
  const isGreen = accent === 'green'
  return {
    ...codeActionBtn,
    marginTop: 2,
    background: hover ? '#f4f4f5' : '#ffffff',
    borderColor: hover ? '#d4d4d8' : '#e4e4e7',
    color: hover ? (isGreen ? '#15803d' : '#2563eb') : '#52525b',
    boxShadow: focus ? '0 0 0 2px #ffffff, 0 0 0 4px #93c5fd' : 'none',
  }
}

function InvocationCard(props: { card: MergedInvocationCard }) {
  const [open, setOpen] = useState(false)
  const [codeModalOpen, setCodeModalOpen] = useState(false)
  const [codeModalAutoRun, setCodeModalAutoRun] = useState(false)
  const [codeModalParams, setCodeModalParams] = useState<RunTestCodeModalParams | null>(null)
  const [viewCodeBtnHover, setViewCodeBtnHover] = useState(false)
  const [viewCodeBtnFocus, setViewCodeBtnFocus] = useState(false)
  const [runBtnHover, setRunBtnHover] = useState(false)
  const [runBtnFocus, setRunBtnFocus] = useState(false)
  const [reportOpeningPath, setReportOpeningPath] = useState<string | null>(null)
  const { card } = props

  const reportsFromStore = useTaskStore((s) => s.reports)
  const agentReportPath = storeReportPathForAgentCard(card, reportsFromStore)
  const agentReportLabel = isSeoAnalysisToolCard(card)
    ? 'SEO HTML 报告'
    : isPagespeedMcpCard(card)
      ? '性能 HTML 报告'
      : 'HTML 报告'
  const canOpenAgentHtmlReport =
    Boolean(agentReportPath) && card.status === 'done' && (isSeoAnalysisToolCard(card) || isPagespeedMcpCard(card))

  const runTestParams = runTestCodeParamsFromCard(card)
  const canRunTestCodeActions = Boolean(runTestParams)

  const reportEntries = isReportSkill(card) ? reportEntriesFromCard(card) : []
  const canOpenReportTabs = isReportSkill(card) && reportEntries.length > 0 && card.status !== 'running'

  function openRunTestCodeModal(autoRun: boolean) {
    const p = runTestCodeParamsFromCard(card)
    if (!p) return
    setCodeModalParams(p)
    setCodeModalAutoRun(autoRun)
    setCodeModalOpen(true)
  }

  function closeRunTestCodeModal() {
    setCodeModalOpen(false)
    setCodeModalAutoRun(false)
    setCodeModalParams(null)
  }

  async function openReportInNewTab(relativePath: string) {
    try {
      setReportOpeningPath(relativePath)
      await fetchReportHtmlAndOpenTab(relativePath)
    } catch (e) {
      window.alert(`打开报告失败：${String(e)}`)
    } finally {
      setReportOpeningPath(null)
    }
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
                <span style={realmBadge}>
                  {card.realm === 'tool' ? 'TOOL' : card.realm === 'skill' ? 'SKILL' : 'MCP'}
                </span>
                <div style={titleStyle}>{cardDisplayTitle(card)}</div>
              </div>
              {card.summary ? <div style={summaryStyle}>{card.summary}</div> : null}
            </div>
          </div>
          <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0, whiteSpace: 'nowrap', marginTop: 2 }}>
            {open ? '▼' : '▶'}
          </span>
        </button>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 4,
            flexShrink: 0,
            paddingTop: 4,
            paddingRight: 4,
          }}
        >
          {canOpenAgentHtmlReport && agentReportPath ? (
            <button
              type="button"
              style={{
                ...codeActionBtn,
                marginTop: 2,
                marginRight: 0,
                opacity: reportOpeningPath !== null ? 0.45 : 1,
                cursor: reportOpeningPath !== null ? 'wait' : 'pointer',
              }}
              title={`新标签页查看：${agentReportLabel}`}
              aria-label={`新标签页查看：${agentReportLabel}`}
              disabled={reportOpeningPath !== null}
              onClick={(e) => {
                e.preventDefault()
                void openReportInNewTab(agentReportPath)
              }}
            >
              <ReportDocGlyph size={14} />
            </button>
          ) : null}
          {canOpenReportTabs
            ? reportEntries.map((rep) => {
                const busy = reportOpeningPath !== null
                return (
                  <button
                    key={rep.path}
                    type="button"
                    style={{
                      ...codeActionBtn,
                      marginTop: 2,
                      marginRight: 0,
                      opacity: busy ? 0.45 : 1,
                      cursor: busy ? 'wait' : 'pointer',
                    }}
                    title={`新标签页查看：${rep.label}`}
                    aria-label={`新标签页查看：${rep.label}`}
                    disabled={busy}
                    onClick={(e) => {
                      e.preventDefault()
                      void openReportInNewTab(rep.path)
                    }}
                  >
                    <ReportDocGlyph size={14} />
                  </button>
                )
              })
            : null}
          {canRunTestCodeActions ? (
            <>
              <button
                type="button"
                style={actionBtnStyle(viewCodeBtnHover, viewCodeBtnFocus, 'blue')}
                title="查看代码"
                aria-label="查看代码"
                onPointerEnter={() => setViewCodeBtnHover(true)}
                onPointerLeave={() => setViewCodeBtnHover(false)}
                onFocus={() => setViewCodeBtnFocus(true)}
                onBlur={() => setViewCodeBtnFocus(false)}
                onClick={(e) => {
                  e.preventDefault()
                  openRunTestCodeModal(false)
                }}
              >
                <CodeEditorGlyph size={14} />
              </button>
              <button
                type="button"
                style={actionBtnStyle(runBtnHover, runBtnFocus, 'green')}
                title="执行测试"
                aria-label="执行测试"
                onPointerEnter={() => setRunBtnHover(true)}
                onPointerLeave={() => setRunBtnHover(false)}
                onFocus={() => setRunBtnFocus(true)}
                onBlur={() => setRunBtnFocus(false)}
                onClick={(e) => {
                  e.preventDefault()
                  openRunTestCodeModal(true)
                }}
              >
                <PlayIcon />
              </button>
            </>
          ) : null}
        </div>
      </div>
      <RunTestCodeModal
        open={codeModalOpen}
        onClose={closeRunTestCodeModal}
        params={codeModalParams}
        autoRun={codeModalAutoRun}
      />
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
