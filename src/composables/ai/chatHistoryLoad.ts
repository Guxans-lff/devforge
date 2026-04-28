import { aiGetSession } from '@/api/ai'
import type { AiMessage, AiMessageRecord, AiSession, ToolCallInfo, ToolResultInfo } from '@/types/ai'
import { sanitizeLoadedMessages } from './chatMessageBuilder'

export const HISTORY_RECENT_RECORD_LIMIT = 50
export const HISTORY_LOAD_STEP = 50
export const HISTORY_CACHE_TTL_MS = 5 * 60 * 1000
export const HISTORY_CACHE_MAX_ENTRIES = 24
export const HISTORY_SAFE_TOTAL_CHAR_BUDGET = 80_000
export const HISTORY_SAFE_MESSAGE_CHAR_LIMIT = 12_000
export const HISTORY_SAFE_TOOL_RESULT_CHAR_LIMIT = 4_000
export const HISTORY_SAFE_TOOL_ARGUMENT_CHAR_LIMIT = 4_000
export const HISTORY_SAFE_PARSED_ARG_STRING_LIMIT = 2_000
export const HISTORY_SAFE_FILE_CONTENT_CHAR_LIMIT = 2_000

export interface ChatHistoryWindow {
  windowSize: number
  loadedRecords: number
  totalRecords: number
}

export interface LoadedChatHistory {
  session: AiSession | null
  messages: AiMessage[]
  window: ChatHistoryWindow
  truncated: boolean
}

interface HistoryCacheEntry {
  value: LoadedChatHistory
  expiresAt: number
}

const historyCache = new Map<string, HistoryCacheEntry>()
const inflightRequests = new Map<string, Promise<LoadedChatHistory>>()

function cacheKey(sessionId: string, windowSize: number): string {
  return `${sessionId}:${windowSize}`
}

export async function loadChatHistoryWindow(
  sessionId: string,
  windowSize: number,
): Promise<LoadedChatHistory> {
  const key = cacheKey(sessionId, windowSize)
  const cached = readHistoryCache(key)
  if (cached) return cached

  const inflight = inflightRequests.get(key)
  if (inflight) return inflight

  const request = (async () => {
    const result = await aiGetSession(sessionId, windowSize)

    if (!result) {
      return {
        session: null,
        messages: [],
        window: {
          windowSize,
          loadedRecords: 0,
          totalRecords: 0,
        },
        truncated: false,
      }
    }

    const { session, messages: records, truncated, totalRecords, loadedRecords } = result
    const safeMessages = restoreMessagesLightweight(records)

    return {
      session,
      messages: buildHistoryMessages(sessionId, safeMessages, {
        truncated,
        loadedRecords,
        totalRecords,
      }),
      window: {
        windowSize,
        loadedRecords,
        totalRecords,
      },
      truncated,
    }
  })()

  inflightRequests.set(key, request)

  try {
    const loaded = await request
    writeHistoryCache(key, loaded)
    return loaded
  } finally {
    inflightRequests.delete(key)
  }
}

export async function preloadChatHistoryWindow(
  sessionId: string,
  windowSize: number,
): Promise<void> {
  if (!sessionId || windowSize <= 0) return

  try {
    await loadChatHistoryWindow(sessionId, windowSize)
  } catch {
    // Best-effort warmup: ignore cache preloading failures.
  }
}

export function invalidateChatHistoryCache(sessionId?: string): void {
  if (!sessionId) {
    historyCache.clear()
    inflightRequests.clear()
    return
  }

  for (const key of historyCache.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      historyCache.delete(key)
    }
  }
  for (const key of inflightRequests.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      inflightRequests.delete(key)
    }
  }
}

export function canExpandHistoryWindow(window: ChatHistoryWindow): boolean {
  return window.totalRecords > 0 && window.loadedRecords < window.totalRecords
}

export function getExpandedHistoryWindowSize(currentWindowSize: number): number {
  return currentWindowSize + HISTORY_LOAD_STEP
}

function readHistoryCache(key: string): LoadedChatHistory | null {
  purgeExpiredHistoryCacheEntries()

  const entry = historyCache.get(key)
  if (!entry) return null

  historyCache.delete(key)
  historyCache.set(key, {
    value: entry.value,
    expiresAt: Date.now() + HISTORY_CACHE_TTL_MS,
  })

  return entry.value
}

function writeHistoryCache(key: string, value: LoadedChatHistory): void {
  purgeExpiredHistoryCacheEntries()

  if (historyCache.has(key)) {
    historyCache.delete(key)
  }

  historyCache.set(key, {
    value,
    expiresAt: Date.now() + HISTORY_CACHE_TTL_MS,
  })

  while (historyCache.size > HISTORY_CACHE_MAX_ENTRIES) {
    const oldestKey = historyCache.keys().next().value
    if (!oldestKey) break
    historyCache.delete(oldestKey)
  }
}

