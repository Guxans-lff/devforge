/**
 * 服务器监控 composable
 * 定时轮询采集服务器指标，维护环形缓冲区存储历史数据
 */
import { ref, computed, onBeforeUnmount } from 'vue'
import { sshCollectMetrics } from '@/api/server-monitor'
import type {
  ServerMetrics,
  MetricsSnapshot,
  NetworkRate,
} from '@/types/server-monitor'

/** 环形缓冲区最大容量 */
const MAX_HISTORY = 120

export function useServerMonitor(connectionId: string) {
  // ── 状态 ──────────────────────────────────────────────────────

  /** 历史数据（环形缓冲区） */
  const history = ref<MetricsSnapshot[]>([])

  /** 最新一次采样 */
  const latest = computed<MetricsSnapshot | null>(() =>
    history.value.length > 0 ? history.value[history.value.length - 1]! : null,
  )

  /** 是否正在采集 */
  const running = ref(false)

  /** 是否正在加载首次数据 */
  const loading = ref(false)

  /** 采集错误信息 */
  const error = ref<string | null>(null)

  /** 连续错误计数 */
  let errorCount = 0

  /** 轮询间隔（毫秒） */
  const interval = ref(3000)

  /** 轮询定时器 */
  let timer: ReturnType<typeof setInterval> | null = null

  /** 上一次网络数据（用于计算速率） */
  let prevNetwork: Map<string, { rx: number; tx: number; ts: number }> = new Map()

  // ── 采集逻辑 ─────────────────────────────────────────────────

  async function collect() {
    try {
      const metrics = await sshCollectMetrics(connectionId)
      error.value = null
      errorCount = 0

      const snapshot = enrichMetrics(metrics)
      pushHistory(snapshot)
    } catch (e: unknown) {
      errorCount++
      error.value = e instanceof Error ? e.message : String(e)

      // 连续 5 次错误自动停止
      if (errorCount >= 5) {
        stop()
      }
    }
  }

  /** 计算网络速率，生成 MetricsSnapshot */
  function enrichMetrics(metrics: ServerMetrics): MetricsSnapshot {
    const networkRates: NetworkRate[] = []

    for (const iface of metrics.network) {
      const prev = prevNetwork.get(iface.name)
      if (prev) {
        const dtSec = (metrics.timestamp - prev.ts) / 1000
        if (dtSec > 0) {
          networkRates.push({
            name: iface.name,
            rxRate: Math.max(0, (iface.rxBytes - prev.rx) / dtSec),
            txRate: Math.max(0, (iface.txBytes - prev.tx) / dtSec),
          })
        }
      }
      prevNetwork.set(iface.name, {
        rx: iface.rxBytes,
        tx: iface.txBytes,
        ts: metrics.timestamp,
      })
    }

    return { ...metrics, networkRates }
  }

  /** 推入环形缓冲区 */
  function pushHistory(snapshot: MetricsSnapshot) {
    const h = [...history.value, snapshot]
    if (h.length > MAX_HISTORY) {
      h.splice(0, h.length - MAX_HISTORY)
    }
    history.value = h
  }

  // ── 控制方法 ─────────────────────────────────────────────────

  async function start() {
    if (running.value) return
    running.value = true
    loading.value = history.value.length === 0
    error.value = null
    errorCount = 0

    // 立即采集一次
    await collect()
    loading.value = false

    // 启动定时轮询
    timer = setInterval(collect, interval.value)
  }

  function stop() {
    running.value = false
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  /** 修改采集间隔（毫秒） */
  function setInterval_(ms: number) {
    interval.value = Math.max(1000, ms)
    if (running.value) {
      stop()
      start()
    }
  }

  /** 清空历史数据 */
  function clearHistory() {
    history.value = []
    prevNetwork.clear()
  }

  // ── 便捷计算属性 ─────────────────────────────────────────────

  /** CPU 使用率历史 */
  const cpuHistory = computed(() =>
    history.value.map(s => ({ time: s.timestamp, value: s.cpuUsage })),
  )

  /** 内存使用率历史 */
  const memoryHistory = computed(() =>
    history.value.map(s => ({
      time: s.timestamp,
      used: s.memoryUsed,
      total: s.memoryTotal,
      percent: s.memoryTotal > 0 ? (s.memoryUsed / s.memoryTotal) * 100 : 0,
    })),
  )

  /** 网络速率历史（第一个非 lo 接口） */
  const networkHistory = computed(() =>
    history.value.map(s => {
      const rate = s.networkRates[0]
      return {
        time: s.timestamp,
        rxRate: rate?.rxRate ?? 0,
        txRate: rate?.txRate ?? 0,
      }
    }),
  )

  // ── 生命周期 ─────────────────────────────────────────────────

  onBeforeUnmount(() => {
    stop()
  })

  return {
    // 状态
    history,
    latest,
    running,
    loading,
    error,
    interval,
    // 计算属性
    cpuHistory,
    memoryHistory,
    networkHistory,
    // 方法
    start,
    stop,
    setInterval: setInterval_,
    clearHistory,
  }
}
