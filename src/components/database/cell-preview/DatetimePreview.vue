<script setup lang="ts">
import { computed } from 'vue'
import { Clock, Globe } from 'lucide-vue-next'

const props = defineProps<{
  /** 日期时间字符串 */
  value: string
}>()

/** 解析日期 */
const dateObj = computed(() => {
  if (!props.value) return null
  const d = new Date(props.value)
  return isNaN(d.getTime()) ? null : d
})

/** 各时区显示 */
const timezones = computed(() => {
  if (!dateObj.value) return []
  const d = dateObj.value
  return [
    { label: '本地时间', value: d.toLocaleString('zh-CN', { dateStyle: 'full', timeStyle: 'long' }) },
    { label: 'UTC', value: d.toLocaleString('zh-CN', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'long' }) },
    { label: '美东 (ET)', value: d.toLocaleString('zh-CN', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'long' }) },
    { label: '日本 (JST)', value: d.toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo', dateStyle: 'full', timeStyle: 'long' }) },
    { label: '伦敦 (GMT)', value: d.toLocaleString('zh-CN', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'long' }) },
  ]
})

/** 相对时间描述 */
const relativeTime = computed(() => {
  if (!dateObj.value) return ''
  const now = Date.now()
  const diff = now - dateObj.value.getTime()
  const abs = Math.abs(diff)
  const suffix = diff > 0 ? '前' : '后'

  if (abs < 60_000) return `${Math.floor(abs / 1000)} 秒${suffix}`
  if (abs < 3_600_000) return `${Math.floor(abs / 60_000)} 分钟${suffix}`
  if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)} 小时${suffix}`
  if (abs < 2_592_000_000) return `${Math.floor(abs / 86_400_000)} 天${suffix}`
  if (abs < 31_536_000_000) return `${Math.floor(abs / 2_592_000_000)} 个月${suffix}`
  return `${Math.floor(abs / 31_536_000_000)} 年${suffix}`
})

/** Unix 时间戳 */
const timestamp = computed(() => dateObj.value ? Math.floor(dateObj.value.getTime() / 1000) : null)

/** ISO 格式 */
const isoString = computed(() => dateObj.value?.toISOString() ?? '')
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex-1 overflow-auto p-3 space-y-4">
      <!-- 原始值 -->
      <div>
        <p class="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider mb-1">原始值</p>
        <p class="text-sm font-mono select-text">{{ value }}</p>
      </div>

      <template v-if="dateObj">
        <!-- 相对时间 -->
        <div class="flex items-center gap-2">
          <Clock class="h-3.5 w-3.5 text-muted-foreground/50" />
          <span class="text-sm font-medium">{{ relativeTime }}</span>
        </div>

        <!-- 多时区 -->
        <div>
          <p class="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider mb-2">
            <Globe class="h-3 w-3 inline-block mr-1" />
            多时区对比
          </p>
          <div class="space-y-1.5">
            <div
              v-for="tz in timezones"
              :key="tz.label"
              class="flex items-baseline gap-3 text-xs"
            >
              <span class="w-20 shrink-0 text-muted-foreground font-medium">{{ tz.label }}</span>
              <span class="font-mono select-text">{{ tz.value }}</span>
            </div>
          </div>
        </div>

        <!-- 额外信息 -->
        <div class="space-y-1 text-xs">
          <div class="flex items-baseline gap-3">
            <span class="w-20 shrink-0 text-muted-foreground font-medium">ISO 8601</span>
            <span class="font-mono select-text text-muted-foreground/80">{{ isoString }}</span>
          </div>
          <div class="flex items-baseline gap-3">
            <span class="w-20 shrink-0 text-muted-foreground font-medium">时间戳</span>
            <span class="font-mono select-text text-muted-foreground/80">{{ timestamp }}</span>
          </div>
        </div>
      </template>

      <div v-else class="text-xs text-muted-foreground/60">无法解析为有效日期</div>
    </div>
  </div>
</template>
