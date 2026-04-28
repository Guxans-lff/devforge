import type { AiSession, ModelConfig, ProviderConfig } from '@/types/ai'
import type { Logger } from '@/utils/logger'
import type { useAiChatStore } from '@/stores/ai-chat'

type AiChatStore = ReturnType<typeof useAiChatStore>

function stripFileBlocks(content: string): string {
  return content.replace(/<file\b[^>]*>[\s\S]*?<\/file>/g, '').trim()
}

export function buildSessionTitle(content: string): string {
  return stripFileBlocks(content).slice(0, 50) || '新对话'
}

export function saveNewSessionShellIfMissing(params: {
  store: AiChatStore
  sessionId: string
  titleSource: string
  provider: ProviderConfig
  model: ModelConfig
  log: Logger
  goal?: string
}): void {
  const { store, sessionId, titleSource, provider, model, log, goal } = params
  if (store.sessions.some(session => session.id === sessionId)) return

  const now = Date.now()
  store.saveSession({
    id: sessionId,
    title: buildSessionTitle(titleSource),
    providerId: provider.id,
    model: model.id,
    messageCount: 0,
    totalTokens: 0,
    estimatedCost: 0,
    createdAt: now,
    updatedAt: now,
    goal: goal || buildSessionTitle(titleSource),
    status: 'idle',
  }).catch(error => log.warn('eager_save_session_failed', { sessionId }, error))
}

export function saveFinalSession(params: {
  store: AiChatStore
  sessionId: string
  titleSource: string
  provider: ProviderConfig
  model: ModelConfig
  systemPrompt?: string
  messageCount: number
  totalTokens: number
  createdAt: number
  workDir?: string
  log: Logger
  status?: AiSession['status']
  lastCompactSummary?: string
}): void {
  const {
    store,
    sessionId,
    titleSource,
    provider,
    model,
    systemPrompt,
    messageCount,
    totalTokens,
    createdAt,
    workDir,
    log,
    status,
    lastCompactSummary,
  } = params

  const existing = store.sessions.find(s => s.id === sessionId)
  const session: AiSession = {
    id: sessionId,
    title: buildSessionTitle(titleSource),
    providerId: provider.id,
    model: model.id,
    systemPrompt,
    messageCount,
    totalTokens,
    estimatedCost: 0,
    createdAt,
    updatedAt: Date.now(),
    workDir: workDir || undefined,
    goal: existing?.goal || buildSessionTitle(titleSource),
    status: status ?? existing?.status ?? 'idle',
    lastCompactSummary: lastCompactSummary ?? existing?.lastCompactSummary,
  }

  store.saveSession(session).catch(error => log.warn('save_session_failed', { sessionId }, error))
}
