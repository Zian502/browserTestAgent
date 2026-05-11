import { existsSync } from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'

/**
 * 从当前文件目录向上查找 `.env`（覆盖 `dist/`、`src/`、monorepo 根等常见位置）。
 * 在 `main.ts` 中作为**第一个** side-effect import，保证后续模块能读到 `process.env`。
 */
function loadEnv(): void {
  let dir = __dirname
  for (let i = 0; i < 8; i++) {
    const file = path.join(dir, '.env')
    if (existsSync(file)) {
      config({ path: file })
      return
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  config()
}

loadEnv()
