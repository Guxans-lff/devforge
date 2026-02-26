export interface SessionInfo {
  sessionId: string
  connectionId: string
  connectedAt: number
}

export interface TerminalSession {
  sessionId: string
  connectionId: string
  connectionName: string
  connected: boolean
}
