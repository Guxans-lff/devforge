import { describe, expect, it } from 'vitest'
import { buildWorkspaceConfigSummary, buildWorkspaceConfigSummaryResult } from './workspaceConfigSummary'

describe('workspaceConfigSummary', () => {
  it('uses defaults when workspace config is missing', () => {
    const summary = buildWorkspaceConfigSummary(null)

    expect(summary.find(item => item.key === 'preferredModel')?.value).toBe('跟随全局选择')
    expect(summary.find(item => item.key === 'dispatcherMaxParallel')?.value).toBe('3 路并发')
    expect(summary.every(item => item.source === 'default')).toBe(true)
  })

  it('marks configured fields as workspace overrides', () => {
    const summary = buildWorkspaceConfigSummary({
      preferredModel: 'gpt-5.4',
      systemPromptExtra: '项目提示词',
      outputStyleId: 'concise',
      contextFiles: [{ path: 'AGENTS.md' }],
      skills: [{ id: 'frontend', name: 'Frontend', enabled: true }],
      planGateEnabled: true,
      dispatcherPrompt: 'dispatcher',
      dispatcherMaxParallel: 6,
      dispatcherAutoRetryCount: 0,
      dispatcherDefaultMode: 'tab',
      features: { 'ai.permission.strict': true },
    })

    expect(summary.find(item => item.key === 'preferredModel')).toMatchObject({
      value: 'gpt-5.4',
      source: 'workspace',
      tone: 'active',
    })
    expect(summary.find(item => item.key === 'contextFiles')?.value).toBe('1 个文件自动注入')
    expect(summary.find(item => item.key === 'outputStyleId')?.value).toBe('concise')
    expect(summary.find(item => item.key === 'skills')?.value).toBe('1/1 个启用')
    expect(summary.find(item => item.key === 'planGateEnabled')?.tone).toBe('warning')
    expect(summary.find(item => item.key === 'dispatcherMaxParallel')?.value).toBe('6 路并发')
    expect(summary.find(item => item.key === 'dispatcherDefaultMode')?.value).toBe('新建 Tab 执行')
    expect(summary.find(item => item.key === 'features')?.value).toBe('1 个项目级开关')
  })

  it('reports configuration conflict warnings', () => {
    const result = buildWorkspaceConfigSummaryResult({
      systemPromptExtra: '项目提示词',
      planGateEnabled: true,
      dispatcherDefaultMode: 'headless',
      dispatcherAutoRetryCount: 2,
      features: { 'ai.permission.strict': true },
      skills: [{ id: 'frontend', name: 'Frontend', enabled: true, permissions: ['execute'] }],
    })

    expect(result.warnings.map(warning => warning.key)).toEqual([
      'plan-headless',
      'strict-retry',
      'prompt-skills',
      'skill-missing-path',
      'skill-risky-permission',
    ])
    expect(result.warnings.find(warning => warning.key === 'skill-risky-permission')?.severity).toBe('danger')
  })
})
