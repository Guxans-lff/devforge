<script setup lang="ts">
/**
 * PerformanceDashboard - 性能监控仪表盘组件
 * 展示 MySQL 服务器关键性能指标（QPS/TPS/连接数/缓冲池/慢查询）
 * 使用 Canvas 2D API 绘制折线图，每 5 秒自动刷新
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { dbGetServerStatus, dbGetProcessList, dbKillProcess, dbGetServerVariables } from '@/api/database'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import type { ServerStatus, ProcessInfo, ServerVariable } from '@/types/database'
import type { PerformanceTabContext } from '@/types/database-workspace'
import { Activity, Database, Gauge, Clock, AlertTriangle, RefreshCw, Terminal, Settings, Search, Trash2, Shield, Info, CheckCircle2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useMessage } from '@/stores/message-center'

const props = defineProps<{
  connectionId: string
  tabId: string
  isConnected: boolean
}>()

const dbWorkspaceStore = useDatabaseWorkspaceStore()

/** 最新的服务器状态 */
const currentStatus = ref<ServerStatus | null>(null)
/** 是否正在加载 */
const isLoading = ref(false)
/** 错误信息 */
const errorMessage = ref<string | null>(null)
/** 自动刷新定时器句柄 */
let refreshTimer: ReturnType<typeof setInterval> | null = null

const chartCanvas = ref<HTMLCanvasElement | null>(null)

// 历史数据（折线图使用，最近 60 个数据点 = 5 分钟）
const MAX_DATA_POINTS = 60
const qpsHistory = ref<number[]>([])
const tpsHistory = ref<number[]>([])
const timeLabels = ref<string[]>([])

// 进程列表与变量
const processes = ref<ProcessInfo[]>([])
const variables = ref<ServerVariable[]>([])
const variableSearch = ref('')
const message = useMessage()

// 确认对话框状态
const showKillConfirm = ref(false)
const pidToKill = ref<number | null>(null)

/** 当前激活的子标签页 */
const activeSubTab = computed(() => {
  const ws = dbWorkspaceStore.getWorkspace(props.connectionId)
  if (!ws) return 'dashboard'
  const tab = ws.tabs.find(t => t.id === props.tabId)
  if (!tab || tab.type !== 'performance') return 'dashboard'
  return (tab.context as PerformanceTabContext).activeSubTab ?? 'dashboard'
})

/** 子标签页配置列表 */
const subTabs: Array<{ key: PerformanceTabContext['activeSubTab']; label: string, icon: any }> = [
  { key: 'dashboard', label: '实时仪表盘', icon: Activity },
  { key: 'processes', label: '会话进程', icon: Terminal },
  { key: 'variables', label: '全量全局变量', icon: Settings },
]

/** 获取子标签页描述 */
const currentTabLabel = computed(() => subTabs.find(t => t.key === activeSubTab.value)?.label)

/** 切换子标签页 */
function setSubTab(subTab: PerformanceTabContext['activeSubTab']) {
  dbWorkspaceStore.updateTabContext(props.connectionId, props.tabId, { activeSubTab: subTab })
}

/** 格式化数字为可读字符串（K/M 缩写） */
function formatNumber(value: number, decimals = 1): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(decimals) + 'M'
  if (value >= 1_000) return (value / 1_000).toFixed(decimals) + 'K'
  return value.toFixed(decimals)
}

/** 格式化运行时间 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return days + '天 ' + hours + '时'
  if (hours > 0) return hours + '时 ' + mins + '分'
  return mins + '分'
}

/** 格式化百分比 */
function formatPercent(value: number): string {
  return (value * 100).toFixed(1) + '%'
}

