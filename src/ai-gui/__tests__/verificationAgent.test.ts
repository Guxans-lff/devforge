import { describe, expect, it } from 'vitest'
import { buildVerificationAgentPlan, evaluateVerificationAgentOutput } from '@/ai-gui/verificationAgent'

describe('verificationAgent', () => {
  it('builds focused verification commands for AI and Rust changes', () => {
    const plan = buildVerificationAgentPlan({
      changedFiles: [
        'src/ai-gui/permissionRules.ts',
        'src-tauri/src/services/ai/session_store.rs',
      ],
      includeTypecheck: true,
    })

    expect(plan.risk).toBe('high')
    expect(plan.commands.map(item => item.command)).toContain('pnpm vitest run src/ai-gui src/ai-gateway src/composables/__tests__')
    expect(plan.commands.map(item => item.command)).toContain('pnpm test:typecheck')
    expect(plan.commands.map(item => item.command)).toContain('cargo check --manifest-path src-tauri/Cargo.toml')
  })

  it('evaluates verification output into a concise result', () => {
    const failed = evaluateVerificationAgentOutput([
      'Verification failed | duration=100ms | commands=1',
      '$ pnpm test:typecheck',
      'status=failed duration=100ms',
      'src/a.ts error',
    ].join('\n'))

    expect(failed.passed).toBe(false)
    expect(failed.failedCommands).toEqual(['pnpm test:typecheck'])
    expect(failed.incompleteCommands).toEqual([])

    const passed = evaluateVerificationAgentOutput([
      'Verification passed | duration=100ms | commands=1',
      '$ cargo check',
      'status=ok duration=100ms',
    ].join('\n'))

    expect(passed.passed).toBe(true)
    expect(passed.confidence).toBe('high')
  })

  it('detects incomplete command evidence even when output contains ok elsewhere', () => {
    const result = evaluateVerificationAgentOutput([
      '$ pnpm test:typecheck',
      'running vue-tsc',
      '$ pnpm vitest run src/ai-gui',
      'status=ok duration=20ms',
    ].join('\n'))

    expect(result.passed).toBe(false)
    expect(result.confidence).toBe('medium')
    expect(result.incompleteCommands).toEqual(['pnpm test:typecheck'])
    expect(result.summary).toContain('验证结果不完整')
  })
})
