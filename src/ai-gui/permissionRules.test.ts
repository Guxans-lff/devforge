import { describe, expect, it } from 'vitest'
import { buildPermissionRuleSet, evaluatePermissionRules, type PermissionRule } from './permissionRules'

describe('permissionRules', () => {
  it('uses source priority session over project over user', () => {
    const rules: PermissionRule[] = [
      { source: 'user', behavior: 'allow', toolName: 'bash' },
      { source: 'project', behavior: 'ask', toolName: 'bash' },
      { source: 'session', behavior: 'deny', toolName: 'bash' },
    ]

    const decision = evaluatePermissionRules(rules, { toolName: 'bash' })

    expect(decision.behavior).toBe('deny')
    expect(decision.source).toBe('session')
  })

  it('builds rules from user project and session sources', () => {
    const rules = buildPermissionRuleSet({
      user: [{ behavior: 'allow', toolName: 'read_file', pattern: 'docs/**' }],
      project: [{ behavior: 'ask', toolName: 'bash', pattern: 'git *' }],
      session: [{ behavior: 'deny', toolName: 'write_file', pattern: 'dist/**' }],
    })

    expect(rules.map(rule => rule.source)).toEqual(['user', 'project', 'session'])
    expect(evaluatePermissionRules(rules, { toolName: 'write_file', path: 'dist/app.js' }).behavior).toBe('deny')
    expect(evaluatePermissionRules(rules, { toolName: 'bash', command: 'git push' }).behavior).toBe('ask')
    expect(evaluatePermissionRules(rules, { toolName: 'read_file', path: 'docs/readme.md' }).behavior).toBe('allow')
  })

  it('uses behavior priority deny over ask over allow within the same source', () => {
    const rules: PermissionRule[] = [
      { source: 'project', behavior: 'allow', toolName: 'write_file', pattern: 'src/**' },
      { source: 'project', behavior: 'deny', toolName: 'write_file', pattern: 'src/secrets/**' },
    ]

    const decision = evaluatePermissionRules(rules, {
      toolName: 'write_file',
      path: 'src/secrets/token.ts',
    })

    expect(decision.behavior).toBe('deny')
  })

  it('matches command and path patterns', () => {
    const rules: PermissionRule[] = [
      { source: 'project', behavior: 'ask', toolName: 'bash', pattern: 'git push*' },
      { source: 'project', behavior: 'allow', toolName: 'read_file', pattern: 'docs/**' },
    ]

    expect(evaluatePermissionRules(rules, {
      toolName: 'bash',
      command: 'git push origin main',
    }).behavior).toBe('ask')

    expect(evaluatePermissionRules(rules, {
      toolName: 'read_file',
      path: 'docs/guide.md',
    }).behavior).toBe('allow')
  })

  it('falls back to ask when no rule matches', () => {
    const decision = evaluatePermissionRules([], { toolName: 'read_file' })

    expect(decision.matched).toBe(false)
    expect(decision.behavior).toBe('ask')
  })
})
