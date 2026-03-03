import { setupMonacoLocale } from '@/utils/monacoLocale'

// 必须在 Monaco Editor 加载之前初始化中文语言包
setupMonacoLocale()

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import { i18n } from '@/locales'
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
  ],
})

const app = createApp(App)
app.use(pinia)
app.use(router)
app.use(i18n)
app.mount('#app')
