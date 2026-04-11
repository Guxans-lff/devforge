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

/** ECharts tooltip 回调参数（精简版） */
interface TooltipParam {
  name: string
  value: number
  percent?: number
}

/** 从 CSS 变量读取 oklch 颜色并转为 hex（ECharts 需要） */
function getCssColor(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  if (!raw) return fallback
  // 创建临时元素让浏览器解析 oklch → rgb
  const el = document.createElement('div')
  el.style.color = raw
  document.body.appendChild(el)
  const rgb = getComputedStyle(el).color
  document.body.removeChild(el)
  // rgb(r, g, b) → #rrggbb
  const match = rgb.match(/(\d+)/g)
  if (!match || match.length < 3) return fallback
  return `#${match.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('')}`
}

/** 从主题 CSS 变量获取 chart 配色 */
function resolveChartColors(): [string, string][] {
  const c1 = getCssColor('--chart-1', '#6366f1')
  const c2 = getCssColor('--chart-2', '#3b82f6')
  const c3 = getCssColor('--chart-3', '#f59e0b')
  const c4 = getCssColor('--chart-4', '#10b981')
  const c5 = getCssColor('--chart-5', '#8b5cf6')
  // 每组渐变色使用相邻 chart 颜色
  return [
    [c1, c5],
    [c2, c4],
    [c3, c1],
    [c4, c2],
    [c5, c3],
  ]
}