function purgeExpiredHistoryCacheEntries(now = Date.now()): void {
  for (const [key, entry] of historyCache.entries()) {
    if (entry.expiresAt <= now) {
      historyCache.delete(key)
    }
  }
}

function buildHistoryMessages(
  sessionId: string,
  restored: AiMessage[],
  metadata: {
    truncated: boolean
    loadedRecords: number
    totalRecords: number
  },
): AiMessage[] {
  if (!metadata.truncated) return restored

  return [
    {
      id: `history-window-${sessionId}`,
      role: 'assistant',
      content: '',
      timestamp: restored[0]?.timestamp ?? Date.now(),
      type: 'divider',
      dividerMeta: {
        kind: 'history-window',
        loadedRecords: metadata.loadedRecords,
        totalRecords: metadata.totalRecords,
        remainingRecords: Math.max(0, metadata.totalRecords - metadata.loadedRecords),
      },
    },
    ...restored,
  ]
}

export function sanitizeRecordsForRestore(records: AiMessageRecord[]): AiMessageRecord[] {
  return records.map(record => {
    if (record.contentType === 'tool_result') {
      return {
        ...record,
        content: truncateHistoryText(
          record.content,
          HISTORY_SAFE_TOOL_RESULT_CHAR_LIMIT,
          '工具结果过大，已折叠历史预览',
        ),
      }
    }

    if (record.contentType !== 'tool_calls') {
      const sanitizedContent = sanitizeHistoryFileMarkers(record.content)
      return {
        ...record,
        content: truncateHistoryText(
          sanitizedContent,
          HISTORY_SAFE_MESSAGE_CHAR_LIMIT,
          '历史消息过大，已折叠预览',
        ),
      }
    }

    return {
      ...record,
      content: sanitizeToolCallsRecordContent(record.content),
    }
  })
}

function sanitizeHistoryFileMarkers(content: string): string {
  if (!content.includes('<file ')) return content

  return content.replace(
    /<file\s+name="([^"]*?)"\s+path="([^"]*?)"\s+size="(\d+)"\s+lines="(\d+)"(?:\s+type="([^"]*?)")?>\n?([\s\S]*?)\n?<\/file>/g,
    (_full, name: string, path: string, size: string, lines: string, fileType: string | undefined, fileContent: string) => {
      if (fileType === 'image') {
        return `[历史图片附件已折叠：${name}，路径：${path}，大小：${formatHistoryBytes(Number(size))}。完整图片仍保留在本地历史库中。]`
      }

      const safeContent = truncateHistoryText(
        fileContent,
        HISTORY_SAFE_FILE_CONTENT_CHAR_LIMIT,
        '历史附件内容过大，已折叠预览',
      )
      return `<file name="${name}" path="${path}" size="${size}" lines="${lines}">\n${safeContent}\n</file>`
    },
  )
}

function formatHistoryBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function applyHistorySafetyBudget(messages: AiMessage[]): AiMessage[] {
  let remainingBudget = HISTORY_SAFE_TOTAL_CHAR_BUDGET
  const safeMessages = new Array<AiMessage>(messages.length)

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    const messageChars = estimateMessageChars(message)
    if (remainingBudget <= 0) {
      safeMessages[index] = omitHistoryMessageContent(message)
      continue
    }

    const limit = Math.min(HISTORY_SAFE_MESSAGE_CHAR_LIMIT, remainingBudget)
    safeMessages[index] = sanitizeHistoryMessage(message, limit)
    remainingBudget -= Math.min(messageChars, limit)
  }

  return safeMessages
}

function sanitizeHistoryMessage(message: AiMessage, contentLimit: number): AiMessage {
  const next: AiMessage = {
    ...message,
    content: truncateHistoryText(
      message.content,
      contentLimit,
      '历史消息过大，已折叠预览',
    ),
  }

  if (next.thinking) {
    next.thinking = truncateHistoryText(next.thinking, 4_000, '思考内容过大，已折叠预览')
  }

  if (message.toolCalls) {
    next.toolCalls = message.toolCalls.map(sanitizeHistoryToolCall)
  }

  if (message.toolResults) {
    next.toolResults = message.toolResults.map(sanitizeHistoryToolResult)
  }

  return collapseHistoryTools(next)
}

function sanitizeHistoryToolCall(toolCall: ToolCallInfo): ToolCallInfo {
  const parsedArgs = sanitizeParsedArgs(toolCall.parsedArgs)
  const argumentsText = serializeSafeArguments(toolCall.arguments, parsedArgs)
  const error = toolCall.error
    ? truncateHistoryText(toolCall.error, HISTORY_SAFE_TOOL_RESULT_CHAR_LIMIT, '工具错误过大，已折叠历史预览')
    : toolCall.error

  return {
    ...toolCall,
    arguments: argumentsText,
    parsedArgs,
    result: undefined,
    error,
  }
}

