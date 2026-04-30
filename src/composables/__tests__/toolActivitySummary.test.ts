import { describe, expect, it } from 'vitest'
import { classifyToolActivity, summarizeToolActivity, toToolDisplayName } from '@/composables/ai/toolActivitySummary'

describe('toolActivitySummary', () => {
  it('classifies tool names into stable activity categories', () => {
    expect(classifyToolActivity('read_file')).toBe('read')
    expect(classifyToolActivity('search_files')).toBe('search')
    expect(classifyToolActivity('edit_file')).toBe('write')
    expect(classifyToolActivity('bash')).toBe('command')
    expect(classifyToolActivity('todo_write')).toBe('todo')
    expect(classifyToolActivity('db_query')).toBe('database')
  })

  it('summarizes calls and results by activity bucket', () => {
    const summary = summarizeToolActivity({
      toolCalls: [
        { name: 'read_file', status: 'success' },
        { name: 'search_files', status: 'success' },
        { name: 'edit_file', status: 'error' },
        { name: 'bash', status: 'running' },
      ],
      toolResults: [
        { toolName: 'read_file', success: true },
        { toolName: 'edit_file', success: false },
      ],
    })

    expect(summary.callCount).toBe(4)
    expect(summary.resultCount).toBe(2)
    expect(summary.hasWrite).toBe(true)
    expect(summary.hasCommand).toBe(true)
    expect(summary.hasFailure).toBe(true)
    expect(summary.buckets.map(bucket => bucket.category)).toEqual(['read', 'search', 'write', 'command'])
    expect(summary.buckets.find(bucket => bucket.category === 'write')?.errorCount).toBe(2)
  })

  it('keeps user-facing display names centralized', () => {
    expect(toToolDisplayName('read_file')).toBe('读取文件')
    expect(toToolDisplayName('unknown_tool')).toBe('unknown tool')
  })
})