/** 主题感知 tooltip 样式 */
function resolveTooltipStyle() {
  const bg = getCssColor('--popover', '#ffffff')
  const fg = getCssColor('--popover-foreground', '#333333')
  const muted = getCssColor('--muted-foreground', '#666666')
  return { bg, fg, muted }
}

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
    const dataEntries = Array.from(dataMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)

    // 智能归并：保留前 10 名，其余归入“其他”
    const MAX_PIE_ITEMS = 10
    let finalData = dataEntries
    if (dataEntries.length > MAX_PIE_ITEMS) {
      const top = dataEntries.slice(0, MAX_PIE_ITEMS)
      const others = dataEntries.slice(MAX_PIE_ITEMS).reduce((sum, item) => sum + item.value, 0)
      finalData = [...top, { name: '其他', value: others }]
    }

    const total = finalData.reduce((sum, d) => sum + d.value, 0)

    const ts = resolveTooltipStyle()

    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: ts.bg,
        borderRadius: 8,
        padding: [12, 16],
        shadowBlur: 10,
        shadowColor: 'rgba(0,0,0,0.1)',
        textStyle: { color: ts.fg, fontSize: 12 },
        formatter: (params: TooltipParam) => {
          return `<div style="font-weight:bold;margin-bottom:4px">${params.name}</div>
                  <div style="display:flex;justify-content:space-between;gap:20px">
                    <span style="color:${ts.muted}">数值:</span>
                    <span style="font-family:monospace">${params.value.toLocaleString()}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;gap:20px">
                    <span style="color:${ts.muted}">占比:</span>
                    <span style="font-family:monospace">${params.percent}%</span>
                  </div>`
        }
      },
      title: {
        text: '总计',
        subtext: total.toLocaleString(),
        left: 'center',
        top: 'middle',
        textStyle: { fontSize: 14, color: ts.muted, fontWeight: 'normal' },
        subtextStyle: { fontSize: 20, color: ts.fg, fontWeight: 'bold' }
      },
      series: [{
        type: 'pie',
        radius: ['50%', '75%'],
        data: finalData,
        minAngle: 5,
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: ts.bg, borderWidth: 2 },
        label: { show: true, formatter: '{b}\n{d}%', fontSize: 11, minMargin: 5 },
        emphasis: { 
          scaleSize: 10,
          itemStyle: { shadowBlur: 15, shadowColor: 'rgba(0,0,0,0.2)' } 
        },
      }],
    }
  }

  // 柱状图/折线图/散点图
  const chartColors = resolveChartColors()
  const series = yIdxList.map((yIdx, i) => {
    const colors = chartColors[i % chartColors.length] as [string, string]
    const baseStyle = {
      name: yColumnNames[i],
      smooth: chartType === 'line',
      emphasis: { focus: 'series', itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.2)' } },
    }

    if (chartType === 'bar') {
      return {
        ...baseStyle,
        type: 'bar',
        data: props.rows.map(r => toNumber(r[yIdx])),
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: colors[0] }, { offset: 1, color: colors[1] }]
          }
        },
        barMaxWidth: 40,
      }
    }

    if (chartType === 'line') {
      return {
        ...baseStyle,
        type: 'line',
        data: props.rows.map(r => toNumber(r[yIdx])),
        lineStyle: { width: 3, color: colors[0] },
        itemStyle: { color: colors[0] },
        areaStyle: {
          opacity: 0.1,
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: colors[0] }, { offset: 1, color: 'rgba(255,255,255,0)' }]
          }
        },
        symbol: 'circle',
        symbolSize: 6,
      }
    }

    return {
      ...baseStyle,
      type: 'scatter',
      data: props.rows.map(r => toNumber(r[yIdx])),
      itemStyle: { color: colors[0], opacity: 0.6 },
      symbolSize: 10,
    }
  })

  return {
    tooltip: { 
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: 'rgba(0,0,0,0.1)', width: 1 } }
    },
    legend: yColumnNames.length > 1 ? { data: yColumnNames, bottom: 0, icon: 'circle' } : undefined,
    xAxis: { 
      type: 'category' as const, 
      data: xValues, 
      axisLabel: { 
        rotate: xValues.length > 12 ? 30 : 0,
        interval: 'auto',
        hideOverlap: true,
        fontSize: 10,
        color: '#888',
      },
      axisLine: { lineStyle: { color: '#eee' } },
      axisTick: { show: false },
    },
    yAxis: { 
      type: 'value' as const,
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.2 } },
      axisLine: { show: false },
    },
    series,
    grid: { 
      top: 40,
      left: 10, 
      right: 20, 
      bottom: 70, 
      containLabel: true 
    },
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
    const dataEntries = categories.map(cat => {
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
    }).sort((a, b) => b.value - a.value)

    /** 归并逻辑同上 */
    const MAX_PIE_ITEMS = 10
    let finalData = dataEntries
    if (dataEntries.length > MAX_PIE_ITEMS) {
      const top = dataEntries.slice(0, MAX_PIE_ITEMS)
      const others = Math.round(dataEntries.slice(MAX_PIE_ITEMS).reduce((sum, item) => sum + item.value, 0) * 100) / 100
      finalData = [...top, { name: '其他', value: others }]
    }

    const total = Math.round(finalData.reduce((sum, d) => sum + d.value, 0) * 100) / 100

    const ts = resolveTooltipStyle()

    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: ts.bg,
        borderRadius: 8,
        padding: [12, 16],
        shadowBlur: 10,
        shadowColor: 'rgba(0,0,0,0.1)',
        textStyle: { color: ts.fg, fontSize: 12 },
        formatter: (params: TooltipParam) => {
          return `<div style="font-weight:bold;margin-bottom:4px">${params.name}</div>
                  <div style="display:flex;justify-content:space-between;gap:20px">
                    <span style="color:${ts.muted}">数值:</span>
                    <span style="font-family:monospace">${params.value.toLocaleString()}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;gap:20px">
                    <span style="color:${ts.muted}">占比:</span>
                    <span style="font-family:monospace">${params.percent}%</span>
                  </div>`
        }
      },
      title: {
        text: '总计',
        subtext: total.toLocaleString(),
        left: 'center',
        top: 'middle',
        textStyle: { fontSize: 14, color: ts.muted, fontWeight: 'normal' },
        subtextStyle: { fontSize: 20, color: ts.fg, fontWeight: 'bold' }
      },
      series: [{ 
        type: 'pie', 
        radius: ['50%', '75%'], 
        data: finalData,
        minAngle: 5,
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: ts.bg, borderWidth: 2 },
        label: { show: true, formatter: '{b}\n{d}%', fontSize: 11, minMargin: 5 },
        emphasis: { 
          scaleSize: 10,
          itemStyle: { shadowBlur: 15, shadowColor: 'rgba(0,0,0,0.2)' } 
        }
      }],
    }
  }

  const chartColors = resolveChartColors()
  const series = yIdxList.map((yIdx, i) => {
    const colors = chartColors[i % chartColors.length] as [string, string]
    const data = categories.map(cat => {
      const catRows = groups.get(cat) ?? []
      if (aggregation === 'count') return catRows.length
      if (aggregation === 'sum') return Math.round(catRows.reduce((s, r) => s + toNumber(r[yIdx]), 0) * 100) / 100
      const sum = catRows.reduce((s, r) => s + toNumber(r[yIdx]), 0)
      return catRows.length > 0 ? Math.round((sum / catRows.length) * 100) / 100 : 0
    })

    const baseStyle = {
      name: yColumnNames[i],
      smooth: chartType === 'line',
      emphasis: { focus: 'series', itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.2)' } },
    }

    if (chartType === 'bar') {
      return {
        ...baseStyle,
        type: 'bar',
        data,
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: colors[0] }, { offset: 1, color: colors[1] }]
          }
        },
        barMaxWidth: 40,
      }
    }

    if (chartType === 'line') {
      return {
        ...baseStyle,
        type: 'line',
        data,
        lineStyle: { width: 3, color: colors[0] },
        itemStyle: { color: colors[0] },
        areaStyle: {
          opacity: 0.1,
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: colors[0] }, { offset: 1, color: 'rgba(255,255,255,0)' }]
          }
        },
        symbol: 'circle',
        symbolSize: 6,
      }
    }

    return {
      ...baseStyle,
      type: 'scatter',
      data,
      itemStyle: { color: colors[0], opacity: 0.6 },
      symbolSize: 10,
    }
  })

  return {
    tooltip: { 
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: 'rgba(0,0,0,0.1)', width: 1 } }
    },
    legend: yColumnNames.length > 1 ? { data: yColumnNames, bottom: 0, icon: 'circle' } : undefined,
    xAxis: { 
      type: 'category' as const, 
      data: categories, 
      axisLabel: { 
        rotate: categories.length > 12 ? 30 : 0,
        interval: 'auto',
        hideOverlap: true,
        fontSize: 10,
        color: '#888',
      },
      axisLine: { lineStyle: { color: '#eee' } },
      axisTick: { show: false },
    },
    yAxis: { 
      type: 'value' as const,
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.2 } },
      axisLine: { show: false },
    },
    series,
    grid: { 
      top: 40,
      left: 10, 
      right: 20, 
      bottom: 70, 
      containLabel: true 
    },
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
    <VChart
      v-if="chartOption"
      :option="chartOption"
      autoresize
      class="h-full w-full"
    />
  </div>
</template>
