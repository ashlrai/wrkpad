import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const configDirectory = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    react(),
    {
      name: 'ashlr-renderer-csp',
      transformIndexHtml(html) {
        const connectSource = command === 'serve'
          ? "'self' http://127.0.0.1:5173 ws://127.0.0.1:5173"
          : "'none'"
        return html.replace('__ASHLR_CONNECT_SRC__', connectSource)
      },
    },
  ],
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(configDirectory, 'index.html'),
        compact: resolve(configDirectory, 'compact.html'),
      },
    },
  },
}))
