import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { AGENT_API_BASE } from '../agent-api-base'

SyntaxHighlighter.registerLanguage('typescript', typescript)

export type RunTestCodeModalParams = {
  code: string
  sessionId: string
  targetUrl: string
  timeoutMs: number
}

const EDITOR_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
const EDITOR_PAD = 10
const EDITOR_FS = 12
const EDITOR_LH = 1.55

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  boxSizing: 'border-box',
}

const panel: CSSProperties = {
  width: 'min(720px, 100%)',
  maxHeight: 'min(88vh, 900px)',
  background: '#fafafa',
  borderRadius: 12,
  border: '1px solid #e5e7eb',
  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflow: 'hidden',
}

const toolbar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '10px 12px',
  borderBottom: '1px solid #e5e7eb',
  flexShrink: 0,
}

const editorWrap: CSSProperties = {
  flex: 1,
  minHeight: 200,
  padding: '10px 12px',
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
}

const iconBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
  color: '#111827',
}

function CodeFileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M10 13h4M10 17h2" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

/** 透明 textarea 叠在 react-syntax-highlighter 上，滚动用 translateY 同步 */
function RunTestSyntaxEditor(props: {
  value: string
  onChange: (v: string) => void
  readOnly?: boolean
  minViewportHeight?: number
}) {
  const { value, onChange, readOnly, minViewportHeight = 280 } = props
  const hlWrapRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const syncHighlightScroll = useCallback(() => {
    const t = taRef.current
    const h = hlWrapRef.current
    if (!t || !h) return
    h.style.transform = `translateY(${-t.scrollTop}px)`
  }, [])

  useEffect(() => {
    syncHighlightScroll()
  }, [value, syncHighlightScroll])

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        minHeight: minViewportHeight,
        flex: 1,
        borderRadius: 8,
        border: '1px solid #d1d5db',
        overflow: 'hidden',
        background: '#fafafa',
        boxSizing: 'border-box',
      }}
    >
      <div
        ref={hlWrapRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          right: 0,
          transform: 'translateY(0)',
          willChange: 'transform',
          pointerEvents: 'none',
        }}
      >
        <SyntaxHighlighter
          language="typescript"
          style={oneLight}
          PreTag="div"
          CodeTag="div"
          showLineNumbers={false}
          wrapLines
          wrapLongLines
          customStyle={{
            margin: 0,
            padding: EDITOR_PAD,
            background: '#fafafa',
            fontSize: EDITOR_FS,
            lineHeight: EDITOR_LH,
            fontFamily: EDITOR_FONT,
          }}
        >
          {value.length > 0 ? value : ' '}
        </SyntaxHighlighter>
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncHighlightScroll}
        spellCheck={false}
        readOnly={readOnly}
        aria-label="Playwright 测试源码"
        style={{
          position: 'relative',
          display: 'block',
          width: '100%',
          minHeight: minViewportHeight,
          height: minViewportHeight,
          maxHeight: 'min(52vh, 480px)',
          margin: 0,
          padding: EDITOR_PAD,
          boxSizing: 'border-box',
          border: 'none',
          resize: 'vertical',
          fontFamily: EDITOR_FONT,
          fontSize: EDITOR_FS,
          lineHeight: EDITOR_LH,
          tabSize: 2,
          background: 'transparent',
          color: 'transparent',
          caretColor: '#18181b',
          outline: 'none',
          overflow: 'auto',
          whiteSpace: 'pre',
          overflowWrap: 'normal',
          wordBreak: 'normal',
        }}
      />
    </div>
  )
}

export function RunTestCodeModal(props: {
  open: boolean
  onClose: () => void
  params: RunTestCodeModalParams | null
}) {
  const { open, onClose, params } = props
  const [code, setCode] = useState('')
  const [running, setRunning] = useState(false)
  const [resultText, setResultText] = useState<string | null>(null)

  useEffect(() => {
    if (open && params) {
      setCode(params.code)
      setResultText(null)
    }
  }, [open, params])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !params) return null

  async function handleRun() {
    setRunning(true)
    setResultText(null)
    try {
      const res = await fetch(`${AGENT_API_BASE}/api/agent/run-test-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: params.sessionId,
          code,
          targetUrl: params.targetUrl,
          timeoutMs: params.timeoutMs,
        }),
      })
      const body = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        const msg =
          typeof body.message === 'string'
            ? body.message
            : typeof body.error === 'string'
              ? body.error
              : `请求失败 ${res.status}`
        setResultText(msg)
        return
      }
      if (body.ok === true && body.op === 'run_test') {
        const passed = Number(body.passed ?? 0)
        const failed = Number(body.failed ?? 0)
        const ms = Number(body.durationMs ?? 0)
        const logs = Array.isArray(body.logs) ? (body.logs as string[]).join('\n') : ''
        setResultText(
          `通过 ${passed} · 失败 ${failed} · ${ms}ms\n${logs ? `\n---\n${logs}` : ''}`.trim(),
        )
      } else if (body.ok === false && body.op === 'run_test') {
        setResultText(String(body.error ?? 'run_test 失败'))
      } else {
        setResultText(JSON.stringify(body, null, 2))
      }
    } catch (e) {
      setResultText(String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div
      style={overlay}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div style={panel} role="dialog" aria-modal aria-labelledby="run-test-code-title">
        <div style={toolbar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ color: '#6b7280', display: 'flex' }}>
              <CodeFileIcon />
            </span>
            <span id="run-test-code-title" style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
              测试代码
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              style={{
                ...iconBtn,
                borderColor: '#2563eb',
                background: running ? '#e5e7eb' : '#2563eb',
                color: running ? '#6b7280' : '#fff',
                cursor: running ? 'wait' : 'pointer',
              }}
              title="执行测试"
              aria-label="执行测试"
              disabled={running}
              onClick={() => void handleRun()}
            >
              <PlayIcon />
            </button>
            <button
              type="button"
              style={{ ...iconBtn, width: 'auto', padding: '0 12px', fontSize: 12, fontWeight: 500 }}
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>
        <div style={editorWrap}>
          <RunTestSyntaxEditor value={code} onChange={setCode} readOnly={running} />
          {resultText ? (
            <pre
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 8,
                background: '#f4f4f5',
                border: '1px solid #e4e4e7',
                fontSize: 11,
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#18181b',
                maxHeight: 160,
                overflow: 'auto',
              }}
            >
              {resultText}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  )
}
