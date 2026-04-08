import { invokeCommand } from '@/api/base'
import type { ServerMetrics } from '@/types/server-monitor'

/** 采集远程服务器系统指标 */
export function sshCollectMetrics(connectionId: string): Promise<ServerMetrics> {
  return invokeCommand<ServerMetrics>('ssh_collect_metrics', { connectionId })
}