/** 指标卡片列表 (注入炫彩基因) */
const metricCards = computed(() => {
  const s = currentStatus.value
  if (!s) return []
  return [
    { 
      label: '每秒查询 (QPS)', 
      value: formatNumber(s.qps), 
      subtitle: 'Queries Per Second', 
      icon: Activity, 
      color: 'text-blue-500', 
      gradient: 'from-blue-500/10 via-blue-500/5 to-transparent',
      border: 'border-blue-500/20',
      glow: 'shadow-blue-500/10'
    },
    { 
      label: '每秒事务 (TPS)', 
      value: formatNumber(s.tps), 
      subtitle: 'Transactions Per Second', 
      icon: Gauge, 
      color: 'text-emerald-500', 
      gradient: 'from-emerald-500/10 via-emerald-500/5 to-transparent',
      border: 'border-emerald-500/20',
      glow: 'shadow-emerald-500/10'
    },
    { 
      label: '当前活跃连接', 
      value: String(s.activeConnections), 
      subtitle: `总计 ${s.totalConnections} 个连接`, 
      icon: Database, 
      color: 'text-amber-500', 
      gradient: 'from-amber-500/10 via-amber-500/5 to-transparent',
      border: 'border-amber-500/20',
      glow: 'shadow-amber-500/10'
    },
    { 
      label: '缓冲池利用率', 
      value: formatPercent(s.bufferPoolUsage), 
      subtitle: 'InnoDB Buffer Pool', 
      icon: Clock, 
      color: 'text-purple-500', 
      gradient: 'from-purple-500/10 via-purple-500/5 to-transparent',
      border: 'border-purple-500/20',
      glow: 'shadow-purple-500/10'
    },
    { 
      label: '慢查询警告', 
      value: formatNumber(s.slowQueries, 0), 
      subtitle: '已运行 ' + formatUptime(s.uptime), 
      icon: AlertTriangle, 
      color: 'text-rose-500', 
      gradient: 'from-rose-500/10 via-rose-500/5 to-transparent',
      border: 'border-rose-500/20',
      glow: 'shadow-rose-500/10',
      isCritical: s.slowQueries > 0
    },
  ]
})

/** 获取服务器状态并更新历史数据 */
async function fetchServerStatus() {
  if (!props.isConnected) return
  isLoading.value = true
  errorMessage.value = null
  try {
    const status = await dbGetServerStatus(props.connectionId)
    currentStatus.value = status
    // 追加历史数据点，保留最近 60 个
    qpsHistory.value = [...qpsHistory.value, status.qps].slice(-MAX_DATA_POINTS)
    tpsHistory.value = [...tpsHistory.value, status.tps].slice(-MAX_DATA_POINTS)
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    timeLabels.value = [...timeLabels.value, hh + ':' + mm + ':' + ss].slice(-MAX_DATA_POINTS)
    // 等待 DOM 更新后绘制折线图
    await nextTick()
    drawChart()
  } catch (e) {
    errorMessage.value = String(e)
  } finally {
    isLoading.value = false
  }
}

/** 获取进程列表 */
async function fetchProcesses() {
  if (!props.isConnected) return
  isLoading.value = true
  try {
    processes.value = await dbGetProcessList(props.connectionId)
  } catch (e) {
    message.error('获取进程列表失败: ' + e)
  } finally {
    isLoading.value = false
  }
}

/** 获取服务器变量 */
async function fetchVariables() {
  if (!props.isConnected) return
  isLoading.value = true
  try {
    variables.value = await dbGetServerVariables(props.connectionId)
  } catch (e) {
    message.error('获取变量失败: ' + e)
  } finally {
    isLoading.value = false
  }
}

/** 准备杀死进程 */
function confirmKillProcess(pid: number) {
  pidToKill.value = pid
  showKillConfirm.value = true
}

/** 执行杀死进程 */
async function handleKillProcess() {
  if (pidToKill.value === null) return
  
  try {
    await dbKillProcess(props.connectionId, pidToKill.value)
    message.success(`已下发终止指令给进程 ${pidToKill.value}`)
    fetchProcesses()
  } catch (e) {
    message.error('终止进程失败: ' + e)
  } finally {
    pidToKill.value = null
    showKillConfirm.value = false
  }
}

