import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(__dirname, '../../..')

function readSource(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8')
}

function expectGatewayRequestCoverage(
  source: string,
  options: {
    sourceName: string
    kind: string
  },
): void {
  expect(source).toContain('executeGatewayRequest')
  expect(source).toContain(`source: '${options.sourceName}'`)
  expect(source).toContain(`kind: '${options.kind}'`)
  expect(source).toContain('apiKeysByProvider')
  expect(source).toContain('fallbackChain')
}

describe('Gateway coverage guard', () => {
  it('routes chat through Gateway with fallback context', () => {
    const source = readSource('src/composables/ai/chatToolLoop.ts')

    expectGatewayRequestCoverage(source, {
      sourceName: 'chat',
      kind: 'chat_completions',
    })
    expect(source).not.toMatch(/\baiChatStream\s*\(/)
  })

  it('routes compact through Gateway with fallback context', () => {
    const source = readSource('src/composables/useAutoCompact.ts')

    expectGatewayRequestCoverage(source, {
      sourceName: 'compact',
      kind: 'compact',
    })
    expect(source).not.toMatch(/\baiChatStream\s*\(/)
  })

  it('routes prompt optimize through Gateway with fallback context', () => {
    const source = readSource('src/composables/ai/promptOptimizer.ts')

    expectGatewayRequestCoverage(source, {
      sourceName: 'prompt_optimize',
      kind: 'prompt_optimize',
    })
    expect(source).not.toMatch(/\baiChatStream\s*\(/)
  })
})
