import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copyFileSync, mkdirSync, existsSync } from 'fs'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin(),
      {
        name: 'copy-icon',
        closeBundle() {
          const outDir = resolve(__dirname, 'out/main')
          if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
          const src = resolve(__dirname, 'build/icon/512.png')
          if (existsSync(src)) {
            copyFileSync(src, resolve(outDir, 'icon.png'))
          }
        }
      }
    ]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
