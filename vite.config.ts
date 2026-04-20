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
        manualChunks: {
          'monaco': ['monaco-editor'],
          'xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
          'vue-vendor': ['vue', 'vue-router', 'pinia', 'vue-i18n'],
          'shiki': ['shiki'],
          'diff': ['diff'],
        },
      },
    },
  },
})
