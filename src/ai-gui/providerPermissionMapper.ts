import type { ModelConfig, ProviderConfig, ToolExecutionClass } from '@/types/ai'
import { getToolRisk, type ToolRiskInfo, type ToolRiskLevel } from '@/composables/ai/toolRisk'
import {
  evaluatePermissionRules,
  shouldBypassDefaultApproval,
  shouldDenyByRule,
  shouldForceApproval,
  type PermissionRule,
  type PermissionRuleDecision,
  type PermissionRuleInput,
} from './permissionRules'

export type ProviderPermissionMode = 'normal' | 'strict' | 'tool-disabled'

export interface ProviderPermissionContext {
  provider?: ProviderConfig | null
  model?: ModelConfig | null
  strictPermission?: boolean
  permissionRules?: PermissionRule[]
  permissionInput?: Omit<PermissionRuleInput, 'toolName'>
}

export interface ProviderToolPermission {
  toolName: string
  risk: ToolRiskInfo
  effectiveLevel: ToolRiskLevel
  requiresApproval: boolean
  denied: boolean
  mode: ProviderPermissionMode
  reason: string
  ruleDecision?: PermissionRuleDecision
}

const STRICT_APPROVAL_LEVELS = new Set<ToolRiskLevel>(['read', 'write', 'execute', 'network', 'db_mutation', 'destructive'])
const NORMAL_APPROVAL_LEVELS = new Set<ToolRiskLevel>(['write', 'execute', 'network', 'db_mutation', 'destructive'])

export function mapProviderToolPermission(
  toolName: string,
  context: ProviderPermissionContext = {},
): ProviderToolPermission {
  const risk = getToolRisk(toolName)
  const toolUseEnabled = context.model?.capabilities.toolUse !== false
  const ruleDecision = evaluatePermissionRules(context.permissionRules ?? [], {
    toolName,
    ...context.permissionInput,
  })

  if (shouldDenyByRule(ruleDecision)) {
    return {
      toolName,
      risk,
      effectiveLevel: risk.level,
      requiresApproval: false,
      denied: true,
      mode: context.strictPermission ? 'strict' : 'normal',
      reason: ruleDecision.reason,
      ruleDecision,
    }
  }

  if (!toolUseEnabled) {
    return {
      toolName,
      risk,
      effectiveLevel: risk.level,
      requiresApproval: true,
      denied: false,
      mode: 'tool-disabled',
      reason: '当前模型未声明 toolUse 能力，工具调用必须进入确认流程。',
      ruleDecision,
    }
  }

  if (shouldForceApproval(ruleDecision)) {
    return {
      toolName,
      risk,
      effectiveLevel: risk.level,
      requiresApproval: true,
      denied: false,
      mode: context.strictPermission ? 'strict' : 'normal',
      reason: ruleDecision.reason,
      ruleDecision,
    }
  }

  if (shouldBypassDefaultApproval(ruleDecision)) {
    return {
      toolName,
      risk,
      effectiveLevel: risk.level,
      requiresApproval: false,
      denied: false,
      mode: context.strictPermission ? 'strict' : 'normal',
      reason: ruleDecision.reason,
      ruleDecision,
    }
  }

  if (context.strictPermission) {
    return {
      toolName,
      risk,
      effectiveLevel: risk.level,
      requiresApproval: STRICT_APPROVAL_LEVELS.has(risk.level),
      denied: false,
      mode: 'strict',
      reason: '项目启用 Strict Permission Mode，所有工具调用都需要显式确认。',
      ruleDecision,
    }
  }

  return {
    toolName,
    risk,
    effectiveLevel: risk.level,
    requiresApproval: risk.requiresApproval || NORMAL_APPROVAL_LEVELS.has(risk.level),
    denied: false,
    mode: 'normal',
    reason: risk.requiresApproval ? risk.description : '只读工具可直接执行。',
    ruleDecision,
  }
}

export function shouldApproveTool(
  toolName: string,
  context: ProviderPermissionContext = {},
): boolean {
  const permission = mapProviderToolPermission(toolName, context)
  return permission.denied || permission.requiresApproval
}

export function shouldDenyTool(
  toolName: string,
  context: ProviderPermissionContext = {},
): boolean {
  return mapProviderToolPermission(toolName, context).denied
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
