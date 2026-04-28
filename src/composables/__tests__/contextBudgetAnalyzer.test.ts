import { describe, it, expect } from 'vitest'
import {
  analyzeContextBudget,
  getCategoryPercent,
  type AnalyzeContextBudgetOptions,
} from '@/composables/ai-agent/diagnostics/contextBudgetAnalyzer'
import type { AiMessage, AiMemory, FileAttachment } from '@/types/ai'
import { estimateTokens } from '@/utils/file-markers'

function makeMessage(overrides: Partial<AiMessage> = {}): AiMessage {
  return {
    id: `msg-${Date.now()}`,
    role: 'user',
    content: '',
    timestamp: Date.now(),
    ...overrides,
  }
}

function makeMemory(overrides: Partial<AiMemory> = {}): AiMemory {
  return {
    id: `mem-${Date.now()}`,
    workspaceId: 'ws1',
    type: 'knowledge',
    title: 'Test Memory',
    content: '',
    tags: '',
    weight: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function makeAttachment(overrides: Partial<FileAttachment> = {}): FileAttachment {
  return {
    id: `att-${Date.now()}`,
    name: 'test.txt',
    path: '/test.txt',
    size: 100,
    status: 'ready',
    ...overrides,
  }
}

describe('analyzeContextBudget', () => {
  it('returns basic report with empty messages', () => {
    const report = analyzeContextBudget({
      messages: [],
      maxContextTokens: 8000,
    })

    expect(report.totalTokens).toBe(0)
    expect(report.usagePercent).toBe(0)
    expect(report.maxContextTokens).toBe(8000)
    expect(report.categories).toHaveLength(7)
    expect(report.largestCategoryKey).toBeNull()
    expect(report.recommendations).toHaveLength(0)
    expect(report.timestamp).toBeGreaterThan(0)
  })

  it('counts system prompt tokens', () => {
    const systemPrompt = 'You are a helpful assistant.'
    const report = analyzeContextBudget({
      systemPrompt,
      messages: [],
      maxContextTokens: 8000,
    })

    const category = report.categories.find(c => c.key === 'systemPrompt')!
    expect(category.tokens).toBe(estimateTokens(systemPrompt))
    expect(category.itemCount).toBe(1)
    expect(report.totalTokens).toBe(category.tokens)
  })

  it('counts message tokens using built-in tokens when available', () => {
    const messages: AiMessage[] = [
      makeMessage({ role: 'user', content: 'Hello', tokens: 100 }),
      makeMessage({ role: 'assistant', content: 'Hi there', totalTokens: 200 }),
    ]
    const report = analyzeContextBudget({ messages, maxContextTokens: 8000 })

    const msgCategory = report.categories.find(c => c.key === 'messages')!
    expect(msgCategory.tokens).toBe(300)
    expect(msgCategory.itemCount).toBe(2)
  })

  it('falls back to content estimation when tokens are missing', () => {
    const content = 'Hello world this is a test message'
    const messages: AiMessage[] = [
      makeMessage({ role: 'user', content }),
    ]
    const report = analyzeContextBudget({ messages, maxContextTokens: 8000 })

    const msgCategory = report.categories.find(c => c.key === 'messages')!
    expect(msgCategory.tokens).toBe(estimateTokens(content))
  })

  it('skips divider and boundary messages', () => {
    const messages: AiMessage[] = [
      makeMessage({ role: 'user', content: 'Hello', tokens: 10 }),
      makeMessage({ role: 'assistant', content: 'divider', type: 'divider', tokens: 999 }),
      makeMessage({ role: 'assistant', content: 'compact', type: 'compact-boundary', tokens: 999 }),
      makeMessage({ role: 'assistant', content: 'rewind', type: 'rewind-boundary', tokens: 999 }),
    ]
    const report = analyzeContextBudget({ messages, maxContextTokens: 8000 })

    const msgCategory = report.categories.find(c => c.key === 'messages')!
    expect(msgCategory.tokens).toBe(10)
    expect(msgCategory.itemCount).toBe(1)
  })

  it('counts tool results separately from messages', () => {
    const messages: AiMessage[] = [
      makeMessage({
        role: 'assistant',
        content: 'result',
        toolResults: [
          { toolCallId: 'tc1', toolName: 'read_file', success: true, content: 'file content here' },
          { toolCallId: 'tc2', toolName: 'bash', success: false, content: 'error output here' },
        ],
      }),
    ]
    const report = analyzeContextBudget({ messages, maxContextTokens: 8000 })

    const toolCategory = report.categories.find(c => c.key === 'toolResults')!
    expect(toolCategory.itemCount).toBe(2)
    expect(toolCategory.tokens).toBe(
      estimateTokens('file content here') + estimateTokens('error output here'),
    )
  })

  it('counts memory tokens with item details', () => {
    const memories: AiMemory[] = [
      makeMemory({ title: 'Rule 1', content: 'Always use TypeScript' }),
      makeMemory({ title: 'Rule 2', content: 'Never commit secrets' }),
    ]
    const report = analyzeContextBudget({ messages: [], memories, maxContextTokens: 8000 })

    const memoryCategory = report.categories.find(c => c.key === 'memory')!
    expect(memoryCategory.itemCount).toBe(2)
    expect(memoryCategory.tokens).toBe(
      estimateTokens('Always use TypeScript') + estimateTokens('Never commit secrets'),
    )
    expect(memoryCategory.items).toHaveLength(2)
    expect(memoryCategory.items![0]!.label).toBe('Rule 1')
  })

  it('counts attachment tokens with item details', () => {
    const attachments: FileAttachment[] = [
      makeAttachment({ name: 'a.ts', content: 'const x = 1', lines: 1 }),
      makeAttachment({ name: 'b.ts', content: 'const y = 2', lines: 1 }),
    ]
    const report = analyzeContextBudget({ messages: [], attachments, maxContextTokens: 8000 })

    const attCategory = report.categories.find(c => c.key === 'attachments')!
    expect(attCategory.itemCount).toBe(2)
    expect(attCategory.tokens).toBe(
      estimateTokens('const x = 1') + estimateTokens('const y = 2'),
    )
    expect(attCategory.items).toHaveLength(2)
  })

  it('counts compact summary tokens', () => {
    const compactSummary = 'Previously we discussed database schema design.'
    const report = analyzeContextBudget({
      messages: [],
      compactSummary,
      maxContextTokens: 8000,
    })

    const compactCategory = report.categories.find(c => c.key === 'compactSummary')!
    expect(compactCategory.tokens).toBe(estimateTokens(compactSummary))
    expect(compactCategory.itemCount).toBe(1)
  })

  it('counts safety context tokens', () => {
    const safetyContext = 'Current permission mode: ask'
    const report = analyzeContextBudget({
      messages: [],
      safetyContext,
      maxContextTokens: 8000,
    })

    const safetyCategory = report.categories.find(c => c.key === 'safetyContext')!
    expect(safetyCategory.tokens).toBe(estimateTokens(safetyContext))
  })

  it('calculates usage percent correctly', () => {
    const messages: AiMessage[] = [
      makeMessage({ role: 'user', content: 'x'.repeat(3500), tokens: 1000 }),
    ]
    const report = analyzeContextBudget({ messages, maxContextTokens: 4000 })

    expect(report.usagePercent).toBe(25) // 1000 / 4000 = 25%
  })

  it('caps usage percent at 100', () => {
    const messages: AiMessage[] = [
      makeMessage({ role: 'user', content: 'x'.repeat(14000), tokens: 5000 }),
    ]
    const report = analyzeContextBudget({ messages, maxContextTokens: 4000 })

    expect(report.usagePercent).toBe(100)
  })

  it('identifies largest category', () => {
    const messages: AiMessage[] = [
      makeMessage({ role: 'user', content: 'short', tokens: 10 }),
    ]
    const report = analyzeContextBudget({
      systemPrompt: 'a'.repeat(700), // ~200 tokens
      messages,
      maxContextTokens: 8000,
    })

    expect(report.largestCategoryKey).toBe('systemPrompt')
  })

  it('recommends compression when usage >= 90%', () => {
    const messages: AiMessage[] = [
      makeMessage({ role: 'user', content: 'x'.repeat(12600), tokens: 3600 }),
    ]
    const report = analyzeContextBudget({ messages, maxContextTokens: 4000 })

    expect(report.recommendations.some(r => r.includes('90%'))).toBe(true)
  })

  it('recommends cleaning tool results when they dominate', () => {
    const messages: AiMessage[] = [
      makeMessage({
        role: 'assistant',
        content: 'small',
        tokens: 10,
        toolResults: [
          { toolCallId: 'tc1', toolName: 'read_file', success: true, content: 'x'.repeat(1400) },
        ],
      }),
    ]
    const report = analyzeContextBudget({ messages, maxContextTokens: 8000 })

    const toolTokens = report.categories.find(c => c.key === 'toolResults')!.tokens
    expect(toolTokens / report.totalTokens).toBeGreaterThan(0.4)
    expect(report.recommendations.some(r => r.includes('工具结果'))).toBe(true)
  })

  it('recommends removing attachments when they dominate', () => {
    const attachments: FileAttachment[] = [
      makeAttachment({ name: 'big.ts', content: 'x'.repeat(1400) }),
    ]
    const report = analyzeContextBudget({ messages: [], attachments, maxContextTokens: 8000 })

    const attTokens = report.categories.find(c => c.key === 'attachments')!.tokens
    expect(attTokens / report.totalTokens).toBeGreaterThan(0.3)
    expect(report.recommendations.some(r => r.includes('附件'))).toBe(true)
  })

  it('recommends checking memory when memory dominates', () => {
    const memories: AiMemory[] = [
      makeMemory({ content: 'x'.repeat(1400) }),
    ]
    const report = analyzeContextBudget({ messages: [], memories, maxContextTokens: 8000 })

    const memTokens = report.categories.find(c => c.key === 'memory')!.tokens
    expect(memTokens / report.totalTokens).toBeGreaterThan(0.25)
    expect(report.recommendations.some(r => r.includes('记忆'))).toBe(true)
  })
})

describe('getCategoryPercent', () => {
  it('returns correct percent for a category', () => {
    const report = analyzeContextBudget({
      messages: [
        makeMessage({ role: 'user', content: 'a', tokens: 100 }),
      ],
      systemPrompt: 'b', // ~1 token
      maxContextTokens: 8000,
    })

    const msgPercent = getCategoryPercent(report, 'messages')
    expect(msgPercent).toBeGreaterThan(90) // messages should dominate

    const sysPercent = getCategoryPercent(report, 'systemPrompt')
    expect(sysPercent).toBeLessThan(10)
  })

  it('returns 0 for non-existent category', () => {
    const report = analyzeContextBudget({ messages: [], maxContextTokens: 8000 })
    expect(getCategoryPercent(report, 'messages')).toBe(0)
  })

  it('returns 0 when total is 0', () => {
    const report = analyzeContextBudget({ messages: [], maxContextTokens: 8000 })
    expect(getCategoryPercent(report, 'systemPrompt')).toBe(0)
  })
})
