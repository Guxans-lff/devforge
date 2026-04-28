import { describe, expect, it } from 'vitest'
import { summarizeApprovalRisk } from './approvalRisk'
import type { PendingApproval } from '@/composables/useToolApproval'

function pending(overrides: Partial<PendingApproval>): PendingApproval {
  return {
    toolName: 'write_file',
    target: 'src/app.ts',
    targetLabel: 'path',
    preview: 'content',
    trustKey: 'src/app.ts',
    resolve: () => {},
    ...overrides,
  }
}

describe('approvalRisk', () => {
  it('marks destructive shell commands as critical', () => {
    const summary = summarizeApprovalRisk(pending({
      toolName: 'bash',
      target: 'rm -rf dist',
      targetLabel: 'command',
      preview: 'rm -rf dist',
    }))

    expect(summary.level).toBe('critical')
    expect(summary.tone).toBe('danger')
    expect(summary.risks.join('\n')).toContain('删除')
  })

  it('marks sensitive file writes as high risk', () => {
    const summary = summarizeApprovalRisk(pending({
      toolName: 'write_file',
      target: '.git/config',
      preview: '[remote]',
    }))

    expect(summary.level).toBe('high')
    expect(summary.tone).toBe('danger')
    expect(summary.risks.join('\n')).toContain('敏感路径')
  })

  it('warns when edit has no old preview anchor', () => {
    const summary = summarizeApprovalRisk(pending({
      toolName: 'edit_file',
      target: 'src/main.ts',
      preview: 'new text',
      oldPreview: undefined,
    }))

    expect(summary.level).toBe('medium')
    expect(summary.risks.join('\n')).toContain('缺少 old_string')
  })

  it('uses medium risk for external fetch', () => {
    const summary = summarizeApprovalRisk(pending({
      toolName: 'web_fetch',
      target: 'https://example.com/doc',
      targetLabel: 'url',
      preview: 'https://example.com/doc',
    }))

    expect(summary.level).toBe('medium')
    expect(summary.recommendations.join('\n')).toContain('URL')
  })

  it('uses low risk for read tools and warns on sensitive paths', () => {
    const normal = summarizeApprovalRisk(pending({
      toolName: 'read_file',
      target: 'src/main.ts',
      preview: 'src/main.ts',
    }))
    const sensitive = summarizeApprovalRisk(pending({
      toolName: 'read_file',
      target: '.env.local',
      preview: '.env.local',
    }))

    expect(normal.level).toBe('low')
    expect(normal.description).toContain('只读取')
    expect(sensitive.level).toBe('medium')
    expect(sensitive.risks.join('\n')).toContain('敏感配置')
  })
})
