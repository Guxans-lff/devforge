import { describe, expect, it, vi } from 'vitest'
import { confirmGitRisk, summarizeGitRisk } from '../gitRisk'

describe('gitRisk', () => {
  it('marks force push as critical', () => {
    const risk = summarizeGitRisk({ operation: 'force_push', remote: 'origin', branch: 'main' })
    expect(risk.level).toBe('critical')
    expect(risk.message).toContain('origin/main')
  })

  it('summarizes destructive local operations with target details', () => {
    expect(summarizeGitRisk({ operation: 'discard', filePath: 'src/main.ts' }).message).toContain('src/main.ts')
    expect(summarizeGitRisk({ operation: 'delete_tag', tag: 'v1.0.0' }).message).toContain('v1.0.0')
    expect(summarizeGitRisk({ operation: 'stash_drop', stashIndex: 2 }).message).toContain('stash@{2}')
  })

  it('delegates confirmation to window.confirm', () => {
    window.confirm = vi.fn()
    const spy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    expect(confirmGitRisk({ operation: 'pull', branch: 'main' })).toBe(true)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
