<script setup lang="ts">
/**
 * 服务器监控仪表盘
 * SSH 连接后实时展示 CPU、内存、磁盘、网络指标曲线
 */
import { computed, defineAsyncComponent, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useServerMonitor } from '@/composables/useServerMonitor'
import { Cpu, MemoryStick, HardDrive, Network, Activity, Clock, RefreshCw, AlertTriangle } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

/** ECharts 按需引入 */
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, BarChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
} from 'echarts/components'

use([
  CanvasRenderer,
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
])

const VChart = defineAsyncComponent(() => import('vue-echarts'))

const props = defineProps<{
  connectionId: string
  /** 是否处于活跃状态（切走时停止采集） */
  active: boolean
}>()

const { t } = useI18n()
const monitor = useServerMonitor(props.connectionId)

// 活跃时启动，切走时停止
watch(() => props.active, (active) => {
  if (active) {
    monitor.start()
  } else {
    monitor.stop()
  }
})

onMounted(() => {
  if (props.active) {
    monitor.start()
  }
})

// ── 格式化工具 ────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toFixed(0)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatBytesRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── 统计卡片 ─────────────────────────────────────────────────

const memPercent = computed(() => {
  const m = monitor.latest.value
  if (!m || m.memoryTotal === 0) return 0
  return Math.round((m.memoryUsed / m.memoryTotal) * 100)
})

// ── ECharts 配置 ─────────────────────────────────────────────

const chartTheme = {
  textColor: 'rgba(156, 163, 175, 0.8)',
  gridColor: 'rgba(156, 163, 175, 0.08)',
}

function baseChartOption() {
  return {
    animation: false,
    grid: { top: 8, right: 12, bottom: 24, left: 48 },
    xAxis: {
      type: 'category' as const,
      boundaryGap: false,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: chartTheme.textColor, fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: chartTheme.textColor, fontSize: 10 },
      splitLine: { lineStyle: { color: chartTheme.gridColor } },
    },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: 'rgba(0,0,0,0.75)',
      borderColor: 'transparent',
      textStyle: { color: '#fff', fontSize: 11 },
    },
  }
}

/** CPU 使用率曲线 */
const cpuChartOption = computed(() => {
  const data = monitor.cpuHistory.value
  return {
    ...baseChartOption(),
    xAxis: {
      ...baseChartOption().xAxis,
      data: data.map(d => formatTime(d.time)),
    },
    yAxis: {
      ...baseChartOption().yAxis,
      max: 100,
      axisLabel: { ...baseChartOption().yAxis.axisLabel, formatter: '{value}%' },
    },
    series: [{
      type: 'line',
      data: data.map(d => d.value.toFixed(1)),
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 1.5, color: '#3b82f6' },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(59,130,246,0.25)' },
            { offset: 1, color: 'rgba(59,130,246,0.02)' },
          ],
        },
      },
    }],
  }
})

/** 内存使用曲线 */
const memoryChartOption = computed(() => {
  const data = monitor.memoryHistory.value
  return {
    ...baseChartOption(),
    xAxis: {
      ...baseChartOption().xAxis,
      data: data.map(d => formatTime(d.time)),
    },
    yAxis: {
      ...baseChartOption().yAxis,
      axisLabel: { ...baseChartOption().yAxis.axisLabel, formatter: (v: number) => `${(v / 1024).toFixed(0)}G` },
    },
    series: [{
      type: 'line',
      name: t('monitor.memUsed'),
      data: data.map(d => d.used),
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 1.5, color: '#8b5cf6' },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(139,92,246,0.25)' },
            { offset: 1, color: 'rgba(139,92,246,0.02)' },
          ],
        },
      },
    }],
  }
})

