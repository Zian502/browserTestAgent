export interface CompressOptions {
  removeScripts?: boolean
  removeStyles?: boolean
  removeComments?: boolean
  keepAttributes?: string[]
  maxLength?: number
}

function stripTags(html: string, tag: RegExp) {
  return html.replace(tag, '')
}

export const htmlCompressor = {
  async compress(html: string, options: CompressOptions = {}): Promise<string> {
    let out = html
    if (options.removeScripts) out = stripTags(out, /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi)
    if (options.removeStyles) out = stripTags(out, /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi)
    if (options.removeComments) out = out.replace(/<!--([\s\S]*?)-->/g, '')
    const keep = new Set(options.keepAttributes ?? [])
    if (keep.size > 0) {
      out = out.replace(/\s([a-zA-Z0-9:-]+)="[^"]*"/g, (m, name: string) => (keep.has(name) ? m : ''))
    }
    const max = options.maxLength ?? 8000
    if (out.length > max) out = `${out.slice(0, max)}\n<!-- truncated -->`
    return out
  },
}
