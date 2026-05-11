import { useState, type CSSProperties } from 'react'
import { useTaskStore, type UiTask, type TaskStatus } from '../stores/task-store'
import { MarkdownFromStaticText } from './MarkdownFromStaticText'

const STATUS_LABEL: Record<string, string> = {
  pending: '等待',
  running: '执行中',
  done: '完成',
  failed: '失败',
  skipped: '跳过/缓存',
}

const iconSlot: CSSProperties = {
  width: 14,
  height: 14,
  flexShrink: 0,
  marginTop: 1,
  boxSizing: 'border-box',
}

const spinner: CSSProperties = {
  ...iconSlot,
  border: '2px solid #e5e7eb',
  borderTopColor: '#2563eb',
  borderRadius: '50%',
  animation: 'task-list-card-spin 0.65s linear infinite',
}

const iconDone: CSSProperties = {
  ...iconSlot,
  borderRadius: '50%',
  background: '#dcfce7',
  color: '#166534',
  fontSize: 9,
  lineHeight: '14px',
  textAlign: 'center',
  fontWeight: 700,
  display: 'block',
}

const iconFailed: CSSProperties = {
  ...iconDone,
  background: '#fee2e2',
  color: '#b91c1c',
}

const iconPending: CSSProperties = {
  ...iconSlot,
  borderRadius: '50%',
  border: '2px solid #d1d5db',
  background: 'transparent',
}

const iconSkipped: CSSProperties = {
  ...iconSlot,
  borderRadius: 4,
  background: '#f3f4f6',
  color: '#6b7280',
  fontSize: 9,
  lineHeight: '14px',
  textAlign: 'center',
  fontWeight: 600,
  display: 'block',
}

function TaskStatusIcon(props: { status: TaskStatus }) {
  const { status } = props
  if (status === 'running') {
    return <span style={spinner} aria-hidden title="执行中" />
  }
  if (status === 'done') {
    return (
      <span style={iconDone} aria-hidden title="已完成">
        ✓
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span style={iconFailed} aria-hidden title="失败">
        ✕
      </span>
    )
  }
  if (status === 'skipped') {
    return (
      <span style={iconSkipped} aria-hidden title="跳过/缓存">
        ~
      </span>
    )
  }
  return <span style={iconPending} aria-hidden title="等待" />
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
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '8px 10px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  color: '#374151',
  textAlign: 'left',
}

const taskRowBtn: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '6px 8px',
  border: 'none',
  borderRadius: 8,
  background: '#fff',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  color: '#111827',
  textAlign: 'left',
  boxSizing: 'border-box',
}

const detailBox: CSSProperties = {
  padding: '0 10px 10px',
  borderTop: '1px solid #e5e7eb',
  marginTop: 4,
  paddingTop: 8,
}

function taskDetailMarkdown(task: UiTask): string {
  const st = STATUS_LABEL[task.status] ?? task.status
  return [
    `## ${task.title}`,
    '',
    `- **任务 ID**：\`${task.id}\``,
    `- **负责 agent**：\`${task.assignTo}\``,
    `- **状态**：${st}`,
  ].join('\n')
}

export function TaskListCard() {
  const tasks = useTaskStore((s) => s.tasks)
  const [listOpen, setListOpen] = useState(true)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)

  if (tasks.length === 0) return null

  return (
    <div style={cardOuter}>
      <style>{`@keyframes task-list-card-spin { to { transform: rotate(360deg); } }`}</style>
      <button type="button" style={cardHeader} onClick={() => setListOpen((v) => !v)} aria-expanded={listOpen}>
        <span>执行计划 · {tasks.length} 项</span>
        <span aria-hidden style={{ color: '#6b7280', fontSize: 11 }}>
          {listOpen ? '▼' : '▶'}
        </span>
      </button>
      {listOpen ? (
        <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tasks.map((task) => {
            const expanded = openTaskId === task.id
            return (
              <div key={task.id} style={{ borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                <button
                  type="button"
                  style={taskRowBtn}
                  onClick={() => setOpenTaskId(expanded ? null : task.id)}
                  aria-expanded={expanded}
                  aria-busy={task.status === 'running'}
                >
                  <TaskStatusIcon status={task.status} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: '16px',
                    }}
                  >
                    {task.title}
                  </span>
                  <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0, lineHeight: '16px' }}>
                    {STATUS_LABEL[task.status] ?? task.status}
                  </span>
                  <span aria-hidden style={{ color: '#9ca3af', fontSize: 10, lineHeight: '16px', flexShrink: 0 }}>
                    {expanded ? '▼' : '▶'}
                  </span>
                </button>
                {expanded ? (
                  <div style={detailBox}>
                    <MarkdownFromStaticText
                      markdown={taskDetailMarkdown(task)}
                      containerStyle={{
                        fontSize: 12,
                        lineHeight: 1.55,
                        color: '#18181b',
                        wordBreak: 'break-word',
                      }}
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
