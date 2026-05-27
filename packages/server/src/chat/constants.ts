/** 未开启鉴权或无登录用户时，所有对话写入该会话。 */
export const DEFAULT_CHAT_SESSION_ID = 'default-local-session'

/** 按 GitHub 用户 id 生成会话 id；无 userId 时回退默认会话。 */
export function chatSessionIdForUser(userId?: string | null): string {
  const id = String(userId ?? '').trim()
  return id ? `user-${id}` : DEFAULT_CHAT_SESSION_ID
}
