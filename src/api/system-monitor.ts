/**
 * 系统监控 API 封装
 * 
 * 调用后端 system_monitor.rs 中的 Tauri 命令
 */
import { invokeCommand } from './base'
import type { SystemInfo, ProcessInfo, PingResult } from '@/types/system-monitor'

/** 获取系统信息（CPU、内存、磁盘、网络） */
export function getSystemInfo(): Promise<SystemInfo> {
  return invokeCommand('get_system_info')
}

/** 获取进程列表 */
export function getProcesses(): Promise<ProcessInfo[]> {
  return invokeCommand('get_processes')
}

/** 终止进程 */
export function killProcess(pid: number): Promise<boolean> {
  return invokeCommand('kill_process', { pid })
}

/** Ping 测试 */
export function pingHost(host: string): Promise<PingResult> {
  return invokeCommand('ping_host', { host })
}