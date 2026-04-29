import { describe, expect, it } from 'vitest'
import type { ProviderConfig, WorkspaceConfig } from '@/types/ai'
import {
  applyProviderProfileBundle,
  buildProviderProfilePreview,
  normalizeProviderProfileBundle,
  rollbackProviderProfileBundle,
  upsertProviderProfileBackup,
  upsertProviderProfileBundle,
  createProviderProfileBackup,
} from '@/ai-gui/providerProfileBundle'

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'OpenAI',
    providerType: 'openai_compat',
    endpoint: 'https://api.openai.com/v1',
    isDefault: true,
    createdAt: 1,
    models: [
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        capabilities: {
          streaming: true,
          vision: true,
          thinking: true,
          toolUse: true,
          maxContext: 1000000,
          maxOutput: 128000,
        },
      },
    ],
    ...overrides,
  }
}

describe('providerProfileBundle', () => {
  it('normalizes profile drafts and keeps stable timestamps on update', () => {
    const created = normalizeProviderProfileBundle({
      name: '  主力编码  ',
      providerId: 'provider-1',
      modelId: 'gpt-5.4',
      tags: [' coding ', 'coding', ''],
    }, undefined, 100)

    const updated = normalizeProviderProfileBundle({
      id: created.id,
      name: '主力编码 v2',
      providerId: 'provider-1',
      modelId: 'gpt-5.4',
    }, created, 200)

    expect(created).toMatchObject({
      name: '主力编码',
      tags: ['coding'],
      createdAt: 100,
      updatedAt: 100,
    })
    expect(updated.createdAt).toBe(100)
    expect(updated.updatedAt).toBe(200)
  })

  it('builds preview with workspace and security diffs', () => {
    const profile = normalizeProviderProfileBundle({
      name: '安全配置',
      providerId: 'provider-1',
      modelId: 'gpt-5.4',
      outputStyleId: 'concise',
      workspaceConfig: {
        systemPromptExtra: '项目提示词',
        skills: [{ id: 'deploy', name: 'Deploy', permissions: ['execute'], enabled: true }],
      },
      security: { allowlist: ['api.openai.com'], allowPrivateIP: true },
    }, undefined, 100)

    const preview = buildProviderProfilePreview({
      profile,
      providers: [makeProvider()],
      outputStyles: [{ id: 'concise', name: '简洁', description: '', content: '', source: 'builtin' }],
      currentWorkspaceConfig: { systemPromptExtra: '' },
    })

    expect(preview.providerName).toBe('OpenAI')
    expect(preview.modelName).toBe('GPT-5.4')
    expect(preview.outputStyleName).toBe('简洁')
    expect(preview.workspaceChanges.find(item => item.key === 'systemPromptExtra')).toMatchObject({
      before: '未配置',
      after: '项目提示词',
      changed: true,
    })
    expect(preview.securityChanges.find(item => item.key === 'allowlist')?.after).toBe('api.openai.com')
    expect(preview.warnings.map(item => item.key)).toEqual(expect.arrayContaining([
      'skill-missing_path-deploy',
      'skill-risky_permission-deploy',
      'private-ip',
    ]))
  })

  it('applies profile to selected route and workspace config', () => {
    const profile = normalizeProviderProfileBundle({
      name: '编码',
      providerId: 'provider-1',
      modelId: 'gpt-5.4',
      outputStyleId: 'default',
      workspaceConfig: {
        dispatcherMaxParallel: 5,
        planGateEnabled: true,
      },
      security: { allowlist: ['api.openai.com'] },
    }, undefined, 100)

    const result = applyProviderProfileBundle({
      profile,
      providers: [makeProvider()],
      currentWorkspaceConfig: { dispatcherAutoRetryCount: 2 },
      now: 200,
    })

    expect(result.selectedProviderId).toBe('provider-1')
    expect(result.selectedModelId).toBe('gpt-5.4')
    expect(result.outputStyleId).toBe('default')
    expect(result.workspaceConfig).toMatchObject({
      preferredModel: 'gpt-5.4',
      dispatcherAutoRetryCount: 2,
      dispatcherMaxParallel: 5,
      planGateEnabled: true,
    } satisfies Partial<WorkspaceConfig>)
    expect(result.providerConfig?.security?.allowlist).toEqual(['api.openai.com'])
    expect(result.backup.reason).toBe('before-apply')
  })

  it('upserts profiles and rolls back from backup', () => {
    let profiles = upsertProviderProfileBundle([], {
      name: 'Profile A',
      providerId: 'provider-1',
      modelId: 'gpt-5.4',
    }, 100)
    const backup = createProviderProfileBackup(profiles[0]!, 'manual', 110)

    profiles = upsertProviderProfileBundle(profiles, {
      id: profiles[0]!.id,
      name: 'Profile A v2',
      providerId: 'provider-1',
      modelId: 'gpt-5.4',
    }, 120)
    profiles = rollbackProviderProfileBundle(profiles, backup, 130)

    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({
      name: 'Profile A',
      updatedAt: 130,
    })
  })

  it('limits backups per profile', () => {
    const profile = normalizeProviderProfileBundle({
      name: 'Profile',
      providerId: 'provider-1',
      modelId: 'gpt-5.4',
    }, undefined, 1)
    let backups = []
    for (let index = 0; index < 16; index += 1) {
      backups = upsertProviderProfileBackup(backups, createProviderProfileBackup(profile, 'manual', 100 + index))
    }

    expect(backups).toHaveLength(12)
    expect(backups[0]!.createdAt).toBe(115)
    expect(backups.at(-1)!.createdAt).toBe(104)
  })
})
