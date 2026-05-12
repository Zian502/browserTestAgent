import { useMemo, useState, type CSSProperties } from 'react'
import { useTaskStore, type UiSubTask, type TaskStatus } from '../stores/task-store'
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

function taskDetailMarkdown(task: UiSubTask): string {
  const st = STATUS_LABEL[task.status] ?? task.status
  return [
    `## ${task.title}`,
    '',
    `- **任务 ID**：\`${task.id}\``,
    `- **负责 agent**：\`${task.assignTo}\``,
    `- **状态**：${st}`,
  ].join('\n')
}

const mainSection: CSSProperties = {
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  overflow: 'hidden',
  background: '#fff',
}

const mainTitleBar: CSSProperties = {
  padding: '6px 8px',
  fontSize: 11,
  fontWeight: 700,
  color: '#1f2937',
  background: '#f3f4f6',
  borderBottom: '1px solid #e5e7eb',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
}

const subTaskWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '6px 6px 8px 8px',
}

export function TaskListCard() {
  const mainTasks = useTaskStore((s) => s.mainTasks)
  const [listOpen, setListOpen] = useState(true)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)

  const totalSteps = useMemo(
    () => mainTasks.reduce((n, m) => n + m.subTasks.length, 0),
    [mainTasks],
  )

  if (totalSteps === 0) return null

  return (
    <div style={cardOuter}>
      <style>{`@keyframes task-list-card-spin { to { transform: rotate(360deg); } }`}</style>
      <button type="button" style={cardHeader} onClick={() => setListOpen((v) => !v)} aria-expanded={listOpen}>
        <span>
          执行计划 · {mainTasks.length} 个主任务 · {totalSteps} 步子任务
        </span>
        <span aria-hidden style={{ color: '#6b7280', fontSize: 11 }}>
          {listOpen ? '▼' : '▶'}
        </span>
      </button>
      {listOpen ? (
        <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mainTasks.map((main) => (
            <div key={main.id} style={mainSection}>
              <div style={mainTitleBar}>
                <span style={{ flex: 1, minWidth: 0 }}>{main.title}</span>
                {main.pipeline ? (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: '#4b5563',
                      background: '#e5e7eb',
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}
                  >
                    {main.pipeline}
                  </span>
                ) : null}
              </div>
              <div style={subTaskWrap}>
                {main.subTasks.map((task) => {
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
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
