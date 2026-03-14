import { invokeCommand } from '@/api/base'
import type { TunnelOpenParams, TunnelInfo } from '@/types/tunnel'

export function tunnelOpen(params: TunnelOpenParams): Promise<TunnelInfo> {
  return invokeCommand('tunnel_open', { params })
}

export function tunnelClose(tunnelId: string): Promise<boolean> {
  return invokeCommand('tunnel_close', { tunnelId })
}

export function tunnelList(): Promise<TunnelInfo[]> {
  return invokeCommand('tunnel_list')
}
