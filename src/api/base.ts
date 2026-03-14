import { invoke } from '@tauri-apps/api/core'
import { useLogStore, type LogSource } from '@/stores/log'
import { useSettingsStore } from '@/stores/settings'
import { parseBackendError } from '@/types/error'

/**
 * 统一的 Tauri invoke 封装
 *
 * - 失败时自动记录日志（error 级别）
 * - 自动解析后端错误为结构化 BackendError
 * - 抛出 BackendError 而非原始字符串
 * - 开发者模式下记录所有请求和响应
 *
 * @param command Tauri 命令名
 * @param args 命令参数
 * @param options.source 日志来源分类（默认 'SYSTEM'）
 * @param options.silent 为 true 时不自动记录错误日志
 */
export async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
  options?: { source?: LogSource; silent?: boolean },
): Promise<T> {
  const settingsStore = useSettingsStore()
  const isDevMode = settingsStore.settings.devMode
  const startTime = isDevMode ? performance.now() : 0

  // 开发者模式：记录请求
  if (isDevMode) {
    const logStore = useLogStore()
    logStore.debug(options?.source ?? 'SYSTEM', `→ ${command}`, {
      type: 'api-request',
      command,
      args: sanitizeArgs(args),
    })
  }

  try {
    const result = await invoke<T>(command, args)

    // 开发者模式：记录成功响应
    if (isDevMode) {
      const duration = Math.round(performance.now() - startTime)
      const logStore = useLogStore()
      logStore.debug(options?.source ?? 'SYSTEM', `← ${command} [${duration}ms] OK`, {
        type: 'api-response',
        command,
        duration,
        resultPreview: summarizeResult(result),
      })
    }

    return result
  } catch (err) {
    const parsed = parseBackendError(err)

    // 开发者模式：记录失败响应（即使 silent=true 也记录）
    if (isDevMode) {
      const duration = Math.round(performance.now() - startTime)
      const logStore = useLogStore()
      logStore.error(options?.source ?? 'SYSTEM', `← ${command} [${duration}ms] FAIL`, {
        type: 'api-error',
        command,
        args: sanitizeArgs(args),
        duration,
        error: parsed.message,
      })
    } else if (!options?.silent) {
      // 非开发者模式：仅在非静默时记录错误
      const logStore = useLogStore()
      logStore.error(options?.source ?? 'SYSTEM', parsed.message, {
        command,
        args,
        error: parsed,
      })
    }
    throw parsed
  }
}

/**
 * 清理敏感参数，避免在日志中泄露密码
 */
function sanitizeArgs(args?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!args) return undefined
  const sensitiveKeys = ['password', 'passphrase', 'secret', 'token', 'credential']
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
      sanitized[key] = '***'
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}

/**
 * 对结果做摘要，避免日志中存储大量数据
 */
function summarizeResult(result: unknown): string {
  if (result === null || result === undefined) return 'null'
  if (typeof result === 'string') {
    return result.length > 200 ? `string(${result.length})` : result
  }
  if (typeof result === 'number' || typeof result === 'boolean') return String(result)
  if (Array.isArray(result)) return `array(${result.length})`
  if (typeof result === 'object') {
    const keys = Object.keys(result)
    return `object{${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', ...' : ''}}`
  }
  return typeof result
}
