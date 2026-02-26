export interface AiConfig {
  provider: string
  model: string
  endpoint: string
  maxTokens: number
}

export interface AiResult {
  content: string
  model: string
  promptTokens: number
  completionTokens: number
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
  timestamp: number
  tokens?: number
}
