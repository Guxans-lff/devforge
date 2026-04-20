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

export function normalizeAiErrorMessage(errMsg: string): string {
  if (/\b429\b/.test(errMsg)) {
    return `上游模型服务限流了（429）。已自动进行短暂退避重试；如果仍失败，请稍等几秒再继续，或切换模型/降低连续工具调用频率。\n\n原始错误: ${errMsg}`
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
  if (name === 'write_file' || name === 'edit_file' || name === 'bash' || name === 'web_fetch') return name
  return null
}
