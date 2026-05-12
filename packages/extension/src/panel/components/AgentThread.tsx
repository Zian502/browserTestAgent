import { useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import {
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  AuiIf,
  useAui,
  useAuiState,
  useMessagePartText,
} from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import { AssistantRunArtifactsContext, useAssistantRunArtifacts } from './assistant-run-artifacts-context'
import { RunArtifactsPanel } from './RunArtifactsPanel'

const welcomeListStyle: CSSProperties = {
  padding: '12px 12px 8px',
  minWidth: 0,
  boxSizing: 'border-box',
}

const welcomeTitle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#111827',
  margin: '0 0 8px',
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
}

const welcomeUl: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const welcomeBtn: CSSProperties = {
  width: '100%',
  textAlign: 'left',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid #e5e7eb',
  background: '#fff',
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
}

const welcomeBtnHover: CSSProperties = {
  borderColor: '#2563eb',
  boxShadow: '0 0 0 2px rgba(37, 99, 235, 0.18)',
}

const welcomeBtnTitle: CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: '#111827',
  marginBottom: 4,
}

const welcomeBtnDesc: CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  lineHeight: 1.45,
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
}

const WELCOME_ITEMS = [
  {
    title: 'https://www.bydfi.com/zh/moonx/pump 页面的登录',
    description: '解析页面结构，生成 Playwright 测试代码。',
    prompt: 'https://www.bydfi.com/zh/moonx/pump，找到登录按钮，点击按钮，显示登录弹框后，输入账号和密码，最后点击提交按钮',
  },
  {
    title: 'https://www.bydfi.com/zh/moonx/pump 页面的SEO检查',
    description: '分析该页面的 SEO',
    prompt: 'https://www.bydfi.com/zh/moonx/pump，分析该页面的 SEO',
  },
  {
    title: 'https://www.bydfi.com/zh/moonx/pump 页面的性能（PageSpeed）',
    description: '分析该页面的性能（PageSpeed）',
    prompt: 'https://www.bydfi.com/zh/moonx/pump，分析该页面的性能（PageSpeed）',
  },
] as const

function WelcomePromptButton(props: {
  title: string
  description: string
  prompt: string
  onPick: (prompt: string) => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      style={{ ...welcomeBtn, ...(hover ? welcomeBtnHover : {}) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => props.onPick(props.prompt)}
    >
      <span style={welcomeBtnTitle}>{props.title}</span>
      <span style={welcomeBtnDesc}>{props.description}</span>
    </button>
  )
}

function ThreadWelcomeList() {
  const aui = useAui()

  return (
    <div style={welcomeListStyle}>
      <p style={welcomeTitle}>还没有消息，可从下面选一项开始</p>
      <ul style={welcomeUl}>
        {WELCOME_ITEMS.map((item) => (
          <li key={item.title}>
            <WelcomePromptButton
              title={item.title}
              description={item.description}
              prompt={item.prompt}
              onPick={(prompt) => {
                aui.thread().append({
                  role: 'user',
                  content: [{ type: 'text', text: prompt }],
                  startRun: true,
                })
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

const shell: CSSProperties = {
  width: 380,
  maxWidth: '100%',
  height: '100%',
  minHeight: 0,
  minWidth: 0,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'system-ui, sans-serif',
  color: '#111827',
  background: '#fff',
  boxSizing: 'border-box',
}

const viewport: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
}

/** 欢迎区 + 消息区：占满视口剩余高度，内容可滚动，把底部输入栏顶在面板最下沿 */
const viewportMain: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  display: 'flex',
  flexDirection: 'column',
}

/** 消息列表容器（Messages 本身无包裹节点，需外层控制间距与滚动） */
const messagesArea: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 12,
  padding: '12px 12px 10px',
  background: '#fafafa',
}

/** 底部：输入框 + 发送；不参与伸缩，始终贴在视口底边 */
const viewportFooter: CSSProperties = {
  flexShrink: 0,
  minWidth: 0,
  background: '#fff',
}

const msgUser: CSSProperties = {
  alignSelf: 'flex-end',
  maxWidth: 'min(92%, 320px)',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '10px 14px',
  borderRadius: 14,
  background: '#18181b',
  color: '#fafafa',
  fontSize: 13,
  lineHeight: 1.5,
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.06)',
}

const msgAssistant: CSSProperties = {
  alignSelf: 'flex-start',
  maxWidth: 'min(100%, 340px)',
  minWidth: 0,
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 14px',
  borderRadius: 14,
  border: '1px solid #e4e4e7',
  background: '#fff',
  fontSize: 13,
  lineHeight: 1.5,
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
}

const composerBar: CSSProperties = {
  padding: '8px 10px',
  background: '#fff',
  minWidth: 0,
  boxSizing: 'border-box',
}

/** 输入框与发送/停止按钮统一高度（含 1px 边框） */
const COMPOSER_CONTROL_H = 36

const composerRow: CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'flex-end',
  gap: 8,
  width: '100%',
  minWidth: 0,
}

/** TextareaAutosize 的 style 类型较窄（禁止 minHeight / 仅 height 为 number），与 CSSProperties 断言兼容 */
type ComposerInputStyle = NonNullable<ComponentProps<typeof ComposerPrimitive.Input>['style']>

/** ComposerPrimitive.Input 底层为 TextareaAutosize：禁止 style.minHeight，用 minRows 控制最小高度 */
const composerInput: CSSProperties = {
  flex: 1,
  minWidth: 0,
  resize: 'none',
  boxSizing: 'border-box',
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid #e4e4e7',
  fontSize: 13,
  fontFamily: 'inherit',
  lineHeight: '20px',
  background: '#fafafa',
}

const composerActions: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
}

const btnPrimary: CSSProperties = {
  boxSizing: 'border-box',
  height: COMPOSER_CONTROL_H,
  minHeight: COMPOSER_CONTROL_H,
  padding: '0 14px',
  borderRadius: 8,
  border: 'none',
  background: '#18181b',
  color: '#fff',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const btnGhost: CSSProperties = {
  ...btnPrimary,
  background: '#e4e4e7',
  color: '#18181b',
}

function UserMessage() {
  return (
    <MessagePrimitive.Root style={msgUser}>
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  )
}

const markdownContainer: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.6,
  color: '#18181b',
  minWidth: 0,
  maxWidth: '100%',
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
}

function AssistantText() {
  const part = useMessagePartText()
  const text = 'text' in part ? part.text : ''
  const showRunArtifacts = useAssistantRunArtifacts()
  const isFirstTextPart = useAuiState((s) => {
    if (s.part.type !== 'text') return false
    const first = s.message.parts.find((p) => p.type === 'text')
    return first === s.part
  })
  const showPanel = Boolean(showRunArtifacts && isFirstTextPart)
  const hasText = String(text).trim().length > 0

  if (!hasText && !showPanel) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, width: '100%' }}>
      {hasText ? (
        <MarkdownTextPrimitive
          smooth
          containerProps={{
            className: 'agent-thread-md',
            style: markdownContainer,
          }}
        />
      ) : null}
      {showPanel ? <RunArtifactsPanel /> : null}
    </div>
  )
}

