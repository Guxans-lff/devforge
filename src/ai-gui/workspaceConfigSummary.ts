import type { WorkspaceConfig } from '@/types/ai'
import { normalizeWorkspaceSkills, validateWorkspaceSkills } from './workspaceSkills'

export interface WorkspaceConfigSummaryItem {
  key: string
  label: string
  value: string
  source: 'workspace' | 'default'
  tone: 'active' | 'muted' | 'warning'
}

export interface WorkspaceConfigWarning {
  key: string
  title: string
  description: string
  severity: 'info' | 'warning' | 'danger'
}

export interface WorkspaceConfigSummaryResult {
  items: WorkspaceConfigSummaryItem[]
  warnings: WorkspaceConfigWarning[]
}

function formatBool(value: boolean | undefined, enabledLabel: string, disabledLabel: string): string {
  return value ? enabledLabel : disabledLabel
}

export function buildWorkspaceConfigSummary(config: WorkspaceConfig | null | undefined): WorkspaceConfigSummaryItem[] {
  return buildWorkspaceConfigSummaryResult(config).items
}

export function buildWorkspaceConfigSummaryResult(config: WorkspaceConfig | null | undefined): WorkspaceConfigSummaryResult {
  const cfg = config ?? {}
  const hasConfig = !!config
  const featureCount = cfg.features ? Object.keys(cfg.features).length : 0
  const skillCount = cfg.skills?.length ?? 0
  const enabledSkillCount = cfg.skills?.filter(skill => skill.enabled !== false).length ?? 0

  const items: WorkspaceConfigSummaryItem[] = [
    {
      key: 'preferredModel',
      label: '首选模型',
      value: cfg.preferredModel?.trim() || '跟随全局选择',
      source: cfg.preferredModel ? 'workspace' : 'default',
      tone: cfg.preferredModel ? 'active' : 'muted',
    },
    {
      key: 'systemPromptExtra',
      label: '项目提示词',
      value: cfg.systemPromptExtra?.trim() ? `已配置 ${cfg.systemPromptExtra.trim().length} 字` : '未追加项目提示词',
      source: cfg.systemPromptExtra?.trim() ? 'workspace' : 'default',
      tone: cfg.systemPromptExtra?.trim() ? 'active' : 'muted',
    },
    {
      key: 'outputStyleId',
      label: '输出风格',
      value: cfg.outputStyleId?.trim() || '使用默认输出风格',
      source: cfg.outputStyleId?.trim() ? 'workspace' : 'default',
      tone: cfg.outputStyleId?.trim() ? 'active' : 'muted',
    },
    {
      key: 'contextFiles',
      label: '上下文文件',
      value: cfg.contextFiles?.length ? `${cfg.contextFiles.length} 个文件自动注入` : '未配置自动注入文件',
      source: cfg.contextFiles?.length ? 'workspace' : 'default',
      tone: cfg.contextFiles?.length ? 'active' : 'muted',
    },
    {
      key: 'skills',
      label: '项目 Skill',
      value: skillCount ? `${enabledSkillCount}/${skillCount} 个启用` : '未配置项目 Skill',
      source: skillCount ? 'workspace' : 'default',
      tone: skillCount ? 'active' : 'muted',
    },
    {
      key: 'planGateEnabled',
      label: 'Plan Gate',
      value: formatBool(cfg.planGateEnabled, '项目强制先出计划', '按当前聊天模式决定'),
      source: cfg.planGateEnabled ? 'workspace' : 'default',
      tone: cfg.planGateEnabled ? 'warning' : 'muted',
    },
    {
      key: 'dispatcherPrompt',
      label: 'Dispatcher Prompt',
      value: cfg.dispatcherPrompt?.trim() ? `已配置 ${cfg.dispatcherPrompt.trim().length} 字` : '使用内置 Dispatcher Prompt',
      source: cfg.dispatcherPrompt?.trim() ? 'workspace' : 'default',
      tone: cfg.dispatcherPrompt?.trim() ? 'active' : 'muted',
    },
    {
      key: 'dispatcherMaxParallel',
      label: '任务并发',
      value: `${Math.max(1, Math.trunc(cfg.dispatcherMaxParallel ?? 3))} 路并发`,
      source: cfg.dispatcherMaxParallel === undefined ? 'default' : 'workspace',
      tone: cfg.dispatcherMaxParallel === undefined ? 'muted' : 'active',
    },
    {
      key: 'dispatcherAutoRetryCount',
      label: '自动重试',
      value: `${Math.max(0, Math.trunc(cfg.dispatcherAutoRetryCount ?? 1))} 次`,
      source: cfg.dispatcherAutoRetryCount === undefined ? 'default' : 'workspace',
      tone: cfg.dispatcherAutoRetryCount === undefined ? 'muted' : 'active',
    },
    {
      key: 'dispatcherDefaultMode',
      label: '任务执行形态',
      value: cfg.dispatcherDefaultMode === 'tab' ? '新建 Tab 执行' : '后台 headless 执行',
      source: cfg.dispatcherDefaultMode ? 'workspace' : 'default',
      tone: cfg.dispatcherDefaultMode ? 'active' : 'muted',
    },
    {
      key: 'features',
      label: 'Feature Gate',
      value: featureCount > 0 ? `${featureCount} 个项目级开关` : '无项目级覆盖',
      source: featureCount > 0 ? 'workspace' : 'default',
      tone: featureCount > 0 ? 'active' : hasConfig ? 'muted' : 'warning',
    },
  ]

  return { items, warnings: buildWorkspaceConfigWarnings(cfg, hasConfig) }
}

