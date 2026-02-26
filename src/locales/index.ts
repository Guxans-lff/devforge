import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import en from './en'

export type Locale = 'zh-CN' | 'en'

const savedLocale = localStorage.getItem('devforge-locale') as Locale | null

export const i18n = createI18n({
  legacy: false,
  locale: savedLocale ?? 'zh-CN',
  fallbackLocale: 'en',
  messages: {
    'zh-CN': zhCN,
    en,
  },
})
