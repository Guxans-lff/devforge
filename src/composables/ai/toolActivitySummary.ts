import type {
  ToolActivityBucket,
  ToolActivityCategory,
  ToolActivitySummary,
  ToolCallInfo,
  ToolResultInfo,
} from '@/types/ai'

export const TOOL_ACTIVITY_LABELS: Record<ToolActivityCategory, string> = {
  read: '读取',
  search: '搜索',
  write: '修改',
  command: '命令',
  web: '网页',
  database: '数据库',
  todo: '任务',
  agent: '子任务',
  other: '其他',
}

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  todo_write: '任务计划',
  edit_file: '修改文件',
  write_file: '写入文件',
  delete_file: '删除文件',
  move_file: '移动文件',
  rename_file: '重命名文件',
  read_file: '读取文件',
  search_files: '搜索文件',
  grep: '搜索内容',
  list_files: '列出文件',
  list_directory: '浏览目录',
  bash: '执行命令',
  run_shell: '执行命令',
  web_fetch: '读取网页',
  web_search: '联网搜索',
  db_query: '查询数据库',
  db_execute: '执行 SQL',
  spawn_agent: '启动子任务',
}

export function toToolDisplayName(name: string): string {
  return TOOL_DISPLAY_NAMES[name] ?? name.replace(/_/g, ' ')
}

export function classifyToolActivity(name: string): ToolActivityCategory {
  if (/^(todo|task_plan|update_plan)/i.test(name)) return 'todo'
  if (/^(spawn_agent|agent|subtask)/i.test(name)) return 'agent'
  if (/^(read|list|ls|cat|view|get_file|open_file)/i.test(name)) return 'read'
  if (/^(search|grep|find|ripgrep|rg)/i.test(name)) return 'search'
  if (/^(write|edit|delete|move|rename|create|apply|patch|mkdir|rm|chmod|chown)/i.test(name)) return 'write'
  if (/^(bash|run|shell|exec|terminal|powershell|cmd)/i.test(name)) return 'command'
  if (/^(web|http|fetch|browser)/i.test(name)) return 'web'
  if (/^(db|database|sql|query)/i.test(name)) return 'database'
  return 'other'
}

interface SummaryInput {
  toolCalls?: Array<Pick<ToolCallInfo, 'name' | 'status'>>
  toolResults?: Array<Pick<ToolResultInfo, 'toolName' | 'success'>>
  fallbackToolNames?: string[]
}

export function summarizeToolActivity(input: SummaryInput): ToolActivitySummary {
  const toolCalls = input.toolCalls ?? []
  const toolResults = input.toolResults ?? []
  const fallbackToolNames = input.fallbackToolNames ?? []
  const orderedNames = new Set<string>()
  const buckets = new Map<ToolActivityCategory, ToolActivityBucket>()

  function ensureBucket(category: ToolActivityCategory): ToolActivityBucket {
    const existing = buckets.get(category)
    if (existing) return existing
    const bucket: ToolActivityBucket = {
      category,
      label: TOOL_ACTIVITY_LABELS[category],
      count: 0,
      successCount: 0,
      errorCount: 0,
      pendingCount: 0,
      toolNames: [],
    }
    buckets.set(category, bucket)
    return bucket
  }

  function addToolName(bucket: ToolActivityBucket, name: string): void {
    if (!name) return
    orderedNames.add(name)
    if (!bucket.toolNames.includes(name)) bucket.toolNames.push(name)
  }

  for (const tool of toolCalls) {
    const category = classifyToolActivity(tool.name)
    const bucket = ensureBucket(category)
    bucket.count += 1
    addToolName(bucket, tool.name)

    if (tool.status === 'success') bucket.successCount += 1
    else if (tool.status === 'error') bucket.errorCount += 1
    else bucket.pendingCount += 1
  }

  for (const result of toolResults) {
    const category = classifyToolActivity(result.toolName)
    const bucket = ensureBucket(category)
    addToolName(bucket, result.toolName)
    if (result.success) bucket.successCount += 1
    else bucket.errorCount += 1
  }

  if (toolCalls.length === 0) {
    for (const name of fallbackToolNames) {
      const category = classifyToolActivity(name)
      const bucket = ensureBucket(category)
      bucket.count += 1
      addToolName(bucket, name)
    }
  }

  const orderedBuckets = Array.from(buckets.values())
    .filter(bucket => bucket.count > 0 || bucket.successCount > 0 || bucket.errorCount > 0)
    .map(bucket => ({
      ...bucket,
      toolNames: bucket.toolNames.slice(0, 4),
    }))

  const successCount = orderedBuckets.reduce((sum, bucket) => sum + bucket.successCount, 0)
  const errorCount = orderedBuckets.reduce((sum, bucket) => sum + bucket.errorCount, 0)
  const pendingCount = orderedBuckets.reduce((sum, bucket) => sum + bucket.pendingCount, 0)

  return {
    callCount: toolCalls.length || fallbackToolNames.length,
    resultCount: toolResults.length,
    successCount,
    errorCount,
    pendingCount,
    toolNames: Array.from(orderedNames).slice(0, 6),
    buckets: orderedBuckets,
    hasWrite: orderedBuckets.some(bucket => bucket.category === 'write'),
    hasCommand: orderedBuckets.some(bucket => bucket.category === 'command'),
    hasFailure: errorCount > 0,
  }
}

