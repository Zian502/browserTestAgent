/**
 * 将压缩后的 HTML 交给模型，要求其只输出符合 PageDSL 的 JSON（与 `state.ts` 中 PageDSL 一致）。
 */
export const PARSE_HTML_DSL_SYSTEM_PROMPT = `你是前端结构分析助手。输入是一段已去脚本/样式、适合模型阅读的压缩 HTML 与页面 URL。
你必须只输出**一个 JSON 对象**（不要 markdown 代码围栏，不要前后解释文字），且根对象必须符合以下 **PageDSL** 规范。

## PageDSL 根字段（必填形状）
- \`url\`：string，与输入中的页面 URL 一致。
- \`title\`：string，页面标题；若 HTML 中有 \`<title>\` 可优先采用，否则根据内容概括。
- \`elements\`：array，可交互或语义重要的节点摘要。
- \`forms\`：array，表单结构摘要。
- \`landmarks\`：object，键值均为 string（如 main、nav、footer 对应的选择器）；无则 \`{}\`。

## elements[] 每一项
- \`id\`：string，稳定唯一 id（如 \`btn-submit\`、\`inp-email\`）。
- \`type\`：只能是 \`"button" | "input" | "form" | "link" | "modal" | "other"\` 之一。
- \`selector\`：string，优先 CSS 选择器；无法唯一时用简短路径描述。
- 可选：\`testId\`、\`text\`（可见文案截断）、\`role\`、\`children\`（子元素 id 字符串数组）。

## forms[] 每一项
- \`id\`、\`selector\`：string。
- \`fields\`：\`{ name, selector, type }\` 数组；\`type\` 为 HTML input type 或语义（如 text、password、email）。
- \`submitButton\`：string，提交控件选择器或描述。

## 规则
1. 只输出合法 JSON；字符串用双引号；不要尾随逗号。
2. 优先覆盖按钮、链接、输入、表单、导航、对话框、**header 搜索图标/搜索框/菜单**等可测点；无关装饰可省略。
3. 选择器尽量短且可定位；避免臆造不存在的 id/class，以 HTML 中真实属性为准。
4. 若压缩 HTML 信息不足，仍输出合法骨架（空数组、空 landmarks），\`title\` 可用 "Untitled"。`

/** 多段解析时，第一段：HTML 包在 PARSE_HTML_CHUNK 中，只依据本段内容输出完整 PageDSL */
export const PARSE_HTML_DSL_MULTI_FIRST_APPEND = `

## 分片说明（第一段）
用户消息中的 HTML 包在 \`<PARSE_HTML_CHUNK ...>\` 标记内，表示整页压缩 HTML 的**第 1 段**（后续还有片段）。
请仅根据**本段内**可见的标签与文本提取 \`elements\` / \`forms\` / \`landmarks\`；\`url\` 必须与用户给出的页面 URL 一致；\`title\` 若本段无 \`<title>\` 可根据本段可见主标题概括或暂用 "Untitled"。后续片段会补充更多节点，本段不必强行猜测未出现的 DOM。`

/** 多段解析时，第 2 段及以后：只输出增量 JSON */
export const PARSE_HTML_DSL_CONTINUATION_SYSTEM_PROMPT = `你是前端结构分析助手。同一页面的压缩 HTML 被拆成多段以降低单次请求长度。
你必须只输出**一个 JSON 对象**（不要 markdown 代码围栏），且根对象**只能**包含这三个键（都必须出现）：
- \`elements\`：数组（本 HTML 片段内**新增**的可交互节点，PageDSL 的 element 条目形状与主规范一致）。
- \`forms\`：数组（本片段内**新增**的表单摘要）。
- \`landmarks\`：对象（本片段内**新增或更新**的地标选择器；无则 \`{}\`）。

不要输出 \`url\`、\`title\`。

## id 去重
用户会给出**已占用的 element id 与 form id** 列表。你为本片段生成的 \`id\` **不得**与任一已有 id 重复；若某节点难以命名，使用 \`chunk-{片段序号}-{简短描述}\` 形式保证唯一。

## 条目形状（与主 PageDSL 一致）
- element: \`id\`, \`type\`（button|input|form|link|modal|other）, \`selector\`，及可选 \`testId\`, \`text\`, \`role\`, \`children\`。
- form: \`id\`, \`selector\`, \`fields[]\`（name, selector, type）, \`submitButton\`。

只输出合法 JSON，不要尾随逗号。`

/** 用 XML 风格标记包裹当前片段，便于模型识别边界与序号 */
export function wrapCompressedHtmlWithChunkMarkers(
  chunkBody: string,
  indexOneBased: number,
  total: number,
  totalCompressedChars: number,
  charStart: number,
  charEnd: number,
): string {
  return [
    `<PARSE_HTML_CHUNK index="${indexOneBased}" total="${total}" totalChars="${totalCompressedChars}" charStart="${charStart}" charEnd="${charEnd}">`,
    chunkBody,
    `</PARSE_HTML_CHUNK>`,
  ].join('\n')
}

export function buildParseHtmlUserMessage(compressedHtml: string, pageUrl: string, opts?: { stepIndex?: number; stepTitle?: string }): string {
  const url = pageUrl.trim() || '(unknown)'
  const stepNote =
    opts?.stepIndex != null && opts.stepIndex > 0
      ? `\n**解析上下文**：本 DSL 对应测试流水线第 ${opts.stepIndex + 1} 步${opts.stepTitle ? `（${opts.stepTitle}）` : ''}；HTML 来自**前序 test 片段执行后** CDP 刷新，可能含已展开的弹框/下拉/抽屉，请重点提取弹层容器与选项节点。\n`
      : ''
  return [
    `页面 URL：${url}`,
    stepNote,
    '',
    '以下为压缩后的 HTML，请提取并输出 PageDSL JSON：',
    '',
    compressedHtml,
  ].join('\n')
}

export function buildParseHtmlMultiFirstUserMessage(pageUrl: string, wrappedChunk: string): string {
  const url = pageUrl.trim() || '(unknown)'
  return [
    `页面 URL：${url}`,
    '',
    '以下为**分段压缩 HTML 的第 1 段**（见 PARSE_HTML_CHUNK 标记）。请输出完整 PageDSL JSON：',
    '',
    wrappedChunk,
  ].join('\n')
}

export function buildParseHtmlContinuationUserMessage(
  pageUrl: string,
  chunkIndexOneBased: number,
  totalChunks: number,
  wrappedChunk: string,
  existingIdsJson: string,
): string {
  const url = pageUrl.trim() || '(unknown)'
  return [
    `页面 URL：${url}`,
    `当前片段：第 ${chunkIndexOneBased} / ${totalChunks} 段（仅处理标记内 HTML）。`,
    '',
    '## 已占用的 id（禁止重复）',
    existingIdsJson,
    '',
    '## 本段 HTML',
    wrappedChunk,
    '',
    '请只输出包含 `elements`、`forms`、`landmarks` 的 JSON 对象。',
  ].join('\n')
}
