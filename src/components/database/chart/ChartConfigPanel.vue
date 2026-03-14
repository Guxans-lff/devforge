<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { BarChart3, LineChart, PieChart, ScatterChart } from 'lucide-vue-next'
import type { ColumnDef } from '@/types/database'

const props = defineProps<{
  /** 可用的列定义 */
  columns: ColumnDef[]
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

// 自动设置初始值
watch(() => props.columns, (cols) => {
  if (cols.length > 0 && !xColumn.value) {
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
  <div class="flex h-full flex-col overflow-y-auto p-3 space-y-4">
    <!-- 图表类型 -->
    <div>
      <p class="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">图表类型</p>
      <div class="grid grid-cols-2 gap-1.5">
        <button
          v-for="ct in chartTypes"
          :key="ct.type"
          class="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors"
          :class="chartType === ct.type
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border/50 text-muted-foreground hover:bg-muted/50'"
          @click="chartType = ct.type"
        >
          <component :is="ct.icon" class="h-3.5 w-3.5" />
          {{ ct.label }}
        </button>
      </div>
    </div>

    <!-- X 轴 -->
    <div>
      <p class="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">X 轴 / 分类</p>
      <select
        :value="xColumn"
        class="w-full h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary"
        @change="xColumn = ($event.target as HTMLSelectElement).value"
      >
        <option v-for="col in columns" :key="col.name" :value="col.name">
          {{ col.name }}
        </option>
      </select>
    </div>

    <!-- Y 轴 -->
    <div>
      <p class="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">Y 轴 / 数值</p>
      <div class="space-y-1 max-h-40 overflow-y-auto">
        <label
          v-for="col in columns"
          :key="col.name"
          class="flex items-center gap-2 rounded-sm px-2 py-1 text-xs cursor-pointer hover:bg-muted/30"
          :class="{ 'bg-primary/10': yColumns.includes(col.name) }"
        >
          <input
            type="checkbox"
            :checked="yColumns.includes(col.name)"
            class="h-3 w-3 rounded border-border accent-primary"
            @change="toggleYColumn(col.name)"
          />
          <span class="truncate">{{ col.name }}</span>
          <span class="ml-auto text-[9px] text-muted-foreground/50 font-mono">{{ col.dataType }}</span>
        </label>
      </div>
    </div>

    <!-- 聚合方式 -->
    <div>
      <p class="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">聚合</p>
      <select
        :value="aggregation"
        class="w-full h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary"
        @change="aggregation = ($event.target as HTMLSelectElement).value as ChartConfig['aggregation']"
      >
        <option value="none">无聚合</option>
        <option value="count">计数 (COUNT)</option>
        <option value="sum">求和 (SUM)</option>
        <option value="avg">平均值 (AVG)</option>
      </select>
    </div>
  </div>
</template>
