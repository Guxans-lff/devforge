import type { ModelConfig, ProviderConfig, ToolExecutionClass } from '@/types/ai'
import { getToolRisk, type ToolRiskInfo, type ToolRiskLevel } from '@/composables/ai/toolRisk'

export type ProviderPermissionMode = 'normal' | 'strict' | 'tool-disabled'

export interface ProviderPermissionContext {
  provider?: ProviderConfig | null
  model?: ModelConfig | null
  strictPermission?: boolean
}

export interface ProviderToolPermission {
  toolName: string
  risk: ToolRiskInfo
  effectiveLevel: ToolRiskLevel
  requiresApproval: boolean
  mode: ProviderPermissionMode
  reason: string
}

const STRICT_APPROVAL_LEVELS = new Set<ToolRiskLevel>(['read', 'write', 'execute', 'network', 'db_mutation', 'destructive'])
const NORMAL_APPROVAL_LEVELS = new Set<ToolRiskLevel>(['write', 'execute', 'network', 'db_mutation', 'destructive'])

export function mapProviderToolPermission(
  toolName: string,
  context: ProviderPermissionContext = {},
): ProviderToolPermission {
  const risk = getToolRisk(toolName)
  const toolUseEnabled = context.model?.capabilities.toolUse !== false

  if (!toolUseEnabled) {
    return {
      toolName,
      risk,
      effectiveLevel: risk.level,
      requiresApproval: true,
      mode: 'tool-disabled',
      reason: '当前模型未声明 toolUse 能力，工具调用必须进入确认流程。',
    }
  }

  if (context.strictPermission) {
    return {
      toolName,
      risk,
      effectiveLevel: risk.level,
      requiresApproval: STRICT_APPROVAL_LEVELS.has(risk.level),
      mode: 'strict',
      reason: '项目启用 Strict Permission Mode，所有工具调用都需要显式确认。',
    }
  }

  return {
    toolName,
    risk,
    effectiveLevel: risk.level,
    requiresApproval: risk.requiresApproval || NORMAL_APPROVAL_LEVELS.has(risk.level),
    mode: 'normal',
    reason: risk.requiresApproval ? risk.description : '只读工具可直接执行。',
  }
}

export function shouldApproveTool(
  toolName: string,
  context: ProviderPermissionContext = {},
): boolean {
  return mapProviderToolPermission(toolName, context).requiresApproval
}

export function classDefaultToolName(kind: ToolExecutionClass): string {
  switch (kind) {
    case 'write': return 'write_file'
    case 'bash': return 'bash'
    case 'web': return 'web_fetch'
    case 'read': return 'read_file'
    default: return 'unknown_tool'
  }
}
