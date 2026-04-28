import { describe, expect, it } from 'vitest'
import { upsertVerificationArchiveRecord } from '@/ai-gui/verificationArchive'

describe('verificationArchive', () => {
  it('upserts latest verification records first', () => {
    const records = upsertVerificationArchiveRecord([], {
      id: 'job-1',
      sessionId: 's1',
      status: 'succeeded',
      createdAt: 1,
      report: null,
    })

    const next = upsertVerificationArchiveRecord(records, {
      id: 'job-2',
      sessionId: 's1',
      status: 'failed',
      createdAt: 2,
      report: null,
    })

    expect(next.map(item => item.id)).toEqual(['job-2', 'job-1'])
  })
})

