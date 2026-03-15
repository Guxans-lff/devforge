<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { BarChart3, LineChart, PieChart, ScatterChart } from 'lucide-vue-next'
import type { ColumnDef } from '@/types/database'

const props = defineProps<{
  /** 可用的列定义 */
  columns: ColumnDef[]
  /** 当前选中的配置 */
  config?: ChartConfig | null
}>()

const emit = defineEmits<{
  configChange: [config: ChartConfig]
}>()

export interface ChartConfig {
  /** 图表类型 */
  chartType: 'bar' | 'line' | 'pie' | 'scatter'
  /** X 轴列名 */
  xColumn: string
  /** Y 轴列名（可多个） */
  yColumns: string[]
  /** 聚合方式 */
  aggregation: 'none' | 'count' | 'sum' | 'avg'
}

const chartType = ref<ChartConfig['chartType']>('bar')
const xColumn = ref('')
const yColumns = ref<string[]>([])
const aggregation = ref<ChartConfig['aggregation']>('none')

/** 数值列（用于 Y 轴推荐） */
const numericColumns = computed(() =>
  props.columns.filter(c => {
    const t = (c.dataType ?? '').toLowerCase()
    return /int|float|double|decimal|numeric|real|number|money|serial|bigint|smallint|tinyint/i.test(t)
  }),
)

/** 非数值列（用于 X 轴推荐） */
const categoricalColumns = computed(() =>
  props.columns.filter(c => {
    const t = (c.dataType ?? '').toLowerCase()
    return !/int|float|double|decimal|numeric|real|number|money|serial|bigint|smallint|tinyint/i.test(t)
  }),
)

// 如果有传入初始配置，则同步到内部状态
watch(() => props.config, (newConfig) => {
  if (newConfig) {
    chartType.value = newConfig.chartType
    xColumn.value = newConfig.xColumn
    yColumns.value = [...newConfig.yColumns]
    aggregation.value = newConfig.aggregation
  }
}, { immediate: true })

// 自动推荐逻辑
watch(() => props.columns, (cols) => {
  // 只有在完全没有配置记录的情况下才执行自动推荐
  if (cols.length > 0 && !xColumn.value && !props.config) {
    // X 轴选第一个非数值列，没有则选第一列
    xColumn.value = categoricalColumns.value[0]?.name ?? cols[0]?.name ?? ''
    // Y 轴选第一个数值列
    if (numericColumns.value.length > 0) {
      yColumns.value = [numericColumns.value[0]?.name ?? '']
    } else if (cols.length > 1) {
      yColumns.value = [cols[1]?.name ?? '']
    }
    emitConfig()
  }
}, { immediate: true })

function toggleYColumn(colName: string) {
  const idx = yColumns.value.indexOf(colName)
  if (idx >= 0) {
    yColumns.value = yColumns.value.filter((_, i) => i !== idx)
  } else {
    yColumns.value = [...yColumns.value, colName]
  }
  emitConfig()
}

function emitConfig() {
  emit('configChange', {
    chartType: chartType.value,
    xColumn: xColumn.value,
    yColumns: yColumns.value,
    aggregation: aggregation.value,
  })
}

watch([chartType, xColumn, aggregation], () => emitConfig())

const chartTypes = [
  { type: 'bar' as const, icon: BarChart3, label: '柱状图' },
  { type: 'line' as const, icon: LineChart, label: '折线图' },
  { type: 'pie' as const, icon: PieChart, label: '饼图' },
  { type: 'scatter' as const, icon: ScatterChart, label: '散点图' },
]
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto thin-scrollbar p-5 space-y-6 bg-background">
    <!-- 图表类型 -->
    <div class="space-y-3">
      <p class="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.1em]">图表展示类型</p>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="ct in chartTypes"
          :key="ct.type"
          class="flex flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-3 text-[11px] transition-all duration-200"
          :class="chartType === ct.type
            ? 'border-primary bg-primary/5 text-primary shadow-sm ring-1 ring-primary/20'
            : 'border-border/50 text-muted-foreground hover:bg-muted/50 hover:border-border'"
          @click="chartType = ct.type"
        >
          <component :is="ct.icon" class="h-4 w-4" />
          {{ ct.label }}
        </button>
      </div>
    </div>

    <!-- X 轴 -->
    <div class="space-y-3">
      <p class="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.1em]">X 轴 / 维度</p>
      <select
        :value="xColumn"
        class="w-full h-9 rounded-md border border-border bg-muted/20 px-3 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all cursor-pointer"
        @change="xColumn = ($event.target as HTMLSelectElement).value"
      >
        <option v-for="col in columns" :key="col.name" :value="col.name">
          {{ col.name }}
        </option>
      </select>
    </div>

    <!-- Y 轴 -->
    <div class="space-y-3">
      <p class="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.1em]">Y 轴 / 指标</p>
      <div class="space-y-1 max-h-40 overflow-y-auto thin-scrollbar border border-border/50 rounded-md p-1.5 bg-muted/10">
        <label
          v-for="col in columns"
          :key="col.name"
          class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] cursor-pointer hover:bg-muted/50 transition-colors group"
          :class="{ 'bg-primary/10 text-primary': yColumns.includes(col.name) }"
        >
          <input
            type="checkbox"
            :checked="yColumns.includes(col.name)"
            class="h-3.5 w-3.5 rounded border-border accent-primary"
            @change="toggleYColumn(col.name)"
          />
          <span class="truncate">{{ col.name }}</span>
          <span class="ml-auto text-[9px] text-muted-foreground/40 font-mono group-hover:text-muted-foreground/60">{{ col.dataType }}</span>
        </label>
      </div>
    </div>

    <!-- 聚合方式 -->
    <div class="space-y-3 pb-4">
      <p class="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.1em]">数据聚合方式</p>
      <select
        :value="aggregation"
        class="w-full h-9 rounded-md border border-border bg-muted/20 px-3 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all cursor-pointer"
        @change="aggregation = ($event.target as HTMLSelectElement).value as ChartConfig['aggregation']"
      >
        <option value="none">原始数据 (不聚合)</option>
        <option value="count">计数 (COUNT)</option>
        <option value="sum">求和 (SUM)</option>
        <option value="avg">平均值 (AVG)</option>
      </select>
    </div>
  </div>
</template>