function sanitizeHistoryToolResult(result: ToolResultInfo): ToolResultInfo {
  return {
    ...result,
    content: truncateHistoryText(
      result.content,
      HISTORY_SAFE_TOOL_RESULT_CHAR_LIMIT,
      '工具结果过大，已折叠历史预览',
    ),
  }
}

function collapseHistoryTools(message: AiMessage): AiMessage {
  const toolCallCount = message.toolCalls?.length ?? 0
  const toolResultCount = message.toolResults?.length ?? 0
  if (toolCallCount === 0 && toolResultCount === 0) return message

  const names = Array.from(new Set((message.toolCalls ?? []).map(tool => tool.name))).slice(0, 4)
  const summary = [
    `[历史工具调用已折叠：${toolCallCount} 个调用，${toolResultCount} 个结果]`,
    names.length ? `工具：${names.join('、')}` : '',
    '完整工具参数与结果仍保留在本地历史中。',
  ].filter(Boolean).join('\n')

  return {
    ...message,
    content: message.content?.trim()
      ? `${message.content}\n\n${summary}`
      : summary,
    toolCalls: undefined,
    toolResults: undefined,
  }
}

function omitHistoryMessageContent(message: AiMessage): AiMessage {
  const omittedChars = estimateMessageChars(message)
  return {
    ...message,
    content: buildOmittedText(omittedChars, '较早历史内容已折叠，避免恢复会话时卡顿'),
    thinking: undefined,
    toolCalls: undefined,
    toolResults: undefined,
  }
}

function estimateMessageChars(message: AiMessage): number {
  let total = message.content?.length ?? 0
  total += message.thinking?.length ?? 0

  for (const toolCall of message.toolCalls ?? []) {
    total += toolCall.arguments?.length ?? 0
    total += toolCall.result?.length ?? 0
    total += toolCall.error?.length ?? 0
  }

  for (const result of message.toolResults ?? []) {
    total += result.content.length
  }

  return total
}

function truncateHistoryText(text: string, limit: number, reason: string): string {
  if (text.length <= limit) return text
  if (limit <= 0) return buildOmittedText(text.length, reason)

  const marker = `\n\n[${reason}：原始 ${text.length.toLocaleString()} 字符，完整内容仍保留在本地历史中]\n\n`
  const available = Math.max(0, limit - marker.length)
  if (available <= 0) return buildOmittedText(text.length, reason)

  const headLength = Math.ceil(available * 0.7)
  const tailLength = Math.max(0, available - headLength)
  return `${text.slice(0, headLength)}${marker}${tailLength > 0 ? text.slice(-tailLength) : ''}`
}

function buildOmittedText(originalChars: number, reason: string): string {
  return `[${reason}：原始 ${originalChars.toLocaleString()} 字符，完整内容仍保留在本地历史中]`
}

function sanitizeParsedArgs(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return sanitizeUnknownValue(value, HISTORY_SAFE_PARSED_ARG_STRING_LIMIT) as Record<string, unknown>
}

function sanitizeUnknownValue(value: unknown, stringLimit: number): unknown {
  if (typeof value === 'string') {
    return truncateHistoryText(value, stringLimit, '参数内容过大，已折叠历史预览')
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, 50).map(item => sanitizeUnknownValue(item, stringLimit))
    if (value.length > items.length) {
      items.push(`[数组过大，已折叠 ${value.length - items.length} 项]`)
    }
    return items
  }

  if (!value || typeof value !== 'object') return value

  const entries = Object.entries(value as Record<string, unknown>)
  const safeEntries = entries.slice(0, 80).map(([key, item]) => [
    key,
    sanitizeUnknownValue(item, stringLimit),
  ])
  if (entries.length > safeEntries.length) {
    safeEntries.push(['__truncated__', `对象过大，已折叠 ${entries.length - safeEntries.length} 个字段`])
  }
  return Object.fromEntries(safeEntries)
}

function serializeSafeArguments(
  originalArguments: string,
  parsedArgs: Record<string, unknown> | undefined,
): string {
  if (parsedArgs) {
    try {
      return truncateHistoryText(
        JSON.stringify(parsedArgs),
        HISTORY_SAFE_TOOL_ARGUMENT_CHAR_LIMIT,
        '工具参数过大，已折叠历史预览',
      )
    } catch {
      return '{}'
    }
  }

  return truncateHistoryText(
    originalArguments,
    HISTORY_SAFE_TOOL_ARGUMENT_CHAR_LIMIT,
    '工具参数过大，已折叠历史预览',
  )
}

function sanitizeToolCallsRecordContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!Array.isArray(parsed)) return '[]'

    return JSON.stringify(parsed.map((item, index) => {
      const raw = (item ?? {}) as Partial<ToolCallInfo>
      const parsedArgs = sanitizeToolCallRecordArgs(raw.arguments, raw.parsedArgs)
      return {
        ...raw,
        id: typeof raw.id === 'string' && raw.id ? raw.id : `restored-tool-${index}`,
        name: typeof raw.name === 'string' ? raw.name : 'unknown',
        arguments: serializeSafeArguments(
          typeof raw.arguments === 'string' ? raw.arguments : '',
          parsedArgs,
        ),
        parsedArgs,
        result: typeof raw.result === 'string'
          ? truncateHistoryText(raw.result, HISTORY_SAFE_TOOL_RESULT_CHAR_LIMIT, '工具结果过大，已折叠历史预览')
          : raw.result,
        error: typeof raw.error === 'string'
          ? truncateHistoryText(raw.error, HISTORY_SAFE_TOOL_RESULT_CHAR_LIMIT, '工具错误过大，已折叠历史预览')
          : raw.error,
      }
    }))
  } catch {
    return '[]'
  }
}

function sanitizeToolCallRecordArgs(
  argumentsText: unknown,
  parsedArgs: unknown,
): Record<string, unknown> | undefined {
  const safeParsedArgs = sanitizeParsedArgs(parsedArgs)
  if (safeParsedArgs) return safeParsedArgs

  if (typeof argumentsText !== 'string') return undefined
  try {
    return sanitizeParsedArgs(JSON.parse(argumentsText))
  } catch {
    return undefined
  }
}

/**
 * 轻量级历史恢复：跳过 tool_calls/tool_result 的 JSON 解析，
 * 直接用正则提取工具名和计数，生成折叠摘要。
 * 比 sanitizeRecordsForRestore + restoreMessagesFromRecords + applyHistorySafetyBudget
 * 快一个数量级（避免 6+ 次 JSON.parse/stringify per tool_calls record）。
 */
function restoreMessagesLightweight(records: AiMessageRecord[]): AiMessage[] {
  const messages: AiMessage[] = []
  let remainingBudget = HISTORY_SAFE_TOTAL_CHAR_BUDGET

  interface PendingToolGroup {
    messageId: string
    timestamp: number
    tokens?: number
    toolCallCount: number
    toolResultCount: number
    toolNames: Set<string>
  }

  let pendingGroup: PendingToolGroup | null = null

  function flushGroup(): void {
    if (!pendingGroup) return
    const { messageId, timestamp, tokens, toolCallCount, toolResultCount, toolNames } = pendingGroup
    const names = Array.from(toolNames).slice(0, 4)
    const summary = [
      `[历史工具调用已折叠：${toolCallCount} 个调用，${toolResultCount} 个结果]`,
      names.length ? `工具：${names.join('、')}` : '',
      '完整工具参数与结果仍保留在本地历史中。',
    ].filter(Boolean).join('\n')
    messages.push({
      id: messageId,
      role: 'assistant',
      content: summary,
      timestamp,
      tokens,
      totalTokens: tokens,
    })
    pendingGroup = null
  }

  for (const record of records) {
    if (record.role === 'assistant' && record.contentType === 'tool_calls') {
      flushGroup()
      const toolNames = new Set<string>()
      const nameMatches = record.content.matchAll(/"name"\s*:\s*"([^"]+)"/g)
      for (const m of nameMatches) toolNames.add(m[1]!)
      const countMatches = record.content.match(/\{[^{}]*"id"\s*:/g)
      pendingGroup = {
        messageId: record.id,
        timestamp: record.createdAt,
        tokens: record.tokens,
        toolCallCount: countMatches?.length ?? (toolNames.size || 1),
        toolResultCount: 0,
        toolNames,
      }
      continue
    }

    if (record.role === 'tool' && record.contentType === 'tool_result') {
      if (pendingGroup) {
        pendingGroup.toolResultCount += 1
        if (record.toolName) pendingGroup.toolNames.add(record.toolName)
      }
      continue
    }

    flushGroup()

    const sanitizedContent = sanitizeHistoryFileMarkers(record.content)
    const charLimit = Math.min(HISTORY_SAFE_MESSAGE_CHAR_LIMIT, Math.max(0, remainingBudget))
    const content = remainingBudget <= 0
      ? buildOmittedText(record.content.length, '较早历史内容已折叠，避免恢复会话时卡顿')
      : truncateHistoryText(sanitizedContent, charLimit, '历史消息过大，已折叠预览')
    remainingBudget -= Math.min(record.content.length, charLimit)

    messages.push({
      id: record.id,
      role: record.role as AiMessage['role'],
      content,
      timestamp: record.createdAt,
      tokens: record.tokens,
      totalTokens: record.tokens,
    })
  }

  flushGroup()
  return sanitizeLoadedMessages(messages)
}
