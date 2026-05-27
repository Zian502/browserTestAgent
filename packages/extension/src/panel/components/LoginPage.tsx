import { useState, type CSSProperties } from 'react'
import { useAuth } from '../auth/auth-context'

const shell: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px 24px',
  background: '#fafafa',
  boxSizing: 'border-box',
}

const card: CSSProperties = {
  width: '100%',
  maxWidth: 320,
  padding: '28px 24px',
  borderRadius: 14,
  border: '1px solid #e4e4e7',
  background: '#fff',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
  boxSizing: 'border-box',
}

const title: CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  color: '#111827',
  textAlign: 'center',
}

const subtitle: CSSProperties = {
  margin: '10px 0 0',
  fontSize: 13,
  lineHeight: 1.55,
  color: '#6b7280',
  textAlign: 'center',
}

const btnGithub: CSSProperties = {
  marginTop: 24,
  width: '100%',
  height: 42,
  borderRadius: 10,
  border: '1px solid #d4d4d8',
  background: '#18181b',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  fontFamily: 'inherit',
}

const errorText: CSSProperties = {
  marginTop: 14,
  fontSize: 12,
  lineHeight: 1.5,
  color: '#b91c1c',
  textAlign: 'center',
}

const hint: CSSProperties = {
  marginTop: 18,
  fontSize: 11,
  lineHeight: 1.5,
  color: '#9ca3af',
  textAlign: 'center',
}

function GithubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.02.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

export function LoginPage() {
  const { login } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin() {
    setLoading(true)
    setError(null)
    try {
      await login()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={shell}>
      <div style={card}>
        <h1 style={title}>Browser Test Agent</h1>
        <p style={subtitle}>使用 GitHub 账号登录后，即可开始页面测试与分析。</p>
        <button type="button" style={btnGithub} onClick={() => void handleLogin()} disabled={loading}>
          <GithubMark />
          {loading ? '正在跳转 GitHub…' : '使用 GitHub 登录'}
        </button>
        {error ? <p style={errorText}>{error}</p> : null}
        <p style={hint}>
          本地开发需在服务端配置 GITHUB_CLIENT_ID、GITHUB_CLIENT_SECRET 与 JWT_SECRET。登录后将授权创建/写入{' '}
          <code style={{ fontSize: 12 }}>playwright-test-code</code> 仓库以保存测试用例；若此前已登录，请退出后重新授权。
        </p>
      </div>
    </div>
  )
}
