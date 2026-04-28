import { describe, expect, it } from 'vitest'
import { buildVerificationPresets } from '@/ai-gui/verificationPresets'
import type { PatchReviewReport } from '@/ai-gui/patchReview'

describe('buildVerificationPresets', () => {
  it('prepends patch suggested preset when report has commands', () => {
    const presets = buildVerificationPresets({
      suggestedCommands: ['pnpm test:typecheck'],
    } as PatchReviewReport)

    expect(presets[0]).toMatchObject({ id: 'patch-suggested', commands: ['pnpm test:typecheck'] })
    expect(presets.some(preset => preset.id === 'frontend-light')).toBe(true)
  })
})
