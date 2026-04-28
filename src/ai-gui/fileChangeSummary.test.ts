import { describe, expect, it } from 'vitest'
import { collectFileOperations, summarizeFileChanges } from './fileChangeSummary'
import type { AiMessage } from '@/types/ai'

function assistant(toolCalls: NonNullable<AiMessage['toolCalls']>): AiMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    toolCalls,
  }
}

describe('fileChangeSummary', () => {
  it('collects successful write and edit operations', () => {
    const operations = collectFileOperations([
      assistant([
        {
          id: 'w1',
          name: 'write_file',
          arguments: '{}',
          parsedArgs: { path: 'src/a.ts', content: 'new' },
          status: 'success',
        },
        {
          id: 'e1',
          name: 'edit_file',
          arguments: '{}',
          parsedArgs: { path: 'src/b.ts', old_string: 'old', new_string: 'new' },
          status: 'success',
        },
        {
          id: 'r1',
          name: 'read_file',
          arguments: '{}',
          parsedArgs: { path: 'src/c.ts' },
          status: 'success',
        },
      ]),
    ])

    expect(operations).toHaveLength(2)
    expect(operations.map(operation => operation.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(operations[1]).toMatchObject({ oldContent: 'old', newContent: 'new' })
  })

  it('deduplicates by tool call id and summarizes status', () => {
    const operations = collectFileOperations([
      assistant([
        {
          id: 'w1',
          name: 'write_file',
          arguments: '{}',
          parsedArgs: { path: 'src/a.ts', content: 'new' },
          status: 'success',
        },
      ]),
      assistant([
        {
          id: 'w1',
          name: 'write_file',
          arguments: '{}',
          parsedArgs: { path: 'src/a.ts', content: 'newer' },
          status: 'success',
        },
      ]),
    ])
    operations[0]!.status = 'rejected'

    expect(operations).toHaveLength(1)
    expect(summarizeFileChanges(operations)).toMatchObject({
      total: 1,
      pending: 0,
      rejected: 1,
    })
  })
})
