import { describe, expect, it } from 'vitest'
import { mapProviderToolPermission, shouldApproveTool } from './providerPermissionMapper'
import type { ModelConfig, ProviderConfig } from '@/types/ai'

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
})
