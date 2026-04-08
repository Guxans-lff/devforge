import type { App } from 'vue'
import { writeErrorLog } from '@/api/diagnostics'

/**
 * 隐私过滤：移除 SQL 内容、密码、连接字符串等敏感信息
 *
 * @param text 原始错误文本
 * @returns 过滤后的安全文本
 */
function sanitizeErrorMessage(text: string): string {
  let result = text

  // 移除 SQL 语句内容（保留 SQL 关键字提示但移除具体数据）
  result = result.replace(
    /(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\s+[\s\S]{0,500}?(?:;|$)/gi,
    '[SQL 语句已过滤]',
  )

  // 移除密码相关字段
  result = result.replace(/password\s*[:=]\s*\S+/gi, 'password=***')
  result = result.replace(/passphrase\s*[:=]\s*\S+/gi, 'passphrase=***')
  result = result.replace(/secret\s*[:=]\s*\S+/gi, 'secret=***')
  result = result.replace(/token\s*[:=]\s*\S+/gi, 'token=***')

  // 移除连接字符串中的凭据
  result = result.replace(/:\/\/\w+:\S+@/g, '://***:***@')

  // 移除 API Key
  result = result.replace(/(?:api[_-]?key|apikey)\s*[:=]\s*\S+/gi, 'api_key=***')

  return result
}

/**
 * 格式化错误为日志字符串
 *
 * @param source 错误来源（vue-error / js-error / unhandled-rejection）
 * @param error 错误对象
 * @param extra 附加上下文信息
 * @returns 格式化后的日志行
 */
function formatErrorLog(source: string, error: unknown, extra?: string): string {
  const timestamp = new Date().toISOString()
  let message: string

  if (error instanceof Error) {
    message = `${error.name}: ${error.message}`
    if (error.stack) {
      // 只保留前 5 行堆栈
      const stackLines = error.stack.split('\n').slice(0, 6).join('\n')
      message += `\n${stackLines}`
    }
  } else if (typeof error === 'string') {
    message = error
  } else {
    try {
      message = JSON.stringify(error)
    } catch {
      message = String(error)
    }
  }

  const safeMessage = sanitizeErrorMessage(message)
  const extraInfo = extra ? ` | ${extra}` : ''

  return `[${timestamp}] [${source}]${extraInfo}\n${safeMessage}\n`
}

/**
 * 将错误写入本地日志文件（静默失败，不会因日志写入失败而影响用户）
 */
async function persistError(source: string, error: unknown, extra?: string): Promise<void> {
  try {
    const logContent = formatErrorLog(source, error, extra)
    await writeErrorLog(logContent)
  } catch {
    // 日志写入失败时不再抛错，避免死循环
    console.warn('[GlobalErrorHandler] 错误日志写入失败')
  }
}

/**
 * 设置全局错误捕获
 *
 * 捕获三类错误：
 * 1. Vue 组件错误（app.config.errorHandler）
 * 2. 全局 JS 错误（window.error）
 * 3. 未处理的 Promise rejection（window.unhandledrejection）
 *
 * 所有错误经隐私过滤后写入本地日志文件。
 *
 * @param app Vue 应用实例
 */
/** 全局监听器清理函数（由 cleanupGlobalErrorHandler 调用） */
let _cleanup: (() => void) | null = null

/**
 * 设置全局错误捕获
 *
 * 捕获三类错误：
 * 1. Vue 组件错误（app.config.errorHandler）
 * 2. 全局 JS 错误（window.error）
 * 3. 未处理的 Promise rejection（window.unhandledrejection）
 *
 * 所有错误经隐私过滤后写入本地日志文件。
 *
 * @param app Vue 应用实例
 */
export function setupGlobalErrorHandler(app: App): void {
  // 1. Vue 组件错误
  app.config.errorHandler = (err, instance, info) => {
    console.error('[Vue Error]', err)

    const componentName = instance?.$options?.name || instance?.$options?.__name || '未知组件'
    persistError('vue-error', err, `组件: ${componentName} | 钩子: ${info}`)
  }

  // 2. 全局 JS 错误
  const onError = (event: ErrorEvent) => {
    // 忽略资源加载错误（图片、脚本等），只处理 JS 运行时错误
    if (event.target && (event.target as HTMLElement).tagName) {
      return
    }

    console.error('[JS Error]', event.error || event.message)
    persistError(
      'js-error',
      event.error || event.message,
      `文件: ${event.filename || '未知'} | 行: ${event.lineno}:${event.colno}`,
    )
  }

  // 3. 未处理的 Promise rejection
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    console.error('[Unhandled Rejection]', event.reason)
    persistError('unhandled-rejection', event.reason)
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  _cleanup = () => {
    app.config.errorHandler = null
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
    _cleanup = null
  }
}

/**
 * 清理全局错误捕获（应用销毁时调用）
 */
export function cleanupGlobalErrorHandler(): void {
  _cleanup?.()
}
