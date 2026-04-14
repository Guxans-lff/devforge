<script setup lang="ts">
/**
 * 监控图表卡片 — 使用原生 echarts.init 替代 vue-echarts
 * 解决 vue-echarts autoresize 在滚动容器中无限循环的问题
 */
import { ref, shallowRef, watch, onMounted, onBeforeUnmount, type Component } from 'vue'
import type { ECharts } from 'echarts/core'

const props = defineProps<{
  /** 标题图标组件 */
  icon: Component
  /** 图标 CSS 类 */
  iconClass?: string
  /** 卡片标题 */
  title: string
  /** 右侧副标题 */
  subtitle?: string
  /** ECharts option 配置 */
  option: Record<string, unknown>
  /** 图表高度，默认 200px */
  height?: string
}>()

const chartEl = ref<HTMLElement>()
/** shallowRef 使 chart 实例具有响应性，watchEffect 能追踪 */
const chart = shallowRef<ECharts | null>(null)

/** 暴露 resize 方法给父组件统一调用 */
function resize() {
  chart.value?.resize()
}

defineExpose({ resize })

onMounted(async () => {
  if (!chartEl.value) return
  const { init } = await import('echarts/core')
  chart.value = init(chartEl.value)
  // 初始化完成后立即应用当前 option
  applyOption()
})

function applyOption() {
  const c = chart.value
  const opt = props.option
  if (c && opt) {
    c.setOption(opt, true)
  }
}

// 监听 option 变化，实时更新图表
// flush: 'post' 避免在 ECharts 渲染主流程中调用 setOption
watch(
  [() => chart.value, () => props.option] as const,
  () => applyOption(),
  { flush: 'post' },
)

onBeforeUnmount(() => {
  chart.value?.dispose()
  chart.value = null
})
</script>

<template>
  <div class="rounded-lg border border-border/50 bg-card/50 p-3 backdrop-blur-sm overflow-hidden">
    <div class="flex items-center gap-2 text-muted-foreground mb-2">
      <component :is="icon" class="h-3 w-3" :class="iconClass" />
      <span class="text-[11px] font-medium">{{ title }}</span>
      <span v-if="subtitle" class="ml-auto text-[10px] tabular-nums">{{ subtitle }}</span>
    </div>
    <div ref="chartEl" :style="{ height: height ?? '200px', width: '100%' }" />
  </div>
</template>
