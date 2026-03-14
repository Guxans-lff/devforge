import { invoke } from '@tauri-apps/api/core'
import { useLogStore, type LogSource } from '@/stores/log'
import { parseBackendError } from '@/types/error'

/**
 * 统一的 Tauri invoke 封装
 *
 * - 失败时自动记录日志（error 级别）
 * - 自动解析后端错误为结构化 BackendError
 * - 抛出 BackendError 而非原始字符串
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
  try {
    return await invoke<T>(command, args)
  } catch (err) {
    const parsed = parseBackendError(err)
    if (!options?.silent) {
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
