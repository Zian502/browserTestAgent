import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'

export default defineConfig({
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
    port: Number(process.env.VITE_DEV_PORT ?? 5175),
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
})
