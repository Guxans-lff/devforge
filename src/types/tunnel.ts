export interface TunnelOpenParams {
  sshHost: string
  sshPort: number
  sshUsername: string
  sshPassword?: string
  authMethod?: string
  privateKeyPath?: string
  passphrase?: string
  localPort: number
  remoteHost: string
  remotePort: number
}

export interface TunnelInfo {
  tunnelId: string
  localPort: number
  remoteHost: string
  remotePort: number
  status: string
}
