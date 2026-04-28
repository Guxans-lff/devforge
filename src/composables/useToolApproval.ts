/**
 * AI 工具审批流。
 *
 * 按 sessionId 隔离待审批请求、信任集合和权限模式，避免多会话互相串扰。
 */

import { computed, ref, watch } from 'vue'
import { getToolRiskLevel, isAutoAllowedByMode, isDeniedByMode, type ToolRiskLevel } from '@/composables/ai/toolRisk'
import { createLogger } from '@/utils/logger'

const log = createLogger('ai.approval')

export type ApprovalToolName =
  | 'read_file'
  | 'list_files'
  | 'list_directory'
  | 'search_files'
  | 'read_tool_result'
  | 'write_file'
  | 'edit_file'
  | 'delete_file'
  | 'bash'
  | 'web_fetch'
  | 'web_search'
  | 'db_execute'
  | 'db_migration'

export type ApprovalDecision = 'allow' | 'trust' | 'deny'

/**
 * 兼容旧 UI 的三态审批模式。
 */
export type ApprovalMode = 'ask' | 'auto' | 'deny'

/**
 * 文档要求的完整权限分层。
 */
export type PermissionMode =
  | 'default'
  | 'plan'
  | 'accept_edits'
  | 'read_only'
  | 'safe_auto'
  | 'dangerous_bypass'

export interface PendingApproval {
  toolName: ApprovalToolName
  target: string
  targetLabel: string
  preview: string
  oldPreview?: string
  warning?: string
  requiresDoubleConfirm?: boolean
  trustKey: string
  resolve: (decision: ApprovalDecision) => void
}

interface SessionApprovalState {
  mode: ApprovalMode
  permissionMode: PermissionMode
  pending: PendingApproval | null
  timer: ReturnType<typeof setTimeout> | null
}

const sessionStates = ref<Map<string, SessionApprovalState>>(new Map())
const activeSessionId = ref<string>('')

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000
const STORAGE_KEY = 'ai.trustedKeysBySession'
const LEGACY_STORAGE_KEY = 'ai.trustedPaths'
const trustedKeysBySession = ref<Map<string, Set<string>>>(new Map())

function getOrCreateState(sessionId: string): SessionApprovalState {
  if (!sessionStates.value.has(sessionId)) {
    sessionStates.value.set(sessionId, {
      mode: 'ask',
      permissionMode: 'default',
      pending: null,
      timer: null,
    })
  }
  return sessionStates.value.get(sessionId)!
}

function cloneSessionStates(): void {
  sessionStates.value = new Map(sessionStates.value)
}

function getTrustedKeys(sessionId: string): Set<string> {
  const existing = trustedKeysBySession.value.get(sessionId)
  if (existing) return existing
  const created = new Set<string>()
  trustedKeysBySession.value.set(sessionId, created)
  return created
}

function cloneTrustedState(): void {
  trustedKeysBySession.value = new Map(trustedKeysBySession.value)
}

function loadTrusted(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string[]>
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        trustedKeysBySession.value = new Map(
          Object.entries(parsed)
            .filter(([, value]) => Array.isArray(value))
            .map(([sessionId, value]) => [sessionId, new Set(value)]),
        )
      }
    }

    if (localStorage.getItem(LEGACY_STORAGE_KEY)) {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    }
  } catch (error) {
    log.warn('load_trusted_failed', {}, error)
  }
}

