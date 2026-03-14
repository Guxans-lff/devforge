/**
 * 全局测试 setup 文件
 * 负责 mock 环境初始化（Tauri API、浏览器 API polyfill 等）
 */
import { vi } from 'vitest'

// ===== Mock Tauri Core API =====
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// ===== Mock Tauri Dialog Plugin =====
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
  open: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  confirm: vi.fn(),
}))

// ===== Mock vue-i18n =====
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: { value: 'zh-CN' },
  }),
  createI18n: () => ({}),
}))

// ===== Mock navigator.clipboard =====
if (!globalThis.navigator) {
  (globalThis as any).navigator = {}
}
if (!globalThis.navigator.clipboard) {
  (globalThis.navigator as any).clipboard = {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  }
}

// ===== Mock matchMedia =====
if (!globalThis.matchMedia) {
  (globalThis as any).matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}