function AssistantMessage(props: { showRunArtifacts: boolean }) {
  return (
    <AssistantRunArtifactsContext.Provider value={props.showRunArtifacts}>
      <MessagePrimitive.Root style={msgAssistant}>
        <MessagePrimitive.Parts components={{ Text: AssistantText }} />
      </MessagePrimitive.Root>
    </AssistantRunArtifactsContext.Provider>
  )
}

/** 与助手气泡一致，作为会话列表中的一条「占位回复」；纵向容纳 loading 行 + 运行态卡片 */
const pendingAssistantLoaderRoot: CSSProperties = {
  ...msgAssistant,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 0,
  minWidth: 0,
}

const pendingAssistantLoaderRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
}

const loadingSpinner: CSSProperties = {
  width: 16,
  height: 16,
  border: '2px solid #e4e4e7',
  borderTopColor: '#18181b',
  borderRadius: '50%',
  flexShrink: 0,
  animation: 'agent-thread-spin 0.65s linear infinite',
}

const loadingLabel: CSSProperties = {
  fontSize: 13,
  color: '#6b7280',
  minWidth: 0,
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
}

function assistantTextFromParts(parts: readonly unknown[] | undefined): string {
  if (!parts?.length) return ''
  let s = ''
  for (const p of parts) {
    if (p && typeof p === 'object' && 'type' in p && (p as { type: string }).type === 'text' && 'text' in p) {
      const t = (p as { text?: unknown }).text
      if (typeof t === 'string') s += t
    }
  }
  return s
}

/** 新消息或流式追加文本后，将消息列表滚动条置底 */
function threadScrollBottomKey(s: { thread: { messages: readonly unknown[]; isRunning: boolean } }): string {
  const msgs = s.thread.messages
  let key = `${msgs.length}\0${s.thread.isRunning ? 1 : 0}`
  for (const m of msgs) {
    const id =
      m && typeof m === 'object' && 'id' in m && typeof (m as { id: unknown }).id === 'string'
        ? (m as { id: string }).id
        : ''
    const role = m && typeof m === 'object' && 'role' in m ? String((m as { role: unknown }).role) : ''
    const parts =
      m && typeof m === 'object' && 'parts' in m ? (m as { parts?: readonly unknown[] }).parts : undefined
    key += `\0${id}:${role}:${assistantTextFromParts(parts).length}`
  }
  return key
}

function MessagesAreaAutoScroll(props: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const scrollKey = useAuiState(threadScrollBottomKey)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [scrollKey])
  return (
    <div ref={ref} style={messagesArea}>
      {props.children}
    </div>
  )
}

