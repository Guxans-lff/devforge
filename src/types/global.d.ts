/**
 * 全局类型扩展
 *
 * 为浏览器 API 和 Worker 环境补充缺失的类型声明，
 * 避免在业务代码中使用 as any。
 */

// Chrome 非标准 Memory API
interface PerformanceMemory {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

interface Performance {
  memory?: PerformanceMemory
}

// Monaco Editor Worker 环境配置
interface MonacoEnvironment {
  getWorker(workerId: string, label: string): Worker
}

// self 上的 MonacoEnvironment 声明
declare let self: WindowOrWorkerGlobalScope & {
  MonacoEnvironment?: MonacoEnvironment
}

// Monaco Editor 国际化所需的全局变量
// eslint-disable-next-line no-var
declare var _VSCODE_NLS_MESSAGES: string[] | undefined
// eslint-disable-next-line no-var
declare var _VSCODE_NLS_LANGUAGE: string | undefined
