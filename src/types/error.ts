/** 后端错误分类码，对应 Rust ErrorKind 枚举 */
export type ErrorKind =
  | 'DATABASE'
  | 'CONNECTION'
  | 'CREDENTIAL'
  | 'VALIDATION'
  | 'PERMISSION'
  | 'TIMEOUT'
  | 'IO'
  | 'SERIALIZATION'
  | 'INTERNAL'

/** 后端结构化错误 */
export interface BackendError {
  kind: ErrorKind
  message: string
  retryable: boolean
}

/**
 * 解析后端返回的错误，兼容新旧两种格式
 *
 * - 新格式：Tauri 将 Err(AppError) 序列化为 JSON 字符串 `{ kind, message, retryable }`
 * - 旧格式：纯字符串错误信息
 */
export function parseBackendError(err: unknown): BackendError {
  // 字符串：可能是 JSON（新格式）或纯文本（旧格式）
  if (typeof err === 'string') {
    try {
      const parsed = JSON.parse(err)
      if (isBackendError(parsed)) return parsed
    } catch {
      // 旧格式纯字符串
    }
    return { kind: 'INTERNAL', message: err, retryable: false }
  }

  // 对象：可能已经是结构化错误
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    if (isBackendError(e)) return e as unknown as BackendError
    
    // 尝试提取常见错误字段
    const msg = e.message || e.msg || e.error || e.err
    if (typeof msg === 'string') {
      return { kind: 'INTERNAL', message: msg, retryable: false }
    }
    
    // 可能是 JS Error 对象的字符串化产物，或者是纯对象
    return { kind: 'INTERNAL', message: JSON.stringify(err), retryable: false }
  }

  return { kind: 'INTERNAL', message: String(err), retryable: false }
}

/** 类型守卫：判断是否为 BackendError 结构 */
function isBackendError(obj: unknown): obj is BackendError {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as Record<string, unknown>
  return typeof o.kind === 'string' && typeof o.message === 'string'
}

/**
 * 确保错误信息为可展示的字符串，防止 [object Object] 展示
 * 适用于后端 API 返回的 result.error 字段（运行时可能为对象）
 */
export function ensureErrorString(err: unknown): string {
  if (err === null || err === undefined) return ''
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    if (typeof e.message === 'string') return e.message
    if (typeof e.msg === 'string') return e.msg
    if (typeof e.error === 'string') return e.error
    return JSON.stringify(err)
  }
  return String(err)
}

/** 判断错误是否可重试 */
export function isRetryable(err: unknown): boolean {
  return parseBackendError(err).retryable
}

/** 判断是否为特定类型的错误 */
export function isErrorKind(err: unknown, kind: ErrorKind): boolean {
  return parseBackendError(err).kind === kind
}
