/**
 * PageSpeed agent 当前仅调用 PageSpeed Insights API，无 LLM 提示词。
 * 若后续用模型解读 Lighthouse，可在此维护 system / user 模板。
 */
export const PAGESPEED_AGENT_HAS_LLM_PROMPTS = false as const
