/**
 * AI 工具写操作审批流
 *
 * 为 `write_file` / `edit_file` / `bash` 等副作用工具增加一道用户确认关卡。
 * - 会话内的"信任路径/信任命令"集合短路后续同目标的审批弹窗
 * - Promise 驱动：`requestApproval()` 在 composable 层 await，弹窗决定 resolve
 * - 模块级单例（多处调用共用同一份 pending 状态）
 */

import { ref, readonly } from 'vue'
import { createLogger } from '@/utils/logger'

const log = createLogger('ai.approval')

/** 需要审批的工具类型 */
export type ApprovalToolName = 'write_file' | 'edit_file' | 'bash' | 'web_fetch'

/** 审批决定 */
export type ApprovalDecision = 'allow' | 'trust' | 'deny'

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
  /** 大哥点"信任"时作为短路 key 的值（write/edit = 路径；bash = 命令本身） */
  trustKey: string
  /** 内部 promise resolver */
  resolve: (decision: ApprovalDecision) => void
}

// ─────────────────────── 模块级单例状态 ───────────────────────

const pending = ref<PendingApproval | null>(null)

/** 会话内被信任的 key（write/edit = 绝对路径；bash = 命令字面） */
const trustedKeys = ref<Set<string>>(new Set())

/** 持久化到 localStorage（可选，仅保存路径类） */
const STORAGE_KEY = 'ai.trustedPaths'

function loadTrusted(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const arr = JSON.parse(raw) as string[]
    if (Array.isArray(arr)) trustedKeys.value = new Set(arr)
  } catch (e) {
    log.warn('load_trusted_failed', {}, e)
  }
}

function persistTrusted(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(trustedKeys.value)))
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
}

/**
 * 请求审批。若目标已在信任集合中则立即 resolve 'allow'。
 * 否则展示弹窗并返回一个 Promise，用户点击按钮后 resolve。
 */
export function requestApproval(opts: RequestApprovalOptions): Promise<ApprovalDecision> {
  const trustKey = opts.toolName === 'bash'
    ? (opts.command ?? '').trim()
    : opts.toolName === 'web_fetch'
      ? (opts.url ?? '').trim()
      : (opts.path ?? '').trim()

  if (trustKey && trustedKeys.value.has(trustKey)) {
    log.info('approval_auto_allow', { toolName: opts.toolName, trustKey })
    return Promise.resolve('allow')
  }

  // 若已经有 pending，排队等前一个结束（简单串行：一次只弹一个）
  const prev = pending.value
  const run = () => new Promise<ApprovalDecision>((resolve) => {
    pending.value = {
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
      trustKey,
      resolve,
    }
  })

  if (!prev) return run()
  // 等 prev 解决后再排队
  return new Promise<ApprovalDecision>((resolve) => {
    const unwatch = setInterval(() => {
      if (!pending.value) {
        clearInterval(unwatch)
        run().then(resolve)
      }
    }, 50)
  })
}

/** 弹窗按钮回调：做出决定 */
export function resolveApproval(decision: ApprovalDecision): void {
  const cur = pending.value
  if (!cur) return
  pending.value = null

  if (decision === 'trust' && cur.trustKey) {
    trustedKeys.value.add(cur.trustKey)
    persistTrusted()
    log.info('approval_trusted', { toolName: cur.toolName, trustKey: cur.trustKey })
    cur.resolve('allow')
    return
  }

  log.info('approval_decision', { toolName: cur.toolName, decision })
  cur.resolve(decision)
}

/** 取消当前待审批（如组件卸载/关闭弹窗） — 当作 deny 处理 */
export function cancelApproval(): void {
  if (pending.value) resolveApproval('deny')
}

/** 暴露只读 pending 给 UI */
export function usePendingApproval() {
  return readonly(pending)
}

/** 清空信任集合（供设置页使用） */
export function clearTrustedKeys(): void {
  trustedKeys.value = new Set()
  persistTrusted()
}

/** 查询当前信任列表（供设置页展示） */
export function useTrustedKeys() {
  return readonly(trustedKeys)
}
