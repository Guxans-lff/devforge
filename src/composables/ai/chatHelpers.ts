import type { ModelConfig } from '@/types/ai'
import type { ApprovalToolName } from '@/composables/useToolApproval'

export function thinkingEffortToBudget(effort?: ModelConfig['thinkingEffort']): number {
  switch (effort) {
    case 'low':
      return 2048
    case 'medium':
      return 4096
    case 'high':
      return 8192
    case 'xhigh':
      return 16384
    case 'max':
      return 24576
    default:
      return 8192
  }
}

export function resolveRequestMaxTokens(model: ModelConfig, options?: { enableTools?: boolean }): number | undefined {
  const modelMaxOutput = model.capabilities.maxOutput
  if (!modelMaxOutput || modelMaxOutput <= 0) return undefined

  const hardCap = model.capabilities.thinking
    ? (options?.enableTools ? 8192 : 16384)
    : (options?.enableTools ? 4096 : 8192)

  return Math.min(modelMaxOutput, hardCap)
}

export function resolveStreamWatchdogConfig(model?: ModelConfig): { warnMs: number; timeoutMs: number } {
  if (model?.capabilities.thinking) {
    return {
      warnMs: 90_000,
      timeoutMs: 180_000,
    }
  }

  return {
    warnMs: 45_000,
    timeoutMs: 90_000,
  }
}

export function normalizeAiErrorMessage(errMsg: string): string {
  if (/\b429\b/.test(errMsg)) {
    return `上游模型服务限流了（429）。已自动进行短暂退避重试；如果仍失败，请稍等几秒再继续，或切换模型/降低连续工具调用频率。\n\n原始错误: ${errMsg}`
  }
  if (/timeout|timed out|deadline exceeded/i.test(errMsg)) {
    return `上游模型响应超时了。系统会优先尝试自动恢复；如果仍反复出现，建议先切到非 thinking 模型，或减少单轮上下文/工具调用数量。\n\n原始错误: ${errMsg}`
  }
  if (/temporarily unavailable|server_error|overloaded|bad gateway|gateway timeout|\b502\b|\b503\b|\b504\b/i.test(errMsg)) {
    return `上游模型服务当前不稳定，可能是暂时性过载或网关错误。系统会优先尝试自动恢复；如果仍失败，请稍后重试或切换模型/Provider。\n\n原始错误: ${errMsg}`
  }
  return errMsg
}

export function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function hashArgs(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

export function tryParseJson(str: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(str)
  } catch {
    return undefined
  }
}

export function pickApprovalTool(name: string): ApprovalToolName | null {
  if (
    name === 'read_file'
    || name === 'list_files'
    || name === 'list_directory'
    || name === 'search_files'
    || name === 'read_tool_result'
    || name === 'write_file'
    || name === 'edit_file'
    || name === 'delete_file'
    || name === 'bash'
    || name === 'web_fetch'
    || name === 'web_search'
    || name === 'db_execute'
    || name === 'db_migration'
  ) return name
  return null
}
