import { parseBackendError, type BackendError, type ErrorKind } from '@/types/error'
import { useToast } from '@/composables/useToast'

/** 错误分类对应的默认标题（中文） */
const DEFAULT_TITLES: Record<ErrorKind, string> = {
  DATABASE: '数据库错误',
  CONNECTION: '连接错误',
  CREDENTIAL: '凭据错误',
  VALIDATION: '输入验证失败',
  PERMISSION: '权限不足',
  TIMEOUT: '操作超时',
  IO: 'IO 错误',
  SERIALIZATION: '数据格式错误',
  INTERNAL: '内部错误',
}

/**
 * 统一错误处理 composable
 *
 * 提供 handleError 和 safeExecute 两种方式：
 * - handleError：解析错误并弹出 toast，返回结构化错误
 * - safeExecute：包装 async 操作，捕获异常并自动处理
 */
export function useErrorHandler() {
  const toast = useToast()

  /**
   * 统一处理错误并展示 toast
   *
   * @param err 原始错误（字符串、BackendError 或 Error 对象）
   * @param context 可选的上下文标题（覆盖默认的分类标题）
   */
  function handleError(err: unknown, context?: string): BackendError {
    const parsed = parseBackendError(err)
    const title = context ?? DEFAULT_TITLES[parsed.kind]
    toast.error(title, parsed.message)
    return parsed
  }

  /**
   * 安全执行异步操作，不抛出异常
   *
   * @param fn 要执行的异步函数
   * @param context 可选的错误上下文标题
   * @returns { data, error } 二选一有值
   */
  async function safeExecute<T>(
    fn: () => Promise<T>,
    context?: string,
  ): Promise<{ data: T | null; error: BackendError | null }> {
    try {
      const data = await fn()
      return { data, error: null }
    } catch (err) {
      const error = handleError(err, context)
      return { data: null, error }
    }
  }

  return { handleError, safeExecute, parseBackendError }
}