function persistTrusted(): void {
  try {
    const payload = Object.fromEntries(
      Array.from(trustedKeysBySession.value.entries()).map(([sessionId, keys]) => [
        sessionId,
        Array.from(keys),
      ]),
    )
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch (error) {
    log.warn('persist_trusted_failed', {}, error)
  }
}

function approvalModeForPermissionMode(mode: PermissionMode): ApprovalMode {
  if (mode === 'dangerous_bypass') return 'auto'
  if (mode === 'read_only' || mode === 'plan') return 'deny'
  return 'ask'
}

function resolveTrustKey(opts: RequestApprovalOptions): string {
  if (opts.toolName === 'bash') return (opts.command ?? '').trim()
  if (opts.toolName === 'web_fetch' || opts.toolName === 'web_search') return (opts.url ?? '').trim()
  return (opts.path ?? '').trim()
}

function resolveTargetLabel(toolName: ApprovalToolName): string {
  if (toolName === 'bash') return 'command'
  if (toolName === 'web_fetch' || toolName === 'web_search') return 'url'
  if (toolName === 'db_execute' || toolName === 'db_migration') return 'database'
  return 'path'
}

function resolvePreview(opts: RequestApprovalOptions): string {
  if (opts.toolName === 'bash') return opts.command ?? ''
  if (opts.toolName === 'web_fetch' || opts.toolName === 'web_search') return opts.url ?? ''
  return opts.newContent ?? ''
}

loadTrusted()

export interface RequestApprovalOptions {
  toolName: ApprovalToolName
  path?: string
  command?: string
  url?: string
  newContent?: string
  oldContent?: string
  warning?: string
  requiresDoubleConfirm?: boolean
  sessionId: string
}

export function setActiveSessionId(sessionId: string): void {
  activeSessionId.value = sessionId
}

export function useApprovalMode() {
  return computed(() => {
    const sid = activeSessionId.value
    if (!sid) return 'ask' as ApprovalMode
    return getOrCreateState(sid).mode
  })
}

export function setApprovalMode(mode: ApprovalMode, sessionId?: string): void {
  const sid = sessionId ?? activeSessionId.value
  if (!sid) return
  const state = getOrCreateState(sid)
  if (state.mode === mode) return
  log.info('approval_mode_changed', { sessionId: sid, from: state.mode, to: mode })
  state.mode = mode
  cloneSessionStates()
}

export function usePermissionMode() {
  return computed(() => {
    const sid = activeSessionId.value
    if (!sid) return 'default' as PermissionMode
    return getOrCreateState(sid).permissionMode
  })
}

export function getPermissionMode(sessionId?: string): PermissionMode {
  const sid = sessionId ?? activeSessionId.value
  if (!sid) return 'default'
  return getOrCreateState(sid).permissionMode
}

export function setPermissionMode(mode: PermissionMode, sessionId?: string): void {
  const sid = sessionId ?? activeSessionId.value
  if (!sid) return
  const state = getOrCreateState(sid)
  if (state.permissionMode === mode) return
  log.info('permission_mode_changed', { sessionId: sid, from: state.permissionMode, to: mode })
  state.permissionMode = mode
  state.mode = approvalModeForPermissionMode(mode)
  cloneSessionStates()
}

export function usePendingToolRiskLevel(sessionId?: string) {
  return computed<ToolRiskLevel | null>(() => {
    const sid = sessionId ?? activeSessionId.value
    if (!sid) return null
    const pending = sessionStates.value.get(sid)?.pending
    return pending ? getToolRiskLevel(pending.toolName) : null
  })
}

export function requestApproval(opts: RequestApprovalOptions): Promise<ApprovalDecision> {
  const { sessionId } = opts
  const state = getOrCreateState(sessionId)
  const trustKey = resolveTrustKey(opts)
  const riskLevel = getToolRiskLevel(opts.toolName)

  if (state.permissionMode === 'dangerous_bypass') {
    log.info('permission_dangerous_bypass_allow', { toolName: opts.toolName, riskLevel, sessionId })
    return Promise.resolve('allow')
  }

  if (isDeniedByMode(state.permissionMode, riskLevel)) {
    log.info('permission_mode_reject', {
      toolName: opts.toolName,
      riskLevel,
      permissionMode: state.permissionMode,
      sessionId,
    })
    return Promise.resolve('deny')
  }

  if (isAutoAllowedByMode(state.permissionMode, riskLevel)) {
    log.info('permission_mode_auto_allow', {
      toolName: opts.toolName,
      riskLevel,
      permissionMode: state.permissionMode,
      sessionId,
    })
    return Promise.resolve('allow')
  }

  if (state.mode === 'auto') {
    log.info('approval_auto_mode_allow', { toolName: opts.toolName, trustKey, sessionId })
    return Promise.resolve('allow')
  }

  if (state.mode === 'deny') {
    log.info('approval_deny_mode_reject', { toolName: opts.toolName, trustKey, sessionId })
    return Promise.resolve('deny')
  }

  if (trustKey && getTrustedKeys(sessionId).has(trustKey)) {
    log.info('approval_auto_allow', { toolName: opts.toolName, trustKey, sessionId })
    return Promise.resolve('allow')
  }

  const prev = state.pending
  const run = () => new Promise<ApprovalDecision>((resolve) => {
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }

    state.pending = {
      toolName: opts.toolName,
      target: trustKey,
      targetLabel: resolveTargetLabel(opts.toolName),
      preview: resolvePreview(opts),
      oldPreview: opts.oldContent,
      warning: opts.warning,
      requiresDoubleConfirm: opts.requiresDoubleConfirm,
      trustKey,
      resolve,
    }
    cloneSessionStates()

    const target = trustKey
    state.timer = setTimeout(() => {
      state.timer = null
      if (state.pending?.target === target) {
        log.warn('approval_timeout', { toolName: opts.toolName, target, sessionId })
        resolveApproval('deny', sessionId)
      }
    }, APPROVAL_TIMEOUT_MS)
  })

  if (!prev) return run()

  return new Promise<ApprovalDecision>((resolve) => {
    const stop = watch(
      () => state.pending,
      (pending) => {
        if (!pending) {
          stop()
          run().then(resolve)
        }
      },
      { flush: 'sync' },
    )
  })
}

