/**
 * 测试辅助工具集
 * 提供通用的测试 helper 函数
 */
import { createPinia, setActivePinia } from 'pinia'

/**
 * 初始化测试用 Pinia 实例
 * 在 beforeEach 中调用，确保每个测试有独立的 store 状态
 */
export function setupTestPinia() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

/**
 * 创建模拟的 DOM 滚动容器
 * 用于测试虚拟滚动相关 composable
 */
export function createMockScrollElement() {
  let scrollTop = 0
  const listeners: Record<string, Function[]> = {}

  const el = {
    get scrollTop() { return scrollTop },
    set scrollTop(val: number) { scrollTop = val },
    clientHeight: 600,
    scrollHeight: 10000,
    get scrollLeft() { return 0 },
    set scrollLeft(_val: number) { /* noop */ },
    addEventListener(event: string, handler: Function, _opts?: any) {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(handler)
    },
    removeEventListener(event: string, handler: Function) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(h => h !== handler)
      }
    },
    /** 触发已注册的事件监听器 */
    dispatchEvent(event: string) {
      listeners[event]?.forEach(h => h())
    },
  }

  return el as unknown as HTMLDivElement
}

/**
 * 等待所有微任务完成
 * 用于等待 Promise / nextTick / watch 回调
 */
export function flushPromises(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * 创建模拟的 QueryResult 数据
 * 用于测试查询结果相关逻辑
 */
export function createMockQueryResult(opts?: {
  rows?: number
  columns?: string[]
  isError?: boolean
  error?: string
}) {
  const columnNames = opts?.columns ?? ['id', 'name', 'email']
  const rowCount = opts?.rows ?? 10

  if (opts?.isError) {
    return {
      columns: [],
      rows: [],
      isError: true,
      error: opts.error ?? '测试错误',
      affectedRows: 0,
      executionTimeMs: 0,
    }
  }

  return {
    columns: columnNames.map(name => ({ name, dataType: 'VARCHAR' })),
    rows: Array.from({ length: rowCount }, (_, i) =>
      columnNames.map((col, colIdx) => colIdx === 0 ? i + 1 : `${col}_value_${i}`),
    ),
    isError: false,
    affectedRows: 0,
    executionTimeMs: 42,
  }
}
