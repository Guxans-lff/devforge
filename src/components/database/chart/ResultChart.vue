<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import type { ChartConfig } from '@/components/database/chart/ChartConfigPanel.vue'

/** 注册 ECharts 渲染器和图表组件（按需加载） */
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from 'echarts/components'

use([
  CanvasRenderer,
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
])

/** 懒加载 vue-echarts 避免首次加载开销 */
const VChart = defineAsyncComponent(() => import('vue-echarts'))

const props = defineProps<{
  /** 行数据 */
  rows: unknown[][]
  /** 列名列表 */
  columnNames: string[]
  /** 图表配置 */
  config: ChartConfig | null
}>()

/** ECharts option */
const chartOption = computed(() => {
  if (!props.config || !props.rows.length || !props.columnNames.length) return null

  const { chartType, xColumn, yColumns, aggregation } = props.config
  if (!xColumn || yColumns.length === 0) return null

  const xIdx = props.columnNames.indexOf(xColumn)
  const yIdxList = yColumns.map(y => props.columnNames.indexOf(y)).filter(i => i >= 0)
  if (xIdx < 0 || yIdxList.length === 0) return null

  // 提取数据
  const xValues = props.rows.map(r => r[xIdx] === null ? 'NULL' : String(r[xIdx]))

  if (aggregation === 'none') {
    return buildDirectOption(chartType, xValues, yIdxList, yColumns)
  }

  return buildAggregatedOption(chartType, xValues, yIdxList, yColumns, aggregation)
})

/** 无聚合直接绘制 */
function buildDirectOption(
  chartType: ChartConfig['chartType'],
  xValues: string[],
  yIdxList: number[],
  yColumnNames: string[],
) {
  if (chartType === 'pie') {
    // 饼图取第一个 Y 列
    const yIdx = yIdxList[0] ?? 0
    const dataMap = new Map<string, number>()
    for (let i = 0; i < props.rows.length; i++) {
      const key = xValues[i] ?? ''
      const row = props.rows[i]
      const val = row ? toNumber(row[yIdx]) : 0
      dataMap.set(key, (dataMap.get(key) ?? 0) + val)
    }
    return {
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie',
        radius: ['30%', '70%'],
        data: Array.from(dataMap.entries()).map(([name, value]) => ({ name, value })),
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } },
      }],
    }
  }

  // 柱状图/折线图/散点图
  const series = yIdxList.map((yIdx, i) => ({
    name: yColumnNames[i],
    type: chartType === 'scatter' ? 'scatter' : chartType,
    data: props.rows.map(r => toNumber(r[yIdx])),
    smooth: chartType === 'line',
  }))

  return {
    tooltip: { trigger: 'axis' },
    legend: yColumnNames.length > 1 ? { data: yColumnNames } : undefined,
    xAxis: { type: 'category' as const, data: xValues, axisLabel: { rotate: xValues.length > 20 ? 45 : 0 } },
    yAxis: { type: 'value' as const },
    series,
    grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
  }
}

/** 有聚合的绘制 */
function buildAggregatedOption(
  chartType: ChartConfig['chartType'],
  xValues: string[],
  yIdxList: number[],
  yColumnNames: string[],
  aggregation: 'count' | 'sum' | 'avg',
) {
  // 按 X 值分组
  const groups = new Map<string, unknown[][]>()
  for (let i = 0; i < props.rows.length; i++) {
    const key = xValues[i] ?? ''
    const row = props.rows[i]
    if (!row) continue
    const arr = groups.get(key) ?? []
    arr.push(row)
    groups.set(key, arr)
  }

  const categories = Array.from(groups.keys())

  if (chartType === 'pie') {
    const yIdx = yIdxList[0] ?? 0
    const data = categories.map(cat => {
      const catRows = groups.get(cat) ?? []
      let value: number
      if (aggregation === 'count') {
        value = catRows.length
      } else if (aggregation === 'sum') {
        value = catRows.reduce((s, r) => s + toNumber(r[yIdx]), 0)
      } else {
        const sum = catRows.reduce((s, r) => s + toNumber(r[yIdx]), 0)
        value = catRows.length > 0 ? sum / catRows.length : 0
      }
      return { name: cat, value: Math.round(value * 100) / 100 }
    })
    return {
      tooltip: { trigger: 'item' },
      series: [{ type: 'pie', radius: ['30%', '70%'], data }],
    }
  }

  const series = yIdxList.map((yIdx, i) => ({
    name: yColumnNames[i] ?? '',
    type: chartType === 'scatter' ? 'scatter' : chartType,
    data: categories.map(cat => {
      const catRows = groups.get(cat) ?? []
      if (aggregation === 'count') return catRows.length
      if (aggregation === 'sum') return Math.round(catRows.reduce((s, r) => s + toNumber(r[yIdx]), 0) * 100) / 100
      const sum = catRows.reduce((s, r) => s + toNumber(r[yIdx]), 0)
      return catRows.length > 0 ? Math.round((sum / catRows.length) * 100) / 100 : 0
    }),
    smooth: chartType === 'line',
  }))

  return {
    tooltip: { trigger: 'axis' },
    legend: yColumnNames.length > 1 ? { data: yColumnNames } : undefined,
    xAxis: { type: 'category' as const, data: categories, axisLabel: { rotate: categories.length > 20 ? 45 : 0 } },
    yAxis: { type: 'value' as const },
    series,
    grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
  }
}

function toNumber(val: unknown): number {
  if (typeof val === 'number') return val
  const n = Number(val)
  return isNaN(n) ? 0 : n
}
</script>

<template>
  <div class="flex h-full w-full items-center justify-center">
    <template v-if="chartOption">
      <VChart
        :option="chartOption"
        autoresize
        class="h-full w-full"
      />
    </template>
    <template v-else>
      <div class="text-xs text-muted-foreground/50">
        请在左侧配置 X/Y 轴列生成图表
      </div>
    </template>
  </div>
</template>
