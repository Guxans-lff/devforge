import { describe, expect, it } from 'vitest'
import { buildVerificationAgentPlan } from '@/ai-gui/verificationAgent'
import { buildVerificationGateDecision } from '@/ai-gui/verificationGate'
import { parseVerificationReport } from '@/ai-gui/verificationReport'

describe('verificationGate', () => {
  it('warns when required Verification Agent commands are missing evidence', () => {
    const plan = buildVerificationAgentPlan({
      changedFiles: ['src/ai-gui/runtime.ts'],
      includeTypecheck: true,
    })
    const report = parseVerificationReport([
      'Verification passed | duration=100ms | commands=1',
      '$ pnpm test:typecheck\nstatus=ok duration=100ms',
    ].join('\n\n---\n\n'))

    const decision = buildVerificationGateDecision({
      changedFiles: ['src/ai-gui/runtime.ts'],
      plan,
      report,
    })

    expect(decision.status).toBe('warn')
    expect(decision.safeToComplete).toBe(false)
    expect(decision.missingCommands).toContain('pnpm vitest run src/ai-gui src/ai-gateway src/composables/__tests__')
    expect(decision.reasons.join('\n')).toContain('缺少通过证据')
  })

  it('blocks when the latest verification report failed', () => {
    const report = parseVerificationReport([
      'Verification failed | duration=100ms | commands=1',
      '$ pnpm test:typecheck\nstatus=failed duration=100ms\ntype error',
    ].join('\n\n---\n\n'))

    const decision = buildVerificationGateDecision({
      changedFiles: ['src/views/AiChatView.vue'],
      report,
      plan: {
        risk: 'medium',
        rationale: [],
        commands: [{ command: 'pnpm test:typecheck', timeoutSeconds: 180 }],
      },
    })

    expect(decision.status).toBe('block')
    expect(decision.safeToComplete).toBe(false)
    expect(decision.failedCommands).toEqual(['pnpm test:typecheck'])
  })

  it('allows completion when all required commands passed', () => {
    const report = parseVerificationReport([
      'Verification passed | duration=100ms | commands=2',
      '$ pnpm vitest run src/ai-gui\nstatus=ok duration=50ms',
      '$ pnpm test:typecheck\nstatus=ok duration=50ms',
    ].join('\n\n---\n\n'))

    const decision = buildVerificationGateDecision({
      changedFiles: ['src/ai-gui/runtime.ts'],
      report,
      plan: {
        risk: 'high',
        rationale: [],
        commands: [
          { command: 'pnpm vitest run src/ai-gui', timeoutSeconds: 180 },
          { command: 'pnpm test:typecheck', timeoutSeconds: 180 },
        ],
      },
    })

    expect(decision.status).toBe('allow')
    expect(decision.safeToComplete).toBe(true)
    expect(decision.missingCommands).toEqual([])
  })
})
