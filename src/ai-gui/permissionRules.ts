/**
 * Allow / Ask / Deny 权限规则引擎
 *
 * 规则来源按优先级合并：session > project > user。
 * 当前为前端纯逻辑地基；后续可把规则持久化到 workspace / user settings。
 */

export type PermissionBehavior = 'allow' | 'ask' | 'deny'
export type PermissionRuleSource = 'session' | 'project' | 'user'

export interface PermissionRuleConfig {
  behavior: PermissionBehavior
  toolName: string
  pattern?: string
  reason?: string
}

export interface PermissionRule extends PermissionRuleConfig {
  source: PermissionRuleSource
}

export interface PermissionRuleSources {
  session?: PermissionRuleConfig[]
  project?: PermissionRuleConfig[]
  user?: PermissionRuleConfig[]
}

export interface PermissionRuleInput {
  toolName: string
  args?: Record<string, unknown>
  command?: string
  path?: string
}

export interface PermissionRuleDecision {
  behavior: PermissionBehavior
  matched: boolean
  source?: PermissionRuleSource
  rule?: PermissionRule
  reason: string
}

const SOURCE_PRIORITY: PermissionRuleSource[] = ['session', 'project', 'user']
const BEHAVIOR_PRIORITY: PermissionBehavior[] = ['deny', 'ask', 'allow']

function normalizeRules(source: PermissionRuleSource, rules?: PermissionRuleConfig[]): PermissionRule[] {
  if (!Array.isArray(rules)) return []
  return rules
    .filter(rule => rule && typeof rule.toolName === 'string' && typeof rule.behavior === 'string')
    .map(rule => ({
      source,
      behavior: rule.behavior,
      toolName: rule.toolName,
      pattern: rule.pattern,
      reason: rule.reason,
    }))
}

export function buildPermissionRuleSet(sources: PermissionRuleSources = {}): PermissionRule[] {
  return [
    ...normalizeRules('user', sources.user),
    ...normalizeRules('project', sources.project),
    ...normalizeRules('session', sources.session),
  ]
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase()
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

function matchesPattern(pattern: string | undefined, input: PermissionRuleInput): boolean {
  if (!pattern || pattern.trim() === '') return true
  const normalizedPattern = normalizePath(pattern.trim())
  const candidates = [
    input.path,
    input.command,
    typeof input.args?.path === 'string' ? input.args.path : undefined,
    typeof input.args?.command === 'string' ? input.args.command : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizePath)

  if (candidates.length === 0) return false
  const matcher = wildcardToRegExp(normalizedPattern)
  return candidates.some(candidate => matcher.test(candidate) || candidate.includes(normalizedPattern))
}

function toolMatches(ruleToolName: string, toolName: string): boolean {
  if (ruleToolName === '*') return true
  if (ruleToolName.endsWith('*')) {
    return toolName.startsWith(ruleToolName.slice(0, -1))
  }
  return ruleToolName === toolName
}

export function evaluatePermissionRules(
  rules: PermissionRule[],
  input: PermissionRuleInput,
): PermissionRuleDecision {
  for (const source of SOURCE_PRIORITY) {
    const sourceRules = rules.filter(rule => rule.source === source)
    for (const behavior of BEHAVIOR_PRIORITY) {
      const matchedRule = sourceRules.find(rule =>
        rule.behavior === behavior
        && toolMatches(rule.toolName, input.toolName)
        && matchesPattern(rule.pattern, input),
      )
      if (matchedRule) {
        return {
          behavior,
          matched: true,
          source,
          rule: matchedRule,
          reason: matchedRule.reason ?? `${source} ${behavior} rule matched`,
        }
      }
    }
  }

  return {
    behavior: 'ask',
    matched: false,
    reason: '未命中权限规则，回退到默认风险策略。',
  }
}

export function shouldBypassDefaultApproval(decision: PermissionRuleDecision): boolean {
  return decision.matched && decision.behavior === 'allow'
}

export function shouldForceApproval(decision: PermissionRuleDecision): boolean {
  return decision.matched && decision.behavior === 'ask'
}

export function shouldDenyByRule(decision: PermissionRuleDecision): boolean {
  return decision.matched && decision.behavior === 'deny'
}
