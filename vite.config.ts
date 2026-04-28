import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // 生产构建自动移除 console/debugger
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      // 禁止 Vite 访问 Rust 构建产物目录
      deny: ['src-tauri/target'],
    },
  },
  optimizeDeps: {
    // 排除 src-tauri 目录，避免 Vite 扫描 cargo doc 生成的 HTML 文件
    exclude: ['src-tauri'],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/monaco-editor')) return 'monaco'
          if (id.includes('node_modules/@xterm/')) return 'xterm'
          if (id.includes('node_modules/vue')
            || id.includes('node_modules/vue-router')
            || id.includes('node_modules/pinia')
            || id.includes('node_modules/vue-i18n')) {
            return 'vue-vendor'
          }
          if (id.includes('node_modules/shiki')) return 'shiki'
          if (id.includes('node_modules/diff')) return 'diff'
          return undefined
        },
      },
    },
  },
})
