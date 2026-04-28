import { describe, expect, it } from 'vitest'
import { parseMcpConfig, summarizeMcpStatus } from './mcpStatus'
import type { ModelConfig, ToolDefinition } from '@/types/ai'

function tool(name: string): ToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description: name,
      parameters: {},
    },
  }
}

function model(toolUse = true): ModelConfig {
  return {
    id: 'm1',
    name: 'Model 1',
    capabilities: {
      streaming: true,
      vision: false,
      thinking: false,
      toolUse,
      maxContext: 32000,
      maxOutput: 4096,
    },
  }
}

describe('mcpStatus', () => {
  it('returns ready when model, workdir and tools are available', () => {
    const summary = summarizeMcpStatus({
      tools: [tool('read_file'), tool('web_fetch'), tool('bash')],
      model: model(true),
      workDir: 'D:/Project/devforge',
    })

    expect(summary.level).toBe('ready')
    expect(summary.toolCount).toBe(3)
    expect(summary.categories.map(category => category.key)).toEqual(['file', 'web', 'shell'])
  })

  it('parses mcp server config and reports server counts', () => {
    const config = parseMcpConfig(JSON.stringify({
      mcpServers: {
        context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
        docs: { url: 'https://example.com/sse' },
        disabledOne: { command: 'node', disabled: true },
      },
    }))
    const summary = summarizeMcpStatus({
      tools: [tool('read_file')],
      model: model(true),
      workDir: 'D:/Project/devforge',
      mcpConfig: config,
    })

    expect(config.servers.map(server => server.transport)).toEqual(['stdio', 'sse', 'stdio'])
    expect(summary.level).toBe('ready')
    expect(summary.serverCount).toBe(3)
    expect(summary.enabledServerCount).toBe(2)
    expect(summary.title).toContain('MCP')
  })

  it('returns disabled when model cannot use tools', () => {
    const summary = summarizeMcpStatus({
      tools: [tool('read_file')],
      model: model(false),
      workDir: 'D:/Project/devforge',
    })

    expect(summary.level).toBe('disabled')
    expect(summary.issues.join('\n')).toContain('toolUse')
  })

  it('returns degraded when workdir or tools are missing', () => {
    const summary = summarizeMcpStatus({
      tools: [],
      model: model(true),
      workDir: '',
    })

    expect(summary.level).toBe('degraded')
    expect(summary.issues).toHaveLength(2)
  })

  it('returns degraded when mcp config cannot be parsed', () => {
    const summary = summarizeMcpStatus({
      tools: [tool('read_file')],
      model: model(true),
      workDir: 'D:/Project/devforge',
      mcpConfig: parseMcpConfig('{bad json'),
    })

    expect(summary.level).toBe('degraded')
    expect(summary.issues.join('\n')).toContain('.mcp.json 解析失败')
  })

  it('returns error when tool loading failed', () => {
    const summary = summarizeMcpStatus({
      tools: [],
      model: model(true),
      workDir: 'D:/Project/devforge',
      error: 'backend failed',
    })

    expect(summary.level).toBe('error')
    expect(summary.description).toBe('backend failed')
  })
})

