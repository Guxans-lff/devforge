import { invokeCommand } from '@/api/base'

/** 创建本地 Shell 会话 */
export function localShellSpawn(sessionId: string, cols: number, rows: number): Promise<void> {
  return invokeCommand('local_shell_spawn', { sessionId, cols, rows })
}

/** 向本地 Shell 发送输入 */
export function localShellWrite(sessionId: string, data: string): Promise<void> {
  return invokeCommand('local_shell_write', { sessionId, data })
}

/** 调整本地 Shell 终端大小 */
export function localShellResize(sessionId: string, cols: number, rows: number): Promise<void> {
  return invokeCommand('local_shell_resize', { sessionId, cols, rows })
}

/** 关闭本地 Shell 会话 */
export function localShellClose(sessionId: string): Promise<void> {
  return invokeCommand('local_shell_close', { sessionId })
}
