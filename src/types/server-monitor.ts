/** 磁盘分区信息 */
export interface DiskInfo {
  filesystem: string
  mountPoint: string
  totalMb: number
  usedMb: number
  availableMb: number
  usePercent: number
}

/** 网络接口信息 */
export interface NetworkInterface {
  name: string
  rxBytes: number
  txBytes: number
}

/** 服务器采集指标（单次采样） */
export interface ServerMetrics {
  /** CPU 使用率（百分比） */
  cpuUsage: number
  /** CPU 核心数 */
  cpuCores: number
  /** 总内存（MB） */
  memoryTotal: number
  /** 已用内存（MB） */
  memoryUsed: number
  /** 可用内存（MB） */
  memoryAvailable: number
  /** Swap 总量（MB） */
  swapTotal: number
  /** Swap 已用（MB） */
  swapUsed: number
  /** 磁盘分区列表 */
  disks: DiskInfo[]
  /** 网络接口列表 */
  network: NetworkInterface[]
  /** 1/5/15 分钟负载均值 */
  loadAvg: [number, number, number]
  /** 系统运行时间（秒） */
  uptimeSeconds: number
  /** 采集时间戳（毫秒） */
  timestamp: number
}

/** 网络速率（计算得出） */
export interface NetworkRate {
  name: string
  /** 接收速率（bytes/s） */
  rxRate: number
  /** 发送速率（bytes/s） */
  txRate: number
}

/** 带历史记录的指标快照 */
export interface MetricsSnapshot extends ServerMetrics {
  /** 网络速率（与上次采样的差值） */
  networkRates: NetworkRate[]
}
