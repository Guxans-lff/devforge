import { i18n } from '@/locales'
import type { Composer } from 'vue-i18n'

/**
 * 获取类型安全的 i18n Composer 实例
 *
 * vue-i18n 的 createI18n 在 legacy: false 模式下，
 * i18n.global 实际上是 Composer 类型，但 TypeScript 无法自动推断。
 * 此 helper 提供类型正确的访问方式，避免 as any。
 */
function getComposer(): Composer {
  return i18n.global as unknown as Composer
}

/**
 * 类型安全的翻译函数
 *
 * 替代 (i18n.global as any).t(key, params) 用法
 */
export function t(key: string, params?: Record<string, unknown>): string {
  const composer = getComposer()
  return params ? composer.t(key, params) : composer.t(key)
}