export function resolveApproval(decision: ApprovalDecision, sessionId?: string): void {
  const sid = sessionId ?? activeSessionId.value
  if (!sid) return
  const state = sessionStates.value.get(sid)
  if (!state) return
  const cur = state.pending
  if (!cur) return

  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
  state.pending = null
  cloneSessionStates()

  if (decision === 'trust' && cur.trustKey) {
    getTrustedKeys(sid).add(cur.trustKey)
    cloneTrustedState()
    persistTrusted()
    log.info('approval_trusted', { toolName: cur.toolName, trustKey: cur.trustKey, sessionId: sid })
    cur.resolve('allow')
    return
  }

  log.info('approval_decision', { toolName: cur.toolName, decision, sessionId: sid })
  cur.resolve(decision)
}

export function cancelApproval(sessionId?: string): void {
  const sid = sessionId ?? activeSessionId.value
  if (!sid) return
  const state = sessionStates.value.get(sid)
  if (state?.pending) resolveApproval('deny', sid)
}

export function usePendingApproval(sessionId?: string) {
  return computed(() => {
    const sid = sessionId ?? activeSessionId.value
    if (!sid) return null
    return sessionStates.value.get(sid)?.pending ?? null
  })
}

export function useSessionPendingApproval(sessionId: string) {
  return computed(() => sessionStates.value.get(sessionId)?.pending ?? null)
}

export function clearTrustedKeys(): void {
  trustedKeysBySession.value = new Map()
  persistTrusted()
}

export function useTrustedKeys(sessionId?: string) {
  return computed(() => {
    const sid = sessionId ?? activeSessionId.value
    if (!sid) return new Set<string>()
    return new Set(trustedKeysBySession.value.get(sid) ?? [])
  })
}

export function useSessionTrustedKeys(sessionId: string) {
  return computed(() => new Set(trustedKeysBySession.value.get(sessionId) ?? []))
}

export function clearTrustedKeysForSession(sessionId: string): void {
  trustedKeysBySession.value.delete(sessionId)
  cloneTrustedState()
  persistTrusted()
}

export function clearApprovalStateForTests(): void {
  for (const state of sessionStates.value.values()) {
    if (state.timer) clearTimeout(state.timer)
    if (state.pending) state.pending.resolve('deny')
  }
  sessionStates.value = new Map()
  activeSessionId.value = ''
  clearTrustedKeys()
}

export function cleanupSessionApproval(sessionId: string): void {
  const state = sessionStates.value.get(sessionId)
  if (!state) return
  if (state.timer) clearTimeout(state.timer)
  if (state.pending) state.pending.resolve('deny')
  sessionStates.value.delete(sessionId)
  cloneSessionStates()
}
