import { invokeCommand } from '@/api/base'
import { useLogStore } from '@/stores/log'
import { i18n } from '@/locales'
import type { SessionInfo } from '@/types/terminal'
import type { TestResult } from '@/api/connection'

export async function sshConnect(
  connectionId: string,
  cols: number,
  rows: number,
): Promise<SessionInfo> {
  const logStore = useLogStore()
  logStore.info('SSH', (i18n.global as any).t('log.ssh.connecting', { id: connectionId }))
  const session = await invokeCommand<SessionInfo>('ssh_connect', { connectionId, cols, rows }, { source: 'SSH' })
  logStore.info('SSH', (i18n.global as any).t('log.ssh.connected', { id: session.sessionId }))
  return session
}

export function sshDisconnect(sessionId: string): Promise<boolean> {
  return invokeCommand('ssh_disconnect', { sessionId }, { source: 'SSH' })
}

export function sshSendData(sessionId: string, data: string): Promise<void> {
  return invokeCommand('ssh_send_data', { sessionId, data }, { source: 'SSH', silent: true })
}

export function sshResize(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invokeCommand('ssh_resize', { sessionId, cols, rows }, { source: 'SSH', silent: true })
}

/** 流控 ACK：通知后端前端 xterm.js 已处理的累计字节数 */
export function sshFlowAck(sessionId: string, bytes: number): Promise<void> {
  return invokeCommand('ssh_flow_ack', { sessionId, bytes }, { source: 'SSH', silent: true })
}

/** 获取终端当前工作目录（通过后端 exec channel，不在终端中执行命令） */
export function sshGetCwd(sessionId: string): Promise<string> {
  return invokeCommand('ssh_get_cwd', { sessionId }, { source: 'SSH' })
}

export function sshTestConnection(id: string): Promise<TestResult> {
  return invokeCommand('ssh_test_connection', { id }, { source: 'SSH' })
}

export function sshTestConnectionParams(params: {
  host: string
  port: number
  username: string
  password: string
  authMethod?: string
  privateKeyPath?: string
  passphrase?: string
}): Promise<TestResult> {
  return invokeCommand('ssh_test_connection_params', params, { source: 'SSH' })
}

export async function sshExecCommand(connectionId: string, command: string): Promise<string> {
  const logStore = useLogStore()
  logStore.debug('SSH', (i18n.global as any).t('log.ssh.executing', { cmd: command.slice(0, 50) + (command.length > 50 ? '...' : '') }))
  const output = await invokeCommand<string>('ssh_exec_command', { connectionId, command }, { source: 'SSH' })
  logStore.debug('SSH', (i18n.global as any).t('log.ssh.executed', { len: output.length }))
  return output
}
