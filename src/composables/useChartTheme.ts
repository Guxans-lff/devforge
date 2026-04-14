/**
 * 主题感知 ECharts 配色 composable
 * 从 CSS 变量解析颜色，供监控面板和结果图表共用
 */

/**
 * 从 CSS 变量读取颜色并转为 hex（ECharts 需要 hex 格式）
 * 使用真实 DOM 元素的 computed color 确保浏览器解析 oklch → rgb
 */
export function getCssColor(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  if (!raw) return fallback

  // 创建临时元素，挂到 body 上让浏览器完成样式计算
  const el = document.createElement('div')
  el.style.position = 'absolute'
  el.style.visibility = 'hidden'
  el.style.pointerEvents = 'none'
  // 用 color 属性，因为 getComputedStyle 保证返回 rgb() 格式
  el.style.color = raw
  document.body.appendChild(el)
  const computed = getComputedStyle(el).color
  document.body.removeChild(el)

  if (!computed) return fallback

  // 处理 rgb(r, g, b) / rgba(r, g, b, a) / rgb(r g b) 等格式
  const match = computed.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/)
  if (!match) return fallback

  const r = Number(match[1]).toString(16).padStart(2, '0')
  const g = Number(match[2]).toString(16).padStart(2, '0')
  const b = Number(match[3]).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

/** 解析监控面板所需的全部主题色 */
export function resolveMonitorColors() {
  return {
    text: getCssColor('--muted-foreground', '#9ca3af'),
    grid: getCssColor('--border', '#e5e7eb'),
    tooltipBg: getCssColor('--popover', '#ffffff'),
    tooltipFg: getCssColor('--popover-foreground', '#333333'),
    cpu: getCssColor('--chart-1', '#6366f1'),
    memory: getCssColor('--chart-5', '#8b5cf6'),
    networkRx: getCssColor('--df-success', '#10b981'),
    networkTx: getCssColor('--df-warning', '#f59e0b'),
  }
}

/** 基础 ECharts grid + tooltip 配置（百分比布局，自适应容器） */
export function baseChartOption(colors: ReturnType<typeof resolveMonitorColors>) {
  return {
    animation: false,
    grid: { top: '5%', right: '3%', bottom: '18%', left: '10%' },
    xAxis: {
      type: 'category' as const,
      boundaryGap: false,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: colors.text, fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: colors.text, fontSize: 10 },
      splitLine: { lineStyle: { color: colors.grid, opacity: 0.15 } },
    },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: colors.tooltipBg,
      borderColor: 'transparent',
      textStyle: { color: colors.tooltipFg, fontSize: 11 },
    },
  }
}
