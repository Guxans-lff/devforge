/**
 * 系统监控状态管理
 * 
 * 管理系统信息、进程列表、历史数据等全局状态
 */

import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import type {
  SystemInfo,
  ProcessInfo,
  PingResult,
  HistoryPoint,
  ProcessFilter,
  ProcessSortField,
  SortDirection,
} from '@/types/system-monitor'
import {
  getSystemInfo,
  getProcesses,
  killProcess,
  pingHost,
} from '@/api/system-monitor'

/** 历史数据最大保留点数 */
const MAX_HISTORY_POINTS = 60

/** 刷新间隔（毫秒） */
const REFRESH_INTERVAL = 2000

export const useSystemMonitorStore = defineStore('system-monitor', () => {
  // ─────────────────────── 系统信息状态 ───────────────────────

  const systemInfo = shallowRef<SystemInfo | null>(null)
  const systemInfoLoading = ref(false)
  const lastUpdated = ref<number>(0)

  // CPU 历史数据
  const cpuHistoryGlobal = ref<HistoryPoint[]>([])
  const cpuHistoryCores = ref<Map<number, HistoryPoint[]>>(new Map())

  // 内存历史数据
  const memoryHistoryUsed = ref<HistoryPoint[]>([])
  const memoryHistoryAvailable = ref<HistoryPoint[]>([])

  // 网络速率计算
  const lastNetworkData = ref<Map<string, { received: number; transmitted: number }>>(new Map())

  // ─────────────────────── 进程列表状态 ───────────────────────

  const processes = ref<ProcessInfo[]>([])
  const processesLoading = ref(false)
  const processFilter = ref<ProcessFilter>({
    search: '',
    sortField: 'cpuUsage',
    sortDirection: 'desc',
  })

  /** 过滤并排序后的进程列表 */
  const filteredProcesses = computed(() => {
    let result = [...processes.value]

    // 搜索过滤
    if (processFilter.value.search) {
      const search = processFilter.value.search.toLowerCase()
      result = result.filter(p =>
        p.name.toLowerCase().includes(search) ||
        p.pid.toString().includes(search)
      )
    }

    // 排序
    const { sortField, sortDirection } = processFilter.value
    result.sort((a, b) => {
      let aVal = a[sortField]
      let bVal = b[sortField]

      // 字符串比较
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }

      // 数值比较
      if (sortDirection === 'asc') {
        return (aVal as number) - (bVal as number)
      }
      return (bVal as number) - (aVal as number)
    })

    return result
  })

  // ─────────────────────── 网络测速状态 ───────────────────────

  const pingResults = ref<PingResult[]>([])
  const pingLoading = ref(false)

  // ─────────────────────── 定时刷新控制 ───────────────────────

  let refreshTimer: ReturnType<typeof setInterval> | null = null
  const isAutoRefresh = ref(false)

  // ─────────────────────── 系统信息方法 ───────────────────────

  /** 加载系统信息 */
  async function loadSystemInfo(): Promise<void> {
    systemInfoLoading.value = true
    try {
      const info = await getSystemInfo()
      
      // 更新历史数据
      const now = Date.now()
      
      // CPU 全局历史
      cpuHistoryGlobal.value.push({ timestamp: now, value: info.cpuUsage })
      if (cpuHistoryGlobal.value.length > MAX_HISTORY_POINTS) {
        cpuHistoryGlobal.value.shift()
      }

      // CPU 每核历史
      info.cpuCores.forEach((usage, index) => {
        if (!cpuHistoryCores.value.has(index)) {
          cpuHistoryCores.value.set(index, [])
        }
        const coreHistory = cpuHistoryCores.value.get(index)!
        coreHistory.push({ timestamp: now, value: usage })
        if (coreHistory.length > MAX_HISTORY_POINTS) {
          coreHistory.shift()
        }
      })

      // 内存历史
      memoryHistoryUsed.value.push({ timestamp: now, value: info.memoryUsed })
      memoryHistoryAvailable.value.push({ timestamp: now, value: info.memoryAvailable })
      if (memoryHistoryUsed.value.length > MAX_HISTORY_POINTS) {
        memoryHistoryUsed.value.shift()
        memoryHistoryAvailable.value.shift()
      }

      systemInfo.value = info
      lastUpdated.value = now
    } catch (error) {
      console.error('Failed to load system info:', error)
    } finally {
      systemInfoLoading.value = false
    }
  }

  // ─────────────────────── 进程管理方法 ───────────────────────

  /** 加载进程列表 */
  async function loadProcesses(): Promise<void> {
    processesLoading.value = true
    try {
      processes.value = await getProcesses()
    } catch (error) {
      console.error('Failed to load processes:', error)
    } finally {
      processesLoading.value = false
    }
  }

  /** 终止进程 */
  async function terminateProcess(pid: number): Promise<boolean> {
    try {
      const success = await killProcess(pid)
      if (success) {
        // 从列表中移除
        processes.value = processes.value.filter(p => p.pid !== pid)
      }
      return success
    } catch (error) {
      console.error('Failed to kill process:', error)
      return false
    }
  }

  /** 设置进程过滤条件 */
  function setProcessFilter(filter: Partial<ProcessFilter>): void {
    processFilter.value = { ...processFilter.value, ...filter }
  }

  /** 设置排序字段 */
  function setProcessSort(field: ProcessSortField): void {
    if (processFilter.value.sortField === field) {
      // 切换排序方向
      processFilter.value.sortDirection =
        processFilter.value.sortDirection === 'asc' ? 'desc' : 'asc'
    } else {
      processFilter.value.sortField = field
      processFilter.value.sortDirection = 'desc'
    }
  }

  // ─────────────────────── 网络测速方法 ───────────────────────

  /** Ping 测试 */
  async function testPing(host: string): Promise<PingResult> {
    pingLoading.value = true
    try {
      const result = await pingHost(host)
      pingResults.value.unshift(result)
      // 保留最近 20 条记录
      if (pingResults.value.length > 20) {
        pingResults.value.pop()
      }
      return result
    } finally {
      pingLoading.value = false
    }
  }

  /** 清空 Ping 历史 */
  function clearPingHistory(): void {
    pingResults.value = []
  }

  // ─────────────────────── 自动刷新控制 ───────────────────────

  /** 启动自动刷新 */
  function startAutoRefresh(): void {
    if (refreshTimer) return
    
    isAutoRefresh.value = true
    refreshTimer = setInterval(async () => {
      await Promise.all([
        loadSystemInfo(),
        loadProcesses(),
      ])
    }, REFRESH_INTERVAL)
  }

  /** 停止自动刷新 */
  function stopAutoRefresh(): void {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
    isAutoRefresh.value = false
  }

  /** 切换自动刷新 */
  function toggleAutoRefresh(): void {
    if (isAutoRefresh.value) {
      stopAutoRefresh()
    } else {
      startAutoRefresh()
    }
  }

  // ─────────────────────── 初始化与清理 ───────────────────────

  /** 初始化：加载数据并启动自动刷新 */
  async function initialize(): Promise<void> {
    await Promise.all([
      loadSystemInfo(),
      loadProcesses(),
    ])
    startAutoRefresh()
  }

  /** 清理：停止自动刷新 */
  function cleanup(): void {
    stopAutoRefresh()
  }

  return {
    // 系统信息
    systemInfo,
    systemInfoLoading,
    lastUpdated,
    cpuHistoryGlobal,
    cpuHistoryCores,
    memoryHistoryUsed,
    memoryHistoryAvailable,
    loadSystemInfo,

    // 进程管理
    processes,
    processesLoading,
    processFilter,
    filteredProcesses,
    loadProcesses,
    terminateProcess,
    setProcessFilter,
    setProcessSort,

    // 网络测速
    pingResults,
    pingLoading,
    testPing,
    clearPingHistory,

    // 自动刷新
    isAutoRefresh,
    startAutoRefresh,
    stopAutoRefresh,
    toggleAutoRefresh,

    // 生命周期
    initialize,
    cleanup,
  }
})