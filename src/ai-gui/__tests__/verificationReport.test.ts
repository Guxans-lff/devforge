import { describe, expect, it } from 'vitest'
import { parseVerificationReport } from '@/ai-gui/verificationReport'

describe('parseVerificationReport', () => {
  it('parses structured verification output', () => {
    const report = parseVerificationReport([
      'Verification passed | duration=123ms | commands=1',
      '',
      '---',
      '',
      '$ pnpm test:typecheck',
      'status=ok duration=120ms',
      'done',
    ].join('\n'))

    expect(report?.status).toBe('passed')
    expect(report?.durationMs).toBe(123)
    expect(report?.commands[0]).toMatchObject({ command: 'pnpm test:typecheck', status: 'ok', durationMs: 120 })
  })
})
