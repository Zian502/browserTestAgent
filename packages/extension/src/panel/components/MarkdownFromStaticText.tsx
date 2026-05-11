import type { CSSProperties } from 'react'
import { TextMessagePartProvider } from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'

/** 用 `TextMessagePartProvider` 提供静态 `text`，从而在任意位置使用 `MarkdownTextPrimitive`。 */
export function MarkdownFromStaticText(props: { markdown: string; containerStyle?: CSSProperties }) {
  const md = props.markdown.trim()
  if (!md) return null
  return (
    <TextMessagePartProvider text={md} isRunning={false}>
      <MarkdownTextPrimitive smooth={false} containerProps={{ style: props.containerStyle }} />
    </TextMessagePartProvider>
  )
}