/** 启动自动刷新（仅仪表盘模式下启动轮询） */
function startAutoRefresh() {
  stopAutoRefresh()
  if (activeSubTab.value === 'dashboard') {
    fetchServerStatus()
    refreshTimer = setInterval(fetchServerStatus, 5000)
  } else if (activeSubTab.value === 'processes') {
    fetchProcesses()
    refreshTimer = setInterval(fetchProcesses, 5000)
  } else if (activeSubTab.value === 'variables') {
    fetchVariables()
  }
}

/** 停止自动刷新 */
function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

/**
 * 使用 Canvas 2D API 绘制 QPS/TPS 折线图
 * 手动绘制简洁折线图，避免引入 ECharts 等重量级图表库
 */
function drawChart() {
  const canvas = chartCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // 处理高 DPI 屏幕，确保图表清晰
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)

  const width = rect.width
  const height = rect.height
  const pad = { top: 10, right: 16, bottom: 28, left: 50 }
  const cw = width - pad.left - pad.right
  const ch = height - pad.top - pad.bottom

  ctx.clearRect(0, 0, width, height)

  const qd = qpsHistory.value
  const td = tpsHistory.value
  const lb = timeLabels.value

  // 数据不足时显示等待提示
  if (qd.length < 2) {
    ctx.fillStyle = 'rgba(150,150,150,0.5)'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('等待数据采集...', width / 2, height / 2)
    return
  }

  // 计算 Y 轴范围（自适应缩放：最小地板值 0.2，确保低负载下也有波动视觉）
  const actualMax = Math.max(...qd, ...td, 0)
  const maxV = Math.max(actualMax * 1.2, 0.2)

  // 绘制水平网格线和 Y 轴标签
  const gl = 4
  ctx.strokeStyle = 'rgba(150,150,150,0.1)'
  ctx.lineWidth = 1
  ctx.fillStyle = 'rgba(150,150,150,0.5)'
  ctx.font = '10px monospace'
  ctx.textAlign = 'right'
  for (let i = 0; i <= gl; i++) {
    const y = pad.top + (ch / gl) * i
    const v = maxV - (maxV / gl) * i
    ctx.beginPath()
    ctx.moveTo(pad.left, y)
    ctx.lineTo(width - pad.right, y)
    ctx.stroke()
    ctx.fillText(formatNumber(v), pad.left - 6, y + 3)
  }

  // 绘制 X 轴时间标签
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(150,150,150,0.4)'
  ctx.font = '9px monospace'
  const li = Math.max(1, Math.floor(lb.length / 6))
  for (let i = 0; i < lb.length; i += li) {
    const x = pad.left + (i / (MAX_DATA_POINTS - 1)) * cw
    ctx.fillText(lb[i], x, height - 4)
  }
  if (lb.length > 1) {
    const lx = pad.left + ((lb.length - 1) / (MAX_DATA_POINTS - 1)) * cw
    ctx.fillText(lb[lb.length - 1], lx, height - 4)
  }

  /**
   * 绘制单条折线及渐变填充区域
   * @param data - 数据点数组
   * @param color - 线条颜色
   * @param fill - 渐变填充起始颜色
   */
  function drawLine(data: number[], color: string, fill: string) {
    if (data.length < 2 || !ctx) return
    
    // 1. 绘制底层发光背景（霓虹灯效果）
    ctx.shadowBlur = 8
    ctx.shadowColor = color
    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    
    const pts: Array<{ x: number; y: number }> = []
    for (let i = 0; i < data.length; i++) {
      const x = pad.left + (i / (MAX_DATA_POINTS - 1)) * cw
      const y = pad.top + ch - (data[i] / maxV) * ch
      pts.push({ x, y })
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    
    // 重置阴影，避免影响后续填充或者其他渲染
    ctx.shadowBlur = 0
    
    // 2. 绘制顶部核心实线
    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth = 2.5
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y)
    }
    ctx.stroke()

    // 3. 绘制平滑的渐变填充区域
    if (pts.length > 0) {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pad.top + ch)
      for (const p of pts) ctx.lineTo(p.x, p.y)
      ctx.lineTo(pts[pts.length - 1].x, pad.top + ch)
      ctx.closePath()
      const g = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch)
      g.addColorStop(0, fill)
      g.addColorStop(0.5, fill.replace('0.1', '0.05'))
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fill()
    }
  }

  // 绘制 QPS 折线（蓝色）
  drawLine(qd, 'rgba(96,165,250,0.9)', 'rgba(96,165,250,0.1)')
  // 绘制 TPS 折线（绿色）
  drawLine(td, 'rgba(52,211,153,0.9)', 'rgba(52,211,153,0.1)')
}