function messageIsLastInThread(message: unknown, msgs: readonly unknown[]): boolean {
  if (msgs.length === 0) return false
  const last = msgs[msgs.length - 1]
  if (message === last) return true
  if (
    message &&
    last &&
    typeof message === 'object' &&
    typeof last === 'object' &&
    'id' in message &&
    'id' in last
  ) {
    return (message as { id: string }).id === (last as { id: string }).id
  }
  return false
}

/** 接口尚未推送助手文本：不渲染空气泡，由 PendingAssistantLoader 展示 loading */
function ThreadMessageRow({ message }: { message: { role: string; parts?: readonly unknown[] } }) {
  // useAuiState 用 Object.is 比较快照：不能返回每次新建的 { ... }，否则会「Maximum update depth exceeded」
  const hideEmptyAssistantBubble = useAuiState((s) => {
    if (message.role !== 'assistant') return false
    if (!s.thread.isRunning) return false
    if (assistantTextFromParts(message.parts).trim() !== '') return false
    return messageIsLastInThread(message, s.thread.messages)
  })
  const showRunArtifacts = useAuiState((s) => {
    if (message.role !== 'assistant') return false
    const msgs = s.thread.messages
    if (!messageIsLastInThread(message, msgs)) return false
    if (s.thread.isRunning && assistantTextFromParts(message.parts).trim() === '') return false
    return true
  })

  if (message.role === 'user') return <UserMessage />
  if (message.role === 'assistant') {
    if (hideEmptyAssistantBubble) return null
    return <AssistantMessage showRunArtifacts={showRunArtifacts} />
  }
  return null
}

/** 服务端尚未推送首段 assistant 文本时展示 */
function PendingAssistantLoader() {
  const visible = useAuiState((s) => {
    if (!s.thread.isRunning) return false
    const msgs = s.thread.messages
    const last = msgs[msgs.length - 1]
    if (!last) return true
    if (last.role === 'user') return true
    if (last.role === 'assistant') {
      return assistantTextFromParts(last.parts) === ''
    }
    return false
  })

  if (!visible) return null

  return (
    <AssistantRunArtifactsContext.Provider value={true}>
      <div style={pendingAssistantLoaderRoot} role="status" aria-live="polite">
        <div style={pendingAssistantLoaderRow}>
          <span style={loadingSpinner} aria-hidden />
          <span style={loadingLabel}>正在等待回复…</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <RunArtifactsPanel />
        </div>
      </div>
    </AssistantRunArtifactsContext.Provider>
  )
}

export function AgentThread() {
  return (
    <ThreadPrimitive.Root style={shell}>
      <style>{`
@keyframes agent-thread-spin { to { transform: rotate(360deg); } }
.agent-thread-md { min-width: 0; max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
.agent-thread-md pre {
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  max-width: 100%;
}
.agent-thread-md code { white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; }
.agent-thread-md img, .agent-thread-md video { max-width: 100%; height: auto; }
.agent-thread-md table {
  width: 100%;
  max-width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}
.agent-thread-md th, .agent-thread-md td { word-break: break-word; overflow-wrap: anywhere; }
`}</style>
      <ThreadPrimitive.Viewport style={viewport}>
        <div style={viewportMain}>
          <AuiIf condition={(s) => s.thread.isEmpty}>
            <ThreadWelcomeList />
          </AuiIf>

          <AuiIf condition={(s) => !s.thread.isEmpty}>
            <MessagesAreaAutoScroll>
              <ThreadPrimitive.Messages>
                {({ message }) => <ThreadMessageRow message={message} />}
              </ThreadPrimitive.Messages>
              <PendingAssistantLoader />
            </MessagesAreaAutoScroll>
          </AuiIf>
        </div>

        <ThreadPrimitive.ViewportFooter style={viewportFooter}>
          <ThreadPrimitive.ScrollToBottom
            style={{
              alignSelf: 'center',
              marginBottom: 4,
              fontSize: 11,
              color: '#6b7280',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          />
          <div style={composerBar}>
            <ComposerPrimitive.Root>
              <div style={composerRow}>
                <ComposerPrimitive.Input
                  placeholder="描述要对当前页面做的测试或分析…"
                  rows={1}
                  minRows={1}
                  maxRows={6}
                  style={composerInput as ComposerInputStyle}
                />
                <div style={composerActions}>
                  <AuiIf condition={(s) => !s.thread.isRunning}>
                    <ComposerPrimitive.Send style={btnPrimary}>发送</ComposerPrimitive.Send>
                  </AuiIf>
                  <AuiIf condition={(s) => s.thread.isRunning}>
                    <ComposerPrimitive.Cancel style={btnGhost}>停止</ComposerPrimitive.Cancel>
                  </AuiIf>
                </div>
              </div>
            </ComposerPrimitive.Root>
          </div>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  )
}
