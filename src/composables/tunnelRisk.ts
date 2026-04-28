export type TunnelRiskLevel = 'low' | 'medium' | 'high'

export interface TunnelRiskInput {
  sshHost: string
  localPort: number
  remoteHost: string
  remotePort: number
  existingLocalPorts?: number[]
}

export interface TunnelRiskSummary {
  level: TunnelRiskLevel
  title: string
  message: string
  warnings: string[]
  blocked: boolean
}

const privilegedPortLimit = 1024

export function summarizeTunnelRisk(input: TunnelRiskInput): TunnelRiskSummary {
  const warnings: string[] = []
  const localPort = Number(input.localPort)
  const remotePort = Number(input.remotePort)

  if (!Number.isInteger(localPort) || localPort < 0 || localPort > 65535) {
    warnings.push('本地端口必须在 0-65535 之间。')
  }
  if (!Number.isInteger(remotePort) || remotePort <= 0 || remotePort > 65535) {
    warnings.push('远程端口必须在 1-65535 之间。')
  }
  if (localPort > 0 && localPort < privilegedPortLimit) {
    warnings.push('本地端口低于 1024，可能需要管理员权限或与系统服务冲突。')
  }
  if (input.existingLocalPorts?.includes(localPort)) {
    warnings.push(`本地端口 ${localPort} 已有活跃隧道使用。`)
  }
  if (input.remoteHost === '0.0.0.0' || input.remoteHost === '::') {
    warnings.push('远程地址指向通配监听地址，建议改成明确主机名或 IP。')
  }
  if (input.sshHost === input.remoteHost && remotePort === 22) {
    warnings.push('目标指向 SSH 主机 22 端口，通常不需要再通过 SSH 隧道转发。')
  }

  const blocked = warnings.some((item) => item.includes('必须在') || item.includes('已有活跃隧道'))
  const level: TunnelRiskLevel = blocked ? 'high' : warnings.length > 0 ? 'medium' : 'low'

  return {
    level,
    title: blocked ? '隧道配置不可用' : '确认打开 SSH 隧道',
    message: [
      `${input.sshHost} -> 127.0.0.1:${localPort || '随机端口'} -> ${input.remoteHost}:${remotePort}`,
      ...warnings,
    ].join('\n'),
    warnings,
    blocked,
  }
}

export function confirmTunnelRisk(input: TunnelRiskInput): boolean {
  const risk = summarizeTunnelRisk(input)
  if (risk.blocked) {
    window.alert(`${risk.title}\n\n${risk.message}`)
    return false
  }
  if (risk.level === 'low') return true
  return window.confirm(`${risk.title}\n\n${risk.message}`)
}
