<script setup lang="ts">
/**
 * 服务器监控仪表盘
 * SSH 连接后实时展示 CPU、内存、磁盘、网络指标
 */
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useServerMonitor } from '@/composables/useServerMonitor'
import { resolveMonitorColors, baseChartOption } from '@/composables/useChartTheme'
import { Cpu, MemoryStick, Network, Activity, Clock, RefreshCw, AlertTriangle } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import MonitorChartCard from './monitor/MonitorChartCard.vue'
import DiskUsageList from './monitor/DiskUsageList.vue'

/** ECharts 按需注册（子组件 init 前必须完成） */
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, LegendComponent])

const props = defineProps<{
  connectionId: string
  active: boolean
}>()

const { t } = useI18n()
const monitor = useServerMonitor(props.connectionId)

// 活跃时启动，切走时停止
watch(() => props.active, (active) => {
  if (active) monitor.start()
  else monitor.stop()
})

onMounted(() => {
  if (props.active) monitor.start()
})

// ── 统一 ResizeObserver ────────────────────────────────────────
const dashboardRef = ref<HTMLElement>()
const chartRefs = ref<InstanceType<typeof MonitorChartCard>[]>([])
let resizeObserver: ResizeObserver | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null

function onDashboardResize() {
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    chartRefs.value.forEach(c => c?.resize())
  }, 200)
}

onMounted(() => {
  if (!dashboardRef.value) return
  resizeObserver = new ResizeObserver(onDashboardResize)
  resizeObserver.observe(dashboardRef.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (resizeTimer) clearTimeout(resizeTimer)
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

// ── 统计计算 ────────────────────────────────────────────────

const memPercent = computed(() => {
  const m = monitor.latest.value
  if (!m || m.memoryTotal === 0) return 0
  return Math.round((m.memoryUsed / m.memoryTotal) * 100)
})

// ── ECharts 配置 ─────────────────────────────────────────────

/** CPU 使用率曲线 */
const cpuChartOption = computed(() => {
  const data = monitor.cpuHistory.value
  const colors = resolveMonitorColors()
  const base = baseChartOption(colors)
  return {
    ...base,
    xAxis: { ...base.xAxis, data: data.map(d => formatTime(d.time)) },
    yAxis: {
      ...base.yAxis,
      max: 100,
      axisLabel: { ...base.yAxis.axisLabel, formatter: '{value}%' },
    },
    series: [{
      type: 'line',
      data: data.map(d => +d.value.toFixed(1)),
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 1.5, color: colors.cpu },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: colors.cpu + '40' },
            { offset: 1, color: colors.cpu + '05' },
          ],
        },
      },
    }],
  }
})

/** 内存使用曲线 */
const memoryChartOption = computed(() => {
  const data = monitor.memoryHistory.value
  const colors = resolveMonitorColors()
  const base = baseChartOption(colors)
  return {
    ...base,
    xAxis: { ...base.xAxis, data: data.map(d => formatTime(d.time)) },
    yAxis: {
      ...base.yAxis,
      axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => `${(v / 1024).toFixed(0)}G` },
    },
    series: [{
      type: 'line',
      name: t('monitor.memUsed'),
      data: data.map(d => d.used),
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 1.5, color: colors.memory },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: colors.memory + '40' },
            { offset: 1, color: colors.memory + '05' },
          ],
        },
      },
    }],
  }
})

/** 网络 IO 曲线 */
const networkChartOption = computed(() => {
  const data = monitor.networkHistory.value
  const colors = resolveMonitorColors()
  const base = baseChartOption(colors)
  return {
    ...base,
    xAxis: { ...base.xAxis, data: data.map(d => formatTime(d.time)) },
    yAxis: {
      ...base.yAxis,
      axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => formatBytes(v) },
    },
    legend: {
      show: true, top: 0, right: 0,
      textStyle: { color: colors.text, fontSize: 10 },
      itemWidth: 12, itemHeight: 2,
    },
    series: [
      {
        type: 'line', name: '↓ RX',
        data: data.map(d => d.rxRate),
        smooth: true, symbol: 'none',
        lineStyle: { width: 1.5, color: colors.networkRx },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: colors.networkRx + '33' },
              { offset: 1, color: colors.networkRx + '05' },
            ],
          },
        },
      },
      {
        type: 'line', name: '↑ TX',
        data: data.map(d => d.txRate),
        smooth: true, symbol: 'none',
        lineStyle: { width: 1.5, color: colors.networkTx },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: colors.networkTx + '33' },
              { offset: 1, color: colors.networkTx + '05' },
            ],
          },
        },
      },
    ],
  }
})
</script>

<template>
  <div ref="dashboardRef" class="absolute inset-0 overflow-hidden">
    <div class="h-full overflow-y-auto p-4 space-y-3">
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
        <!-- 顶部统计卡片 -->
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

        <!-- CPU 曲线（全宽） -->
        <MonitorChartCard
          :ref="(el: any) => { if (el) chartRefs[0] = el }"
          :icon="Cpu"
          icon-class="text-primary"
          :title="t('monitor.cpuUsage')"
          :option="cpuChartOption"
          height="180px"
        />

        <!-- 内存 + 网络（并排） -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <MonitorChartCard
            :ref="(el: any) => { if (el) chartRefs[1] = el }"
            :icon="MemoryStick"
            icon-class="text-df-info"
            :title="t('monitor.memoryUsage')"
            :option="memoryChartOption"
            height="160px"
          />
          <MonitorChartCard
            :ref="(el: any) => { if (el) chartRefs[2] = el }"
            :icon="Network"
            icon-class="text-df-success"
            :title="t('monitor.networkIo')"
            :subtitle="monitor.latest.value.networkRates.length > 0
              ? `↓ ${formatBytesRate(monitor.latest.value.networkRates[0]!.rxRate)} ↑ ${formatBytesRate(monitor.latest.value.networkRates[0]!.txRate)}`
              : undefined"
            :option="networkChartOption"
            height="160px"
          />
        </div>

        <!-- 磁盘进度条列表 -->
        <DiskUsageList :disks="monitor.latest.value.disks" />

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