// 生命周期管理
onMounted(() => { startAutoRefresh() })
onBeforeUnmount(() => { stopAutoRefresh() })
// 监听连接状态变化，断开时停止刷新，重连时恢复
watch(() => props.isConnected, (c) => { c ? startAutoRefresh() : stopAutoRefresh() })

// 监听子选卡变化，重新启动对应的刷新逻辑
watch(activeSubTab, () => {
  startAutoRefresh()
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-background/30">
    <!-- 顶部工具栏：极致质感重构 -->
    <div class="flex items-center justify-between border-b border-border/30 px-6 py-4 bg-background/20 backdrop-blur-md">
      <div class="flex items-center gap-1 bg-muted/40 p-1 rounded-2xl border border-border/5">
        <button
          v-for="tab in subTabs"
          :key="tab.key"
          class="flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-black transition-all duration-300 select-none"
          :class="activeSubTab === tab.key
            ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 scale-105'
            : 'text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground'"
          @click="setSubTab(tab.key)"
        >
          <component :is="tab.icon" class="h-3.5 w-3.5" :class="{ 'opacity-100': activeSubTab === tab.key, 'opacity-40': activeSubTab !== tab.key }" />
          {{ tab.label }}
        </button>
      </div>
      <div class="flex items-center gap-4">
        <div class="flex flex-col items-end">
          <span class="text-[10px] font-black tracking-widest text-muted-foreground/30 uppercase">{{ currentTabLabel }}</span>
          <div class="flex items-center gap-1.5 min-w-[80px] justify-end">
            <template v-if="isLoading">
              <RefreshCw class="h-2.5 w-2.5 animate-spin text-primary" />
              <span class="text-[10px] font-bold text-primary/80">采集数据中</span>
            </template>
            <template v-else>
              <div class="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,1)]" />
              <span class="text-[10px] font-black text-muted-foreground/40 uppercase">Auto Sync On</span>
            </template>
          </div>
        </div>
        <div class="h-8 w-[1px] bg-border/20 mx-2" />
        <Button size="icon" variant="ghost" class="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary transition-all" @click="startAutoRefresh">
          <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isLoading }" />
        </Button>
      </div>
    </div>

    <!-- 仪表盘主内容区域 -->
    <div v-if="activeSubTab === 'dashboard'" class="flex-1 overflow-auto p-4 space-y-4">
      <div v-if="errorMessage" class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        {{ errorMessage }}
      </div>

      <div v-if="!currentStatus && !errorMessage" class="flex h-full items-center justify-center">
        <div class="text-center text-muted-foreground">
          <RefreshCw class="mx-auto h-8 w-8 animate-spin mb-2 opacity-50" />
          <p class="text-sm">正在获取服务器状态...</p>
        </div>
      </div>

      <template v-if="currentStatus">
        <!-- 顶部：核心指标卡片 (炫彩拟物化重构) -->
        <div class="grid grid-cols-5 gap-4">
          <div
            v-for="card in metricCards"
            :key="card.label"
            class="relative overflow-hidden group rounded-2xl border p-4 transition-all duration-500 hover:-translate-y-1 hover:shadow-2xl bg-card/40 backdrop-blur-xl"
            :class="[card.border, card.glow, { 'animate-pulse': card.isCritical }]"
          >
            <!-- 动态渐变背景 -->
            <div 
              class="absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
              :class="card.gradient"
            />
            
            <div class="relative flex items-center justify-between mb-4">
              <div class="p-2 rounded-xl bg-background/50 border border-border/10">
                <component :is="card.icon" class="h-5 w-5" :class="card.color" />
              </div>
              <span class="text-[10px] uppercase font-black tracking-tighter opacity-20 select-none group-hover:opacity-40 transition-opacity">
                {{ card.label.match(/\((.*?)\)/)?.[1] || card.label }}
              </span>
            </div>
            
            <div class="relative space-y-1">
              <div class="text-xs font-bold text-muted-foreground/70">{{ card.label.replace(/\(.*\)/, '').trim() }}</div>
              <div class="flex items-baseline gap-1">
                <span class="text-2xl font-black tracking-tight" :class="card.color">{{ card.value }}</span>
                <span v-if="card.label.includes('QPS') || card.label.includes('TPS')" class="text-[10px] font-bold opacity-30">UNIT/S</span>
              </div>
              <div class="text-[10px] text-muted-foreground/40 font-medium">{{ card.subtitle }}</div>
            </div>
          </div>
        </div>

        <!-- 中部：QPS/TPS 折线图 -->
        <!-- 中部：QPS/TPS 折线图 (霓虹控制台风格) -->
        <div class="rounded-2xl border border-border/30 bg-card/20 backdrop-blur-sm p-6 shadow-inner">
          <div class="flex items-center justify-between mb-6">
            <div class="space-y-1">
              <h3 class="text-sm font-black tracking-tight text-foreground/80 uppercase flex items-center gap-2">
                <div class="h-3 w-1 bg-primary rounded-full" />
                性能趋势分析 (Real-time Matrix)
              </h3>
              <p class="text-[10px] text-muted-foreground/50 font-medium">最近 5 分钟流量吞吐数据采样</p>
            </div>
            <div class="flex items-center gap-6">
              <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/5 border border-blue-500/10 transition-colors hover:bg-blue-500/10">
                <div class="h-1.5 w-3 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,1)]"></div>
                <span class="text-[10px] font-bold text-blue-400/80">查询 (QPS)</span>
              </div>
              <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10 transition-colors hover:bg-emerald-500/10">
                <div class="h-1.5 w-3 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,1)]"></div>
                <span class="text-[10px] font-bold text-emerald-400/80">事务 (TPS)</span>
              </div>
            </div>
          </div>
          <div class="relative">
            <canvas ref="chartCanvas" class="w-full" style="height: 240px;" />
          </div>
        </div>
      </template>
    </div>

    <!-- 进程列表 (会话进程监控) -->
    <div v-else-if="activeSubTab === 'processes'" class="flex-1 flex flex-col overflow-hidden px-6 pt-4">
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="p-2 rounded-xl bg-primary/10 text-primary shadow-sm">
            <Terminal class="h-5 w-5" />
          </div>
          <div>
            <h3 class="text-sm font-black tracking-tight uppercase">会话列表 (Session Matrix)</h3>
            <p class="text-[10px] text-muted-foreground/40 font-medium">当前活跃于本数据库服务的连接进程</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold px-3 py-1 rounded-full bg-muted border border-border/10 text-muted-foreground">
            {{ processes.length }} 个活跃会话
          </span>
        </div>
      </div>
      
      <div class="flex-1 border border-border/10 rounded-2xl overflow-hidden bg-muted/5">
        <ScrollArea class="h-full">
          <table class="w-full text-left border-collapse">
            <thead class="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/20">
              <tr class="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest h-12">
                <th class="px-4 w-20">ID</th>
                <th class="px-4 w-32">用户</th>
                <th class="px-4 w-40">主机</th>
                <th class="px-4 w-32">数据库</th>
                <th class="px-4 w-24">命令</th>
                <th class="px-4 w-20">耗时(s)</th>
                <th class="px-4">状态/详情</th>
                <th class="px-4 w-16 text-center">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/5">
              <tr v-for="p in processes" :key="p.id" class="text-xs hover:bg-primary/[0.03] transition-colors group h-14">
                <td class="px-4 font-mono font-bold text-primary/60">#{{ p.id }}</td>
                <td class="px-4 font-medium">{{ p.user }}</td>
                <td class="px-4 font-mono text-[10px] opacity-60">{{ p.host }}</td>
                <td class="px-4">
                  <span v-if="p.db" class="px-2 py-0.5 rounded bg-muted text-[10px] font-bold border border-border/10">{{ p.db }}</span>
                  <span v-else class="text-muted-foreground/30 italic">none</span>
                </td>
                <td class="px-4 capitalize text-amber-500 font-bold opacity-80">{{ p.command }}</td>
                <td class="px-4 font-mono font-bold" :class="p.time > 10 ? 'text-rose-500' : 'text-emerald-500'">{{ p.time }}</td>
                <td class="px-4">
                  <div class="flex flex-col gap-0.5 max-w-sm">
                    <span class="text-[10px] font-bold text-muted-foreground/80">{{ p.state || 'idle' }}</span>
                    <span class="truncate text-[10px] font-mono opacity-40 group-hover:opacity-100 transition-opacity">{{ p.info }}</span>
                  </div>
                </td>
                <td class="px-4 text-center">
                  <Button variant="ghost" size="icon" class="h-8 w-8 rounded-xl text-muted-foreground/30 hover:bg-rose-500/10 hover:text-rose-500" @click="confirmKillProcess(p.id)">
                    <Trash2 class="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="processes.length === 0" class="flex flex-col items-center justify-center h-64 opacity-20">
            <Shield class="h-12 w-12 mb-3" />
            <p class="text-xs font-black uppercase tracking-widest">No Active Sessions</p>
          </div>
        </ScrollArea>
      </div>
    </div>

    <!-- 服务器变量 (变量配置中心) -->
    <div v-else-if="activeSubTab === 'variables'" class="flex-1 flex flex-col overflow-hidden px-6 pt-4">
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="p-2 rounded-xl bg-primary/10 text-primary shadow-sm">
            <Settings class="h-5 w-5" />
          </div>
          <div>
            <h3 class="text-sm font-black tracking-tight uppercase">全局变量 (Global Vars)</h3>
            <p class="text-[10px] text-muted-foreground/40 font-medium">查看服务器运行时配置参数</p>
          </div>
        </div>
        <div class="relative w-64">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30" />
          <Input v-model="variableSearch" placeholder="搜索变量名..." class="pl-9 h-9 text-xs rounded-xl border-border/20 bg-muted/20" />
        </div>
      </div>

      <div class="flex-1 border border-border/10 rounded-2xl overflow-hidden bg-muted/5">
        <ScrollArea class="h-full">
          <table class="w-full text-left border-collapse">
            <thead class="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/20">
              <tr class="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest h-12">
                <th class="px-6">变量名 (Variable Name)</th>
                <th class="px-6">当前值 (Value)</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/5">
              <tr v-for="v in variables.filter(item => !variableSearch || item.name.toLowerCase().includes(variableSearch.toLowerCase()))" :key="v.name" class="group hover:bg-primary/[0.03] transition-colors h-12">
                <td class="px-6 text-xs font-mono font-bold text-foreground/80">{{ v.name }}</td>
                <td class="px-6 text-xs font-mono text-primary/80 group-hover:text-primary transition-colors">{{ v.value }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="variables.length === 0" class="flex flex-col items-center justify-center h-64 opacity-20">
            <Info class="h-12 w-12 mb-3" />
            <p class="text-xs font-black uppercase tracking-widest">Loading Variables...</p>
          </div>
        </ScrollArea>
      </div>
    </div>

    <!-- 终止确认对话框 -->
    <ConfirmDialog
      v-model:open="showKillConfirm"
      title="强制终止确认"
      :description="`确定要强制终止进程 ID: ${pidToKill} 吗？这可能会中断正在执行的工作流。`"
      confirm-label="强制终止"
      cancel-label="取消"
      variant="destructive"
      @confirm="handleKillProcess"
    />
  </div>
</template>
