import type { McpStatusResult, ModelConfig, ToolDefinition } from '@/types/ai'

export type McpStatusLevel = 'ready' | 'degraded' | 'disabled' | 'error'
export type McpServerTransport = 'stdio' | 'sse' | 'http' | 'unknown'

export interface McpServerStatus {
  name: string
  transport: McpServerTransport | string
  command?: string
  url?: string
  disabled?: boolean
  status?: string
  message?: string
}

export interface McpConfigParseResult {
  servers: McpServerStatus[]
  error?: string
}

export interface McpStatusSummary {
  level: McpStatusLevel
  title: string
  description: string
  toolCount: number
  serverCount: number
  enabledServerCount: number
  configPath?: string | null
  configExists?: boolean
  categories: Array<{ key: string; label: string; count: number }>
  servers: McpServerStatus[]
  issues: string[]
}

function categorizeTool(name: string): string {
  if (/file|directory|glob|grep|search/i.test(name)) return 'file'
  if (/web|fetch|search/i.test(name)) return 'web'
  if (/bash|shell|command/i.test(name)) return 'shell'
  if (/db|sql|database/i.test(name)) return 'database'
  return 'other'
}

function categoryLabel(key: string): string {
  switch (key) {
    case 'file': return '文件工具'
    case 'web': return '网络工具'
    case 'shell': return 'Shell 工具'
    case 'database': return '数据库工具'
    default: return '其他工具'
  }
}

function detectTransport(config: Record<string, unknown>): McpServerTransport {
  if (typeof config.command === 'string') return 'stdio'
  if (typeof config.url === 'string') {
    return String(config.url).includes('/sse') ? 'sse' : 'http'
  }
  if (typeof config.transport === 'string') {
    const transport = config.transport.toLowerCase()
    if (transport === 'stdio' || transport === 'sse' || transport === 'http') return transport
  }
  return 'unknown'
}

export function parseMcpConfig(raw: string | null | undefined): McpConfigParseResult {
  if (!raw?.trim()) return { servers: [] }

  try {
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, Record<string, unknown>>; servers?: Record<string, Record<string, unknown>> }
    const source = parsed.mcpServers ?? parsed.servers ?? {}
    const servers = Object.entries(source).map(([name, config]) => ({
      name,
      transport: detectTransport(config),
      command: typeof config.command === 'string' ? config.command : undefined,
      url: typeof config.url === 'string' ? config.url : undefined,
      disabled: config.disabled === true,
    }))
    return { servers }
  } catch (error) {
    return { servers: [], error: error instanceof Error ? error.message : String(error) }
  }
}

function runtimeIssue(server: McpServerStatus): string | null {
  if (server.disabled) return null
  if (server.status === 'error') return `${server.name} 连接异常${server.message ? `：${server.message}` : ''}`
  if (server.status === 'unknown') return `${server.name} 未声明可识别的 command/url/transport`
  return null
}

export function summarizeMcpStatus(input: {
  tools: ToolDefinition[]
  model?: ModelConfig | null
  workDir?: string
  loading?: boolean
  error?: string | null
  mcpConfig?: McpConfigParseResult | null
  mcpRuntime?: McpStatusResult | null
}): McpStatusSummary {
  const issues: string[] = []
  const tools = input.tools ?? []
  const toolCount = tools.length
  const servers = input.mcpRuntime?.servers ?? input.mcpConfig?.servers ?? []
  const serverCount = servers.length
  const enabledServerCount = servers.filter(server => !server.disabled).length
  const configPath = input.mcpRuntime?.configPath
  const configExists = input.mcpRuntime?.configExists
  const categoryCounts = new Map<string, number>()

  for (const tool of tools) {
    const key = categorizeTool(tool.function.name)
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1)
  }

  const categories = Array.from(categoryCounts.entries()).map(([key, count]) => ({
    key,
    label: categoryLabel(key),
    count,
  }))

  if (input.error) {
    return {
      level: 'error',
      title: '工具状态异常',
      description: input.error,
      toolCount,
      serverCount,
      enabledServerCount,
      configPath,
      configExists,
      categories,
      servers,
      issues: [input.error],
    }
  }

  if (input.loading) {
    return {
      level: 'degraded',
      title: '正在检测工具',
      description: '正在读取本地 AI 工具定义和 MCP 配置。',
      toolCount,
      serverCount,
      enabledServerCount,
      configPath,
      configExists,
      categories,
      servers,
      issues,
    }
  }

  const parseError = input.mcpRuntime?.parseError ?? input.mcpConfig?.error
  if (parseError) {
    issues.push(`.mcp.json 解析失败：${parseError}`)
  }
  if (!input.model?.capabilities.toolUse) {
    issues.push('当前模型未开启 toolUse，AI 不会调用工具。')
  }
  if (!input.workDir) {
    issues.push('未选择工作目录，文件类工具和项目 MCP 配置不可用。')
  }
  if (toolCount === 0) {
    issues.push('后端未返回任何工具定义。')
  }
  // 未找到 .mcp.json 是正常状态，不加入 issues
  if (serverCount > 0 && enabledServerCount === 0) {
    issues.push('检测到 MCP 配置，但所有 server 都处于 disabled 状态。')
  }
  for (const server of servers) {
    const issue = runtimeIssue(server)
    if (issue) issues.push(issue)
  }

  if (issues.length > 0) {
    return {
      level: input.model?.capabilities.toolUse ? 'degraded' : 'disabled',
      title: input.model?.capabilities.toolUse ? '工具部分可用' : '工具已禁用',
      description: '存在影响工具调用或 MCP 配置生效的项目。',
      toolCount,
      serverCount,
      enabledServerCount,
      configPath,
      configExists,
      categories,
      servers,
      issues,
    }
  }

  return {
    level: 'ready',
    title: serverCount > 0 ? '工具与 MCP 就绪' : '工具就绪',
    description: serverCount > 0
      ? '当前模型支持工具调用，内置工具和项目 MCP 配置均已检测到。'
      : '当前模型支持工具调用，工作目录和内置工具定义均已就绪。',
    toolCount,
    serverCount,
    enabledServerCount,
    configPath,
    configExists,
    categories,
    servers,
    issues,
  }
}
