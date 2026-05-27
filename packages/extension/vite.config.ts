import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'

/** monorepo 根目录 `.env`（与 server 共用） */
const repoRoot = resolve(__dirname, '../..')

function resolveAgentApiBase(env: Record<string, string>): string {
  const port = env.PORT?.trim() || '3850'
  return (
    env.VITE_AGENT_API?.trim() ||
    env.PUBLIC_BASE_URL?.trim() ||
    env.SERVER_BASE_URL?.trim() ||
    env.AUTH_CALLBACK_BASE_URL?.trim() ||
    `http://localhost:${port}`
  ).replace(/\/+$/, '')
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '')
  const agentApiBase = resolveAgentApiBase(env)

  return {
    /** 从仓库根目录加载 `.env` / `.env.local` / `.env.[mode]` */
    envDir: repoRoot,
    define: {
      'import.meta.env.VITE_AGENT_API': JSON.stringify(agentApiBase),
    },
    plugins: [
      react(),
      {
        name: 'copy-manifest',
        closeBundle() {
          const out = resolve(__dirname, 'dist')
          if (!existsSync(out)) mkdirSync(out, { recursive: true })
          copyFileSync(resolve(__dirname, 'manifest.json'), resolve(out, 'manifest.json'))
        },
      },
    ],
    server: {
      port: Number(env.VITE_DEV_PORT ?? 5175),
      strictPort: true,
      open: true,
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'popup.html'),
          background: resolve(__dirname, 'src/background/index.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
      emptyDir: true,
    },
  }
})
