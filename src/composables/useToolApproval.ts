/**
 * AI 工具写操作审批流
 *
 * 为 `write_file` / `edit_file` / `bash` 等副作用工具增加一道用户确认关卡。
 * - 会话内的"信任路径/信任命令"集合短路后续同目标的审批弹窗
 * - Promise 驱动：`requestApproval()` 在 composable 层 await，弹窗决定 resolve
 * - 按 sessionId 分区隔离，多 Tab 并发互不干扰
 */

import { ref, computed, watch } from 'vue'
import { createLogger } from '@/utils/logger'

const log = createLogger('ai.approval')

/** 需要审批的工具类型 */
export type ApprovalToolName = 'write_file' | 'edit_file' | 'bash' | 'web_fetch'

/** 审批决定 */
export type ApprovalDecision = 'allow' | 'trust' | 'deny'

/**
 * 会话级审批模式（三态）
 * - `ask`    默认，副作用工具均弹窗
 * - `auto`   全自动：所有副作用工具自动放行（仅在大哥明确授权的 chatMode=auto 下使用）
 * - `deny`   全拒绝：禁用副作用工具（用于 plan 模式 / 只读探索）
 */
export type ApprovalMode = 'ask' | 'auto' | 'deny'

// ─────────────────────── 按 sessionId 分区的状态 ───────────────────────

/** 待审批的请求元数据（送入弹窗展示） */
export interface PendingApproval {
  /** 工具名 */
  toolName: ApprovalToolName
  /** 主标识：write/edit 显示路径；bash 显示命令 */
  target: string
  /** 预览标签（path/command） */
  targetLabel: string
  /** 预览内容：write_file 的 content / edit_file 的 new_string / bash 的 command */
  preview: string
  /** 编辑场景下的旧串（仅 edit_file 使用，用于可选 diff 展示） */
  oldPreview?: string
  warning?: string
  requiresDoubleConfirm?: boolean
  /** 大哥点"信任"时作为短路 key 的值（write/edit = 路径；bash = 命令本身） */
  trustKey: string
  /** 内部 promise resolver */
  resolve: (decision: ApprovalDecision) => void
}

/** 每个 session 的审批状态 */
interface SessionApprovalState {
  mode: ApprovalMode
  pending: PendingApproval | null
  timer: ReturnType<typeof setTimeout> | null
}

const sessionStates = ref<Map<string, SessionApprovalState>>(new Map())

/** 当前活跃的 sessionId（由 AiChatView 在激活时设置） */
const activeSessionId = ref<string>('')

/** 5 分钟无操作自动拒绝（防止 AI 挂起等待） */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

function getOrCreateState(sessionId: string): SessionApprovalState {
  if (!sessionStates.value.has(sessionId)) {
    sessionStates.value.set(sessionId, { mode: 'ask', pending: null, timer: null })
  }
  return sessionStates.value.get(sessionId)!
}

// ─────────────────────── 活跃 session 设置 ───────────────────────

/** 设置当前活跃的 sessionId（由 AiChatView onActivated 调用） */
export function setActiveSessionId(sessionId: string): void {
  activeSessionId.value = sessionId
}

// ─────────────────────── 审批模式 ───────────────────────

/** 供 UI 订阅当前模式（基于活跃 session） */
export function useApprovalMode() {
  return computed(() => {
    const sid = activeSessionId.value
    if (!sid) return 'ask' as ApprovalMode
    return getOrCreateState(sid).mode
  })
}

/** 设置指定会话的审批模式 */
export function setApprovalMode(mode: ApprovalMode, sessionId?: string): void {
  const sid = sessionId ?? activeSessionId.value
  if (!sid) return
  const state = getOrCreateState(sid)
  if (state.mode === mode) return
  log.info('approval_mode_changed', { sessionId: sid, from: state.mode, to: mode })
  state.mode = mode
}

// ─────────────────────── 持久化信任集合 ───────────────────────

const STORAGE_KEY = 'ai.trustedKeysBySession'
const LEGACY_STORAGE_KEY = 'ai.trustedPaths'
const trustedKeysBySession = ref<Map<string, Set<string>>>(new Map())

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
  } catch (e) {
    log.warn('load_trusted_failed', {}, e)
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
  } catch (e) {
    log.warn('persist_trusted_failed', {}, e)
  }
}

