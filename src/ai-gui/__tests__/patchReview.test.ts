import { describe, expect, it } from 'vitest'
import { analyzePatchReview } from '@/ai-gui/patchReview'
import type { GitDiff } from '@/types/git'

describe('analyzePatchReview', () => {
  it('marks high risk when backend and lock files changed', () => {
    const report = analyzePatchReview({
      stats: { filesChanged: 2, insertions: 30, deletions: 5 },
      files: [
        {
          path: 'src-tauri/src/commands/ai.rs',
          status: 'modified',
          isBinary: false,
          hunks: [{ header: '@@', lines: [{ origin: '+', content: 'line' }] }],
        },
        {
          path: 'pnpm-lock.yaml',
          status: 'modified',
          isBinary: false,
          hunks: [{ header: '@@', lines: [{ origin: '-', content: 'line' }] }],
        },
      ],
    } satisfies GitDiff)

    expect(report.riskLevel).toBe('high')
    expect(report.risks.some(risk => risk.path === 'src-tauri/src/commands/ai.rs')).toBe(true)
    expect(report.impactGroups.some(group => group.key === 'backend')).toBe(true)
    expect(report.impactGroups.some(group => group.key === 'deps')).toBe(true)
    expect(report.summary).toContain('风险 high')
    expect(report.suggestedCommands).toContain('pnpm check:rust')
  })

  it('suggests frontend verification for source changes', () => {
    const report = analyzePatchReview({
      stats: { filesChanged: 1, insertions: 10, deletions: 2 },
      files: [
        {
          path: 'src/components/ai/AiPatchReviewPanel.vue',
          status: 'modified',
          isBinary: false,
          hunks: [{ header: '@@', lines: [{ origin: '+', content: 'line' }] }],
        },
      ],
    } satisfies GitDiff)

    expect(report.suggestedCommands).toContain('pnpm vitest run')
    expect(report.suggestedCommands).toContain('pnpm test:typecheck')
    expect(report.risks.some(risk => risk.title === '未发现测试变更')).toBe(true)
  })
})