export function buildWorkspaceConfigWarnings(config: WorkspaceConfig, hasConfig = true): WorkspaceConfigWarning[] {
  const warnings: WorkspaceConfigWarning[] = []
  if (!hasConfig) {
    warnings.push({
      key: 'missing-config',
      title: '未发现项目配置',
      description: '当前仅使用全局默认策略；Prompt、Skill、Feature Gate 都不会有项目级覆盖。',
      severity: 'info',
    })
  }

  if (config.planGateEnabled && config.dispatcherDefaultMode === 'headless') {
    warnings.push({
      key: 'plan-headless',
      title: 'Plan Gate 与后台任务并用',
      description: '项目要求先出计划，但默认任务形态是 headless；后台任务可能需要额外确认才能继续。',
      severity: 'warning',
    })
  }

  if (config.features?.['ai.permission.strict'] && config.dispatcherAutoRetryCount && config.dispatcherAutoRetryCount > 0) {
    warnings.push({
      key: 'strict-retry',
      title: '严格权限与自动重试同时启用',
      description: '工具重试可能反复触发确认；建议将自动重试设为 0，或只对低风险任务使用。',
      severity: 'warning',
    })
  }

  if (config.systemPromptExtra?.trim() && config.skills?.some(skill => skill.enabled !== false)) {
    warnings.push({
      key: 'prompt-skills',
      title: '项目 Prompt 与 Skill 会同时注入',
      description: '如果两者约束冲突，AI 可能优先级不明确；建议把稳定规则放 Prompt，把场景能力放 Skill。',
      severity: 'info',
    })
  }

  const skillRisks = validateWorkspaceSkills(normalizeWorkspaceSkills(config.skills))
  if (skillRisks.missingPathCount > 0) {
    warnings.push({
      key: 'skill-missing-path',
      title: '存在缺少路径的启用 Skill',
      description: `${skillRisks.missingPathCount} 个启用 Skill 没有声明 SKILL.md 路径，只能作为提示说明，无法定位具体文件。`,
      severity: 'warning',
    })
  }

  if (skillRisks.riskyCount > 0) {
    warnings.push({
      key: 'skill-risky-permission',
      title: '存在高风险 Skill 权限',
      description: `${skillRisks.riskyCount} 个启用 Skill 声明了 write/execute/network/mcp 等高风险权限；接入运行隔离前应保持人工确认。`,
      severity: skillRisks.highestLevel === 'danger' ? 'danger' : 'warning',
    })
  }

  return warnings
}