/** 网络 IO 曲线 */
const networkChartOption = computed(() => {
  const data = monitor.networkHistory.value
  return {
    ...baseChartOption(),
    xAxis: {
      ...baseChartOption().xAxis,
      data: data.map(d => formatTime(d.time)),
    },
    yAxis: {
      ...baseChartOption().yAxis,
      axisLabel: { ...baseChartOption().yAxis.axisLabel, formatter: (v: number) => formatBytes(v) },
    },
    legend: {
      show: true,
      top: 0,
      right: 0,
      textStyle: { color: chartTheme.textColor, fontSize: 10 },
      itemWidth: 12,
      itemHeight: 2,
    },
    series: [
      {
        type: 'line',
        name: '↓ RX',
        data: data.map(d => d.rxRate),
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.5, color: '#10b981' },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(16,185,129,0.2)' },
              { offset: 1, color: 'rgba(16,185,129,0.02)' },
            ],
          },
        },
      },
      {
        type: 'line',
        name: '↑ TX',
        data: data.map(d => d.txRate),
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.5, color: '#f59e0b' },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(245,158,11,0.2)' },
              { offset: 1, color: 'rgba(245,158,11,0.02)' },
            ],
          },
        },
      },
    ],
  }
})

/** 磁盘使用率柱状图 */
const diskChartOption = computed(() => {
  const m = monitor.latest.value
  if (!m) return {}
  const disks = m.disks
  return {
    ...baseChartOption(),
    grid: { top: 8, right: 12, bottom: 32, left: 48 },
    xAxis: {
      type: 'category' as const,
      data: disks.map(d => d.mountPoint),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: chartTheme.textColor,
        fontSize: 9,
        rotate: disks.length > 4 ? 30 : 0,
      },
    },
    yAxis: {
      ...baseChartOption().yAxis,
      max: 100,
      axisLabel: { ...baseChartOption().yAxis.axisLabel, formatter: '{value}%' },
    },
    series: [{
      type: 'bar',
      data: disks.map(d => ({
        value: d.usePercent,
        itemStyle: {
          color: d.usePercent > 90 ? '#ef4444' : d.usePercent > 70 ? '#f59e0b' : '#10b981',
          borderRadius: [3, 3, 0, 0],
        },
      })),
      barMaxWidth: 24,
    }],
  }
})
</script>

