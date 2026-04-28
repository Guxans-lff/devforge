import { describe, expect, it } from 'vitest'
import { buildProviderCapabilityMatrix, capabilityStateLabel } from './providerCapabilityMatrix'
import type { ProviderConfig } from '@/types/ai'

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'p1',
    name: 'Provider 1',
    providerType: 'openai_compat',
    endpoint: 'https://api.example.com',
    isDefault: false,
    createdAt: 1,
    models: [
      {
        id: 'm1',
        name: 'Model 1',
        capabilities: {
          streaming: true,
          vision: true,
          thinking: false,
          toolUse: true,
          maxContext: 128000,
          maxOutput: 8192,
        },
      },
    ],
    ...overrides,
  }
}

describe('providerCapabilityMatrix', () => {
  it('summarizes full, partial and none capabilities', () => {
    const rows = buildProviderCapabilityMatrix([
      provider({
        models: [
          provider().models[0]!,
          {
            id: 'm2',
            name: 'Model 2',
            capabilities: {
              streaming: true,
              vision: false,
              thinking: true,
              toolUse: false,
              maxContext: 32000,
              maxOutput: 4096,
            },
          },
        ],
      }),
    ])

    expect(rows[0]).toMatchObject({
      streaming: 'full',
      vision: 'partial',
      thinking: 'partial',
      toolUse: 'partial',
      maxContext: 128000,
      maxOutput: 8192,
    })
  })

  it('adds strict permission note when tool model exists', () => {
    const rows = buildProviderCapabilityMatrix([provider()], { strictPermission: true })

    expect(rows[0]!.permissionMode).toBe('strict')
    expect(rows[0]!.notes).toContain('工具调用会受严格权限确认约束')
  })

  it('reports empty provider and labels states', () => {
    const rows = buildProviderCapabilityMatrix([provider({ models: [] })])

    expect(rows[0]!.notes).toContain('未配置模型')
    expect(rows[0]!.toolUse).toBe('none')
    expect(capabilityStateLabel('partial')).toBe('部分支持')
  })
})
