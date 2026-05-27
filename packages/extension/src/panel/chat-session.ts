/** 须与 `packages/server/src/chat/constants.ts` 中 `DEFAULT_CHAT_SESSION_ID` 一致。 */
export const DEFAULT_CHAT_SESSION_ID = 'default-local-session'

/** 与服务端 `chatSessionIdForUser` 保持一致。 */
export function chatSessionIdForUser(userId?: string | null): string {
  const id = String(userId ?? '').trim()
  return id ? `user-${id}` : DEFAULT_CHAT_SESSION_ID
}
