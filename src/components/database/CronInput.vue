<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Clock, CalendarDays, CalendarClock, Timer } from 'lucide-vue-next'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { t } = useI18n()

/** 常用 cron 预设 */
const presets = [
  { label: () => t('dataSync.cron.everyMinute'), value: '* * * * *', icon: Timer },
  { label: () => t('dataSync.cron.every5Minutes'), value: '*/5 * * * *', icon: Timer },
  { label: () => t('dataSync.cron.every30Minutes'), value: '*/30 * * * *', icon: Timer },
  { label: () => t('dataSync.cron.everyHour'), value: '0 * * * *', icon: Clock },
  { label: () => t('dataSync.cron.everyDay'), value: '0 2 * * *', icon: CalendarDays },
  { label: () => t('dataSync.cron.everyWeek'), value: '0 2 * * 1', icon: CalendarClock },
  { label: () => t('dataSync.cron.everyMonth'), value: '0 2 1 * *', icon: CalendarClock },
]

/** 解析 cron 表达式生成人类可读描述 */
const humanReadable = computed(() => {
  const expr = props.modelValue.trim()
  if (!expr) return ''

  const parts = expr.split(/\s+/)
  if (parts.length !== 5) return t('dataSync.cron.invalidExpr')

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  // 精确匹配预设
  for (const preset of presets) {
    if (preset.value === expr) return preset.label()
  }

  // 简易解析常见模式
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return t('dataSync.cron.everyMinute')
  }

  if (minute?.startsWith('*/') && hour === '*') {
    const interval = minute.slice(2)
    return t('dataSync.cron.everyNMinutes', { n: interval })
  }

  if (minute !== '*' && hour === '*' && dayOfMonth === '*') {
    return t('dataSync.cron.everyHourAtMinute', { m: minute })
  }

  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return t('dataSync.cron.dailyAt', { h: hour, m: minute })
  }

  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const dayNames: Record<string, string> = {
      '0': t('dataSync.cron.sunday'),
      '1': t('dataSync.cron.monday'),
      '2': t('dataSync.cron.tuesday'),
      '3': t('dataSync.cron.wednesday'),
      '4': t('dataSync.cron.thursday'),
      '5': t('dataSync.cron.friday'),
      '6': t('dataSync.cron.saturday'),
      '7': t('dataSync.cron.sunday'),
    }
    const dayName = dayNames[dayOfWeek!] ?? dayOfWeek
    return t('dataSync.cron.weeklyAt', { day: dayName, h: hour, m: minute })
  }

  if (minute !== '*' && hour !== '*' && dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    return t('dataSync.cron.monthlyAt', { d: dayOfMonth, h: hour, m: minute })
  }

  return `${t('dataSync.cron.custom')}: ${expr}`
})

function handleInput(e: Event) {
  const target = e.target as HTMLInputElement
  emit('update:modelValue', target.value)
}

function selectPreset(value: string) {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="space-y-2">
    <!-- 输入框 -->
    <div class="flex items-center gap-2">
      <input
        :value="modelValue"
        type="text"
        class="flex-1 h-8 rounded-md border border-input bg-background px-3 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="* * * * * (分 时 日 月 周)"
        @input="handleInput"
      />
    </div>

    <!-- 人类可读描述 -->
    <div v-if="humanReadable" class="text-xs text-muted-foreground px-1">
      {{ humanReadable }}
    </div>

    <!-- 预设按钮 -->
    <div class="flex flex-wrap gap-1">
      <Button
        v-for="preset in presets"
        :key="preset.value"
        size="sm"
        :variant="modelValue === preset.value ? 'default' : 'outline'"
        class="h-6 text-[10px] px-2 gap-1"
        @click="selectPreset(preset.value)"
      >
        <component :is="preset.icon" class="h-3 w-3" />
        {{ preset.label() }}
      </Button>
    </div>
  </div>
</template>
