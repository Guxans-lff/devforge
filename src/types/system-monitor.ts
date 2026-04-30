/**
 * 系统监控类型定义
 * 
 * 对应后端 system_monitor.rs 中的数据结构
 */

/** 系统信息 */
export interface SystemInfo {
  cpuUsage: number
  cpuCores: number[]
  memoryTotal: number
  memoryUsed: number
  memoryAvailable: number
  swapTotal: number
  swapUsed: number
  disks: DiskInfo[]
  networks: NetworkInfo[]
  systemName: string
  osVersion: string
  hostName: string
  uptime: number
}

/** 磁盘信息 */
export interface DiskInfo {
  name: string
  mountPoint: string
  totalSpace: number
  availableSpace: number
  usedSpace: number
  fileSystem: string
  isRemovable: boolean
}

/** 网络信息 */
export interface NetworkInfo {
  name: string
  received: number
  transmitted: number
  receivedPackets: number
  transmittedPackets: number
}

/** 进程信息 */
export interface ProcessInfo {
  pid: number
  name: string
  cpuUsage: number
  memory: number
  memoryPercent: number
  status: string
  runTime: number
}

/** Ping 测试结果 */
export interface PingResult {
  host: string
  success: boolean
  latencyMs: number | null
  error: string | null
}

/** 历史数据点 */
export interface HistoryPoint {
  timestamp: number
  value: number
}

/** CPU 历史数据 */
export interface CpuHistory {
  global: HistoryPoint[]
  cores: Map<number, HistoryPoint[]>
}

/** 内存历史数据 */
export interface MemoryHistory {
  used: HistoryPoint[]
  available: HistoryPoint[]
}

/** 网络速率历史 */
export interface NetworkRateHistory {
  name: string
  receivedRate: HistoryPoint[]
  transmittedRate: HistoryPoint[]
}

/** 进程排序字段 */
export type ProcessSortField = 'pid' | 'name' | 'cpuUsage' | 'memory' | 'memoryPercent' | 'status' | 'runTime'

/** 进程排序方向 */
export type SortDirection = 'asc' | 'desc'

/** 进程过滤条件 */
export interface ProcessFilter {
  search: string
  sortField: ProcessSortField
  sortDirection: SortDirection
}