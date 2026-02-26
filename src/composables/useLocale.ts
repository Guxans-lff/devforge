import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Locale } from '@/locales'

const STORAGE_KEY = 'devforge-locale'

export function useLocale() {
  const { locale } = useI18n()

  const currentLocale = computed({
    get: () => locale.value as Locale,
    set: (val: Locale) => {
      locale.value = val
    },
  })

  function setLocale(newLocale: Locale) {
    locale.value = newLocale
    localStorage.setItem(STORAGE_KEY, newLocale)
    document.documentElement.lang = newLocale === 'zh-CN' ? 'zh' : 'en'
  }

  function toggleLocale() {
    const next: Locale = currentLocale.value === 'zh-CN' ? 'en' : 'zh-CN'
    setLocale(next)
  }

  return { currentLocale, setLocale, toggleLocale }
}
