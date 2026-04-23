import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'

export type Locale = 'zh-CN' | 'en'
type LocaleMessages = typeof zhCN

const savedLocale = localStorage.getItem('devforge-locale') as Locale | null
const defaultLocale = savedLocale ?? 'zh-CN'

// 仅加载中文语言包（默认/回退），英文按需动态加载
export const i18n = createI18n({
  legacy: false,
  locale: defaultLocale,
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
  },
})

// 已加载的语言记录
const loadedLocales = new Set<string>(['zh-CN'])

// 动态加载并切换语言
export async function loadLocale(locale: Locale) {
  if (!loadedLocales.has(locale)) {
    // Vite 动态 import 需要明确路径模式
    const mod = locale === 'en'
      ? await import('./en')
      : await import('./zh-CN')
    i18n.global.setLocaleMessage(locale, mod.default as LocaleMessages)
    loadedLocales.add(locale)
  }
  ;(i18n.global.locale as unknown as { value: string }).value = locale
  localStorage.setItem('devforge-locale', locale)
}

// 如果保存的语言不是默认的 zh-CN，异步加载并切换
if (defaultLocale !== 'zh-CN') {
  loadLocale(defaultLocale)
}
