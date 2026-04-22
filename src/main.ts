import { setupMonacoLocale } from '@/utils/monacoLocale'
import { setupMonacoEnvironment } from '@/utils/monacoSetup'

// 调试：输出当前窗口 URL
if (import.meta.env.DEV) console.log('[main.ts] window.location:', window.location.href)

// 必须在 Monaco Editor 加载之前初始化中文语言包
setupMonacoLocale()
setupMonacoEnvironment()

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import { i18n } from '@/locales'
import { setupGlobalErrorHandler } from '@/composables/useGlobalErrorHandler'
import './assets/index.css'
import './styles/transitions.css'
import App from './App.vue'

const pinia = createPinia()

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'main',
      component: () => import('@/views/MainLayout.vue'),
    },
    {
      path: '/pin',
      name: 'pin',
      component: () => import('@/components/screenshot/PinWindow.vue'),
    },
    {
      path: '/region-select',
      name: 'region-select',
      component: () => import('@/views/RegionSelectWindow.vue'),
    },
    {
      path: '/ai-standalone',
      name: 'ai-standalone',
      component: () => import('@/views/AiStandaloneView.vue'),
    },
  ],
})

const app = createApp(App)
app.use(pinia)
app.use(router)
app.use(i18n)
setupGlobalErrorHandler(app)
app.mount('#app')
