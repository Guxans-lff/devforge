/**
 * 统一前端日志工具
 *
 * 目标：
 * - 所有关键事件带可过滤的 tag（如 ai.stream / ai.tool / ai.budget / ai.compact）
 * - 结构化 fields，便于线上排查与后续接入远程日志
 * - 生产环境可统一抬升/降低级别，无需改调用点
 *
 * 用法：
 *   const log = createLogger('ai.stream')
 *   log.info('stream_start', { sessionId, model })
 *   log.warn('watchdog_timeout', { sessionId, ms: 30000 })
 *   log.error('send_failed', { sessionId }, err)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

/** 运行时最低输出级别（debug 模式可通过 window.__LOG_LEVEL 覆盖） */
function currentMinLevel(): number {
  const override = (globalThis as { __LOG_LEVEL?: LogLevel }).__LOG_LEVEL
  if (override && override in LEVEL_ORDER) return LEVEL_ORDER[override]
  // 开发模式默认 debug，生产默认 info
  return import.meta.env.DEV ? LEVEL_ORDER.debug : LEVEL_ORDER.info
}

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>, err?: unknown): void
  error(event: string, fields?: Record<string, unknown>, err?: unknown): void
}

function format(tag: string, event: string, fields?: Record<string, unknown>): [string, Record<string, unknown> | undefined] {
  const prefix = `[${tag}] ${event}`
  if (!fields || Object.keys(fields).length === 0) return [prefix, undefined]
  return [prefix, fields]
}

function emit(level: LogLevel, tag: string, event: string, fields?: Record<string, unknown>, err?: unknown): void {
  if (LEVEL_ORDER[level] < currentMinLevel()) return
  const [prefix, payload] = format(tag, event, fields)
  const args: unknown[] = payload ? [prefix, payload] : [prefix]
  if (err !== undefined) {
    args.push(err)
    if (err instanceof Error && err.stack) {
      args.push(err.stack)
    }
  }
  switch (level) {
    case 'debug': console.debug(...args); break
    case 'info':  console.info(...args); break
    case 'warn':  console.warn(...args); break
    case 'error': console.error(...args); break
  }
}

export function createLogger(tag: string): Logger {
  return {
    debug: (event, fields) => emit('debug', tag, event, fields),
    info:  (event, fields) => emit('info', tag, event, fields),
    warn:  (event, fields, err) => emit('warn', tag, event, fields, err),
    error: (event, fields, err) => emit('error', tag, event, fields, err),
  }
}
