export type SftpErrorKind =
  | 'network'
  | 'auth'
  | 'permission'
  | 'no_space'
  | 'path_not_found'
  | 'conflict'
  | 'cancelled'
  | 'unknown'

export interface ClassifiedSftpError {
  kind: SftpErrorKind
  message: string
  retryable: boolean
  action: 'retry' | 'reconnect' | 'change_path' | 'check_permission' | 'free_space' | 'resolve_conflict' | 'none'
}

export function classifySftpError(error: unknown): ClassifiedSftpError {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const lower = message.toLowerCase()

  if (/cancel|aborted|cancelled|用户取消/.test(lower)) {
    return { kind: 'cancelled', message, retryable: false, action: 'none' }
  }
  if (/auth|unauthorized|permission denied \(publickey\)|invalid key|password|认证|鉴权/.test(lower)) {
    return { kind: 'auth', message, retryable: false, action: 'reconnect' }
  }
  if (/permission denied|access denied|operation not permitted|权限/.test(lower)) {
    return { kind: 'permission', message, retryable: false, action: 'check_permission' }
  }
  if (/no space|disk full|quota exceeded|空间不足/.test(lower)) {
    return { kind: 'no_space', message, retryable: false, action: 'free_space' }
  }
  if (/not found|no such file|no such directory|path.*missing|不存在/.test(lower)) {
    return { kind: 'path_not_found', message, retryable: false, action: 'change_path' }
  }
  if (/already exists|file exists|conflict|冲突|已存在/.test(lower)) {
    return { kind: 'conflict', message, retryable: false, action: 'resolve_conflict' }
  }
  if (/network|connection|timeout|timed out|eof|reset|broken pipe|closed|连接|超时|断开/.test(lower)) {
    return { kind: 'network', message, retryable: true, action: 'reconnect' }
  }

  return { kind: 'unknown', message, retryable: true, action: 'retry' }
}

export function formatSftpError(error: unknown): string {
  const classified = classifySftpError(error)
  const actionHint: Record<ClassifiedSftpError['action'], string> = {
    retry: '可重试操作',
    reconnect: '建议重新连接后重试',
    change_path: '请检查路径后重试',
    check_permission: '请检查远程权限',
    free_space: '请释放磁盘空间后重试',
    resolve_conflict: '请处理同名文件冲突',
    none: '',
  }
  const hint = actionHint[classified.action]
  return hint ? `${classified.message}（${hint}）` : classified.message
}
