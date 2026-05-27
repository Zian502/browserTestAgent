import type { CSSProperties } from 'react'
import type { AuthUser } from '../auth/auth-storage'
import { resolveGithubAvatarUrl } from '../auth/auth-storage'

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '10px 12px',
  borderBottom: '1px solid #e4e4e7',
  background: '#fff',
  flexShrink: 0,
}

const headerTitle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  fontWeight: 600,
  color: '#111827',
}

const userRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
}

const avatarStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  flexShrink: 0,
  objectFit: 'cover',
  background: '#f3f4f6',
}

const nameCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  lineHeight: 1.25,
}

const loginStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#111827',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 140,
}

const displayNameStyle: CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 140,
}

const logoutBtn: CSSProperties = {
  border: '1px solid #e4e4e7',
  background: '#fff',
  color: '#374151',
  borderRadius: 8,
  padding: '4px 8px',
  fontSize: 11,
  cursor: 'pointer',
  fontFamily: 'inherit',
  flexShrink: 0,
}

type UserProfileBarProps = {
  user: AuthUser
  onLogout: () => void
}

export function UserProfileBar({ user, onLogout }: UserProfileBarProps) {
  const avatarSrc = resolveGithubAvatarUrl(user)

  return (
    <header style={headerStyle}>
      <h2 style={headerTitle}>Browser Test Agent</h2>
      <div style={userRow}>
        <img src={avatarSrc} alt="" style={avatarStyle} referrerPolicy="no-referrer" />
        <div style={nameCol}>
          <span style={loginStyle}>@{user.login}</span>
          {user.name && user.name !== user.login ? (
            <span style={displayNameStyle}>{user.name}</span>
          ) : null}
        </div>
        <button type="button" style={logoutBtn} onClick={onLogout}>
          退出
        </button>
      </div>
    </header>
  )
}
