import { describe, expect, it } from 'vitest'
import { mapProviderToolPermission, shouldApproveTool, shouldDenyTool } from './providerPermissionMapper'
import type { ModelConfig, ProviderConfig } from '@/types/ai'
import { buildPermissionRuleSet } from './permissionRules'

function provider(): ProviderConfig {
  return {
    id: 'p1',
    name: 'Provider',
    providerType: 'openai_compat',
    endpoint: 'https://api.example.com',
    models: [],
    isDefault: true,
    createdAt: 1,
  }
}

function model(toolUse = true): ModelConfig {
  return {
    id: 'm1',
    name: 'Model',
    capabilities: {
      streaming: true,
      vision: false,
      thinking: false,
      toolUse,
      maxContext: 32000,
      maxOutput: 4096,
    },
  }
}

describe('providerPermissionMapper', () => {
  it('allows read tools in normal mode', () => {
    const mapped = mapProviderToolPermission('read_file', { provider: provider(), model: model(true) })

    expect(mapped.mode).toBe('normal')
    expect(mapped.requiresApproval).toBe(false)
  })

  it('requires approval for read tools in strict mode', () => {
    expect(shouldApproveTool('read_file', { model: model(true), strictPermission: true })).toBe(true)
  })

  it('requires approval when model tool use is disabled', () => {
    const mapped = mapProviderToolPermission('read_file', { model: model(false) })

    expect(mapped.mode).toBe('tool-disabled')
    expect(mapped.requiresApproval).toBe(true)
  })

  it('keeps mutating tools gated in normal mode', () => {
    expect(shouldApproveTool('write_file', { model: model(true) })).toBe(true)
    expect(shouldApproveTool('bash', { model: model(true) })).toBe(true)
  })

  it('allows explicit session allow rules to bypass default approval', () => {
    const mapped = mapProviderToolPermission('write_file', {
      model: model(true),
      permissionRules: [
        { source: 'session', behavior: 'allow', toolName: 'write_file', pattern: 'src/generated/**' },
      ],
      permissionInput: { path: 'src/generated/client.ts' },
    })

    expect(mapped.requiresApproval).toBe(false)
    expect(mapped.denied).toBe(false)
    expect(mapped.ruleDecision?.source).toBe('session')
  })

  it('uses deny rules to block tools before approval', () => {
    const context = {
      model: model(true),
      permissionRules: [
        { source: 'project' as const, behavior: 'deny' as const, toolName: 'bash', pattern: 'rm *' },
      ],
      permissionInput: { command: 'rm -rf dist' },
    }

    expect(shouldDenyTool('bash', context)).toBe(true)
    expect(shouldApproveTool('bash', context)).toBe(true)
  })

  it('applies merged user project and session rules by priority', () => {
    const permissionRules = buildPermissionRuleSet({
      user: [{ behavior: 'allow', toolName: 'bash', pattern: 'git *' }],
      project: [{ behavior: 'ask', toolName: 'bash', pattern: 'git push*' }],
      session: [{ behavior: 'deny', toolName: 'bash', pattern: 'git push origin main' }],
    })

    const mapped = mapProviderToolPermission('bash', {
      model: model(true),
      permissionRules,
      permissionInput: { command: 'git push origin main' },
    })

    expect(mapped.denied).toBe(true)
    expect(mapped.requiresApproval).toBe(false)
    expect(mapped.ruleDecision?.source).toBe('session')
  })
})
