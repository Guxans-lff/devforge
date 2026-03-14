<script setup lang="ts">
import { computed } from 'vue'
import { ExternalLink, Copy } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  /** URL 字符串 */
  value: string
}>()

const { t } = useI18n()
const toast = useToast()

/** 解析 URL */
const urlParts = computed(() => {
  try {
    const u = new URL(props.value)
    const params = Array.from(u.searchParams.entries())
    return {
      valid: true,
      protocol: u.protocol,
      host: u.host,
      pathname: u.pathname,
      search: u.search,
      hash: u.hash,
      params,
    }
  } catch {
    return { valid: false, protocol: '', host: '', pathname: '', search: '', hash: '', params: [] }
  }
})

/** 在外部浏览器打开链接 */
function openUrl() {
  window.open(props.value, '_blank')
}

function copyUrl() {
  navigator.clipboard.writeText(props.value).then(() => {
    toast.success(t('toast.copySuccess'))
  }).catch(() => {})
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex-1 overflow-auto p-3 space-y-3">
      <!-- 完整 URL -->
      <div>
        <p class="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider mb-1">URL</p>
        <div class="flex items-center gap-2">
          <a
            class="text-sm font-mono text-primary hover:underline cursor-pointer break-all select-text"
            @click="openUrl"
          >
            {{ value }}
          </a>
          <button class="shrink-0 p-1 rounded-sm hover:bg-muted/50" @click="openUrl">
            <ExternalLink class="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button class="shrink-0 p-1 rounded-sm hover:bg-muted/50" @click="copyUrl">
            <Copy class="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      <!-- URL 分解 -->
      <template v-if="urlParts.valid">
        <div>
          <p class="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider mb-2">URL 分解</p>
          <div class="space-y-1.5 text-xs">
            <div class="flex items-baseline gap-3">
              <span class="w-16 shrink-0 text-muted-foreground font-medium">协议</span>
              <span class="font-mono text-blue-600 dark:text-blue-400">{{ urlParts.protocol }}</span>
            </div>
            <div class="flex items-baseline gap-3">
              <span class="w-16 shrink-0 text-muted-foreground font-medium">主机</span>
              <span class="font-mono select-text">{{ urlParts.host }}</span>
            </div>
            <div v-if="urlParts.pathname !== '/'" class="flex items-baseline gap-3">
              <span class="w-16 shrink-0 text-muted-foreground font-medium">路径</span>
              <span class="font-mono select-text break-all">{{ urlParts.pathname }}</span>
            </div>
            <div v-if="urlParts.hash" class="flex items-baseline gap-3">
              <span class="w-16 shrink-0 text-muted-foreground font-medium">哈希</span>
              <span class="font-mono select-text">{{ urlParts.hash }}</span>
            </div>
          </div>
        </div>

        <!-- 查询参数 -->
        <div v-if="urlParts.params.length > 0">
          <p class="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider mb-2">查询参数</p>
          <div class="space-y-1 text-xs">
            <div
              v-for="([key, val], i) in urlParts.params"
              :key="i"
              class="flex items-baseline gap-2 hover:bg-muted/20 rounded-sm px-1 py-0.5"
            >
              <span class="text-purple-600 dark:text-purple-400 font-mono font-medium shrink-0">{{ key }}</span>
              <span class="text-muted-foreground/50">=</span>
              <span class="font-mono text-green-600 dark:text-green-400 break-all select-text">{{ val }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