loadTrusted()

// ─────────────────────── 对外 API ───────────────────────

export interface RequestApprovalOptions {
  toolName: ApprovalToolName
  /** 写/编辑场景的路径；bash 场景不填（用 command 代替） */
  path?: string
  /** bash 场景的命令 */
  command?: string
  /** web_fetch 场景的 URL */
  url?: string
  /** 新内容预览 */
  newContent?: string
  /** 旧内容（edit_file 可选） */
  oldContent?: string
  warning?: string
  requiresDoubleConfirm?: boolean
  /** 所属会话 ID（必填，避免跨 Tab 串扰） */
  sessionId: string
}

/**
 * 请求审批。若目标已在信任集合中则立即 resolve 'allow'。
 * 否则展示弹窗并返回一个 Promise，用户点击按钮后 resolve。
 */
export function requestApproval(opts: RequestApprovalOptions): Promise<ApprovalDecision> {
  const { sessionId } = opts
  const state = getOrCreateState(sessionId)

  const trustKey = opts.toolName === 'bash'
    ? (opts.command ?? '').trim()
    : opts.toolName === 'web_fetch'
      ? (opts.url ?? '').trim()
      : (opts.path ?? '').trim()

  // 会话级审批模式短路
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

  // 若该 session 已经有 pending，排队等前一个结束（串行）
  const prev = state.pending
  const run = () => new Promise<ApprovalDecision>((resolve) => {
    // 清理旧定时器
    if (state.timer) { clearTimeout(state.timer); state.timer = null }

    state.pending = {
      toolName: opts.toolName,
      target: trustKey,
      targetLabel: opts.toolName === 'bash'
        ? 'command'
        : opts.toolName === 'web_fetch'
          ? 'url'
          : 'path',
      preview: opts.toolName === 'bash'
        ? (opts.command ?? '')
        : opts.toolName === 'web_fetch'
          ? (opts.url ?? '')
          : (opts.newContent ?? ''),
      oldPreview: opts.oldContent,
      warning: opts.warning,
      requiresDoubleConfirm: opts.requiresDoubleConfirm,
      trustKey,
      resolve,
    }

    // 强制触发响应式更新
    sessionStates.value = new Map(sessionStates.value)

    // 超时自动拒绝
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
  // 等 prev 解决后再排队
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

/** 弹窗按钮回调：做出决定 */
export function resolveApproval(decision: ApprovalDecision, sessionId?: string): void {
  const sid = sessionId ?? activeSessionId.value
  if (!sid) return
  const state = sessionStates.value.get(sid)
  if (!state) return
  const cur = state.pending
  if (!cur) return

  if (state.timer) { clearTimeout(state.timer); state.timer = null }
  state.pending = null
  // 强制触发响应式更新
  sessionStates.value = new Map(sessionStates.value)

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

/** 取消当前待审批（如组件卸载/关闭弹窗） — 当作 deny 处理 */
export function cancelApproval(sessionId?: string): void {
  const sid = sessionId ?? activeSessionId.value
  if (!sid) return
  const state = sessionStates.value.get(sid)
  if (state?.pending) resolveApproval('deny', sid)
}

/** 暴露只读 pending 给 UI（基于活跃 session） */
export function usePendingApproval(sessionId?: string) {
  return computed(() => {
    const sid = sessionId ?? activeSessionId.value
    if (!sid) return null
    return sessionStates.value.get(sid)?.pending ?? null
  })
}

/** 暴露指定 session 的 pending（供 AiApprovalDialog 使用） */
export function useSessionPendingApproval(sessionId: string) {
  return computed(() => sessionStates.value.get(sessionId)?.pending ?? null)
}

/** 清空信任集合（供设置页使用） */
export function clearTrustedKeys(): void {
  trustedKeysBySession.value = new Map()
  persistTrusted()
}

/** 查询当前信任列表（供设置页展示） */
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

/** 清理会话状态（会话关闭时调用） */
export function cleanupSessionApproval(sessionId: string): void {
  const state = sessionStates.value.get(sessionId)
  if (state) {
    if (state.timer) clearTimeout(state.timer)
    if (state.pending) state.pending.resolve('deny')
    sessionStates.value.delete(sessionId)
    sessionStates.value = new Map(sessionStates.value)
  }
}
