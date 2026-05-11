import * as fs from 'fs/promises'
import * as path from 'path'

function normalizeAbsolute(filePath: string): string {
  return path.normalize(filePath)
}

export async function agentFileMkdirp(dirPath: string): Promise<void> {
  await fs.mkdir(normalizeAbsolute(dirPath), { recursive: true })
}

export async function agentFileReadText(filePath: string): Promise<string> {
  return fs.readFile(normalizeAbsolute(filePath), 'utf-8')
}

export async function agentFileWriteText(filePath: string, content: string): Promise<void> {
  const abs = normalizeAbsolute(filePath)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf-8')
}

export async function agentFileUnlinkQuiet(filePath: string): Promise<void> {
  await fs.unlink(normalizeAbsolute(filePath)).catch(() => {})
}