<template>
  <div class="absolute inset-0 overflow-hidden">
    <div class="h-full overflow-y-auto p-4 space-y-4">
      <!-- 加载状态 -->
      <div v-if="monitor.loading.value" class="flex items-center justify-center h-48 text-muted-foreground">
        <RefreshCw class="h-4 w-4 animate-spin mr-2" />
        <span class="text-sm">{{ t('monitor.loading') }}</span>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="monitor.error.value && !monitor.latest.value" class="flex flex-col items-center justify-center h-48 gap-3">
        <AlertTriangle class="h-8 w-8 text-destructive" />
        <p class="text-sm text-destructive">{{ monitor.error.value }}</p>
        <Button variant="outline" size="sm" @click="monitor.start()">
          <RefreshCw class="h-3 w-3 mr-1" />
          {{ t('monitor.retry') }}
        </Button>
      </div>

      <template v-else-if="monitor.latest.value">
        <!-- 顶部状态卡片 -->
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <!-- CPU -->
          <div class="rounded-lg border border-border/50 bg-card/50 p-3 backdrop-blur-sm">
            <div class="flex items-center gap-2 text-muted-foreground mb-1">
              <Cpu class="h-3.5 w-3.5 text-primary" />
              <span class="text-[11px] font-medium">CPU</span>
            </div>
            <div class="text-xl font-bold tabular-nums" :class="monitor.latest.value.cpuUsage > 80 ? 'text-destructive' : 'text-foreground'">
              {{ monitor.latest.value.cpuUsage.toFixed(1) }}%
            </div>
            <div class="text-[10px] text-muted-foreground/60 mt-0.5">
              {{ monitor.latest.value.cpuCores }} {{ t('monitor.cores') }}
            </div>
          </div>

          <!-- 内存 -->
          <div class="rounded-lg border border-border/50 bg-card/50 p-3 backdrop-blur-sm">
            <div class="flex items-center gap-2 text-muted-foreground mb-1">
              <MemoryStick class="h-3.5 w-3.5 text-df-info" />
              <span class="text-[11px] font-medium">{{ t('monitor.memory') }}</span>
            </div>
            <div class="text-xl font-bold tabular-nums" :class="memPercent > 85 ? 'text-destructive' : 'text-foreground'">
              {{ memPercent }}%
            </div>
            <div class="text-[10px] text-muted-foreground/60 mt-0.5">
              {{ (monitor.latest.value.memoryUsed / 1024).toFixed(1) }}G / {{ (monitor.latest.value.memoryTotal / 1024).toFixed(1) }}G
            </div>
          </div>

          <!-- 负载 -->
          <div class="rounded-lg border border-border/50 bg-card/50 p-3 backdrop-blur-sm">
            <div class="flex items-center gap-2 text-muted-foreground mb-1">
              <Activity class="h-3.5 w-3.5 text-df-success" />
              <span class="text-[11px] font-medium">{{ t('monitor.load') }}</span>
            </div>
            <div class="text-xl font-bold tabular-nums text-foreground">
              {{ monitor.latest.value.loadAvg[0].toFixed(2) }}
            </div>
            <div class="text-[10px] text-muted-foreground/60 mt-0.5">
              {{ monitor.latest.value.loadAvg[1].toFixed(2) }} / {{ monitor.latest.value.loadAvg[2].toFixed(2) }}
            </div>
          </div>

          <!-- 运行时间 -->
          <div class="rounded-lg border border-border/50 bg-card/50 p-3 backdrop-blur-sm">
            <div class="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock class="h-3.5 w-3.5 text-df-warning" />
              <span class="text-[11px] font-medium">{{ t('monitor.uptime') }}</span>
            </div>
            <div class="text-xl font-bold tabular-nums text-foreground">
              {{ formatUptime(monitor.latest.value.uptimeSeconds) }}
            </div>
            <div v-if="monitor.latest.value.swapTotal > 0" class="text-[10px] text-muted-foreground/60 mt-0.5">
              Swap: {{ (monitor.latest.value.swapUsed / 1024).toFixed(1) }}G / {{ (monitor.latest.value.swapTotal / 1024).toFixed(1) }}G
            </div>
          </div>
        </div>

        <!-- 图表网格 -->
        <div class="grid grid-cols-1 gap-3 lg:grid-cols-2 overflow-hidden">
          <!-- CPU 曲线 -->
          <div class="rounded-lg border border-border/50 bg-card/50 p-3 backdrop-blur-sm overflow-hidden">
            <div class="flex items-center gap-2 text-muted-foreground mb-2">
              <Cpu class="h-3 w-3 text-primary" />
              <span class="text-[11px] font-medium">{{ t('monitor.cpuUsage') }}</span>
            </div>
            <VChart :option="cpuChartOption" class="h-52 w-full" />
          </div>

          <!-- 内存曲线 -->
          <div class="rounded-lg border border-border/50 bg-card/50 p-3 backdrop-blur-sm overflow-hidden">
            <div class="flex items-center gap-2 text-muted-foreground mb-2">
              <MemoryStick class="h-3 w-3 text-df-info" />
              <span class="text-[11px] font-medium">{{ t('monitor.memoryUsage') }}</span>
            </div>
            <VChart :option="memoryChartOption" class="h-52 w-full" />
          </div>

          <!-- 网络 IO -->
          <div class="rounded-lg border border-border/50 bg-card/50 p-3 backdrop-blur-sm overflow-hidden">
            <div class="flex items-center gap-2 text-muted-foreground mb-2">
              <Network class="h-3 w-3 text-df-success" />
              <span class="text-[11px] font-medium">{{ t('monitor.networkIo') }}</span>
              <span v-if="monitor.latest.value.networkRates.length > 0" class="ml-auto text-[10px] tabular-nums">
                ↓ {{ formatBytesRate(monitor.latest.value.networkRates[0]!.rxRate) }}
                ↑ {{ formatBytesRate(monitor.latest.value.networkRates[0]!.txRate) }}
              </span>
            </div>
            <VChart :option="networkChartOption" class="h-52 w-full" />
          </div>

          <!-- 磁盘使用率 -->
          <div class="rounded-lg border border-border/50 bg-card/50 p-3 backdrop-blur-sm overflow-hidden">
            <div class="flex items-center gap-2 text-muted-foreground mb-2">
              <HardDrive class="h-3 w-3 text-df-warning" />
              <span class="text-[11px] font-medium">{{ t('monitor.diskUsage') }}</span>
            </div>
            <VChart :option="diskChartOption" class="h-52 w-full" />
          </div>
        </div>

        <!-- 磁盘详情表格 -->
        <div class="rounded-lg border border-border/50 bg-card/50 p-3 backdrop-blur-sm">
          <div class="flex items-center gap-2 text-muted-foreground mb-2">
            <HardDrive class="h-3 w-3" />
            <span class="text-[11px] font-medium">{{ t('monitor.diskDetail') }}</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-[11px]">
              <thead>
                <tr class="border-b border-border/30 text-muted-foreground">
                  <th class="text-left py-1.5 px-2 font-medium">{{ t('monitor.filesystem') }}</th>
                  <th class="text-left py-1.5 px-2 font-medium">{{ t('monitor.mountPoint') }}</th>
                  <th class="text-right py-1.5 px-2 font-medium">{{ t('monitor.total') }}</th>
                  <th class="text-right py-1.5 px-2 font-medium">{{ t('monitor.used') }}</th>
                  <th class="text-right py-1.5 px-2 font-medium">{{ t('monitor.available') }}</th>
                  <th class="text-right py-1.5 px-2 font-medium">{{ t('monitor.usage') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="disk in monitor.latest.value.disks"
                  :key="disk.mountPoint"
                  class="border-b border-border/10 hover:bg-muted/30 transition-colors"
                >
                  <td class="py-1.5 px-2 font-mono text-muted-foreground">{{ disk.filesystem }}</td>
                  <td class="py-1.5 px-2 font-mono">{{ disk.mountPoint }}</td>
                  <td class="py-1.5 px-2 text-right tabular-nums">{{ (disk.totalMb / 1024).toFixed(1) }}G</td>
                  <td class="py-1.5 px-2 text-right tabular-nums">{{ (disk.usedMb / 1024).toFixed(1) }}G</td>
                  <td class="py-1.5 px-2 text-right tabular-nums">{{ (disk.availableMb / 1024).toFixed(1) }}G</td>
                  <td class="py-1.5 px-2 text-right">
                    <div class="flex items-center justify-end gap-1.5">
                      <div class="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          class="h-full rounded-full transition-all"
                          :class="disk.usePercent > 90 ? 'bg-destructive' : disk.usePercent > 70 ? 'bg-df-warning' : 'bg-df-success'"
                          :style="{ width: `${Math.min(disk.usePercent, 100)}%` }"
                        />
                      </div>
                      <span class="tabular-nums w-8 text-right" :class="disk.usePercent > 90 ? 'text-destructive' : ''">
                        {{ disk.usePercent.toFixed(0) }}%
                      </span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 错误提示（有数据但采集出错） -->
        <div v-if="monitor.error.value" class="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle class="h-3 w-3 shrink-0" />
          <span>{{ monitor.error.value }}</span>
          <Button variant="ghost" size="sm" class="ml-auto h-6 text-xs" @click="monitor.start()">
            {{ t('monitor.retry') }}
          </Button>
        </div>
      </template>

      <!-- 底部状态栏 -->
      <div v-if="monitor.latest.value" class="flex items-center justify-between text-[10px] text-muted-foreground/50 px-1">
        <span>
          {{ t('monitor.samplingInterval') }}: {{ (monitor.interval.value / 1000).toFixed(0) }}s
          · {{ t('monitor.samples') }}: {{ monitor.history.value.length }}
        </span>
        <span v-if="!monitor.running.value" class="text-df-warning">
          {{ t('monitor.stopped') }}
        </span>
      </div>
    </div>
  </div>
</template>
