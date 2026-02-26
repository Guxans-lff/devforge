import { invoke } from '@tauri-apps/api/core'
import type { TunnelOpenParams, TunnelInfo } from '@/types/tunnel'

export function tunnelOpen(params: TunnelOpenParams): Promise<TunnelInfo> {
  return invoke('tunnel_open', { params })
}

export function tunnelClose(tunnelId: string): Promise<boolean> {
  return invoke('tunnel_close', { tunnelId })
}

export function tunnelList(): Promise<TunnelInfo[]> {
  return invoke('tunnel_list')
}
