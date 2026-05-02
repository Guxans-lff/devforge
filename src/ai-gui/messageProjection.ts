import type { AiMessage } from '@/types/ai'

export interface AiMessageListItem {
  key: string
  message: AiMessage
  hideHeader?: boolean
  isGroupEnd?: boolean
  inGroup?: boolean
  stickyCompact?: boolean
}

interface MessageGroupProjection {
  isGroupStart: boolean
  isGroupEnd: boolean
  groupSize: number
  msg: AiMessage
}

interface CachedProjectionItem {
  signature: string
  item: AiMessageListItem
}

export interface AiMessageProjectionCache {
  project(messages: AiMessage[], latestUserMessageId: string | null): AiMessageListItem[]
  clear(): void
  size(): number
}

const DEFAULT_MAX_CACHE_SIZE = 2_000
const MESSAGE_SIGNATURE_CONTENT_LIMIT = 2_000

function buildTextSignature(text = ''): string {
  if (text.length <= MESSAGE_SIGNATURE_CONTENT_LIMIT) return text
  return `${text.length}:${text.slice(0, 1_000)}:${text.slice(-1_000)}`
}

export function isAiMessageBoundary(message: Pick<AiMessage, 'type'>): boolean {
  return message.type === 'divider'
    || message.type === 'compact-boundary'
    || message.type === 'rewind-boundary'
}

function shouldBreakAssistantGroup(message: AiMessage): boolean {
  return isAiMessageBoundary(message)
    || message.role === 'user'
    || message.role === 'error'
}

function buildGroups(messages: AiMessage[]): MessageGroupProjection[] {
  const result: MessageGroupProjection[] = []
  let index = 0

  while (index < messages.length) {
    const msg = messages[index]!
    if (shouldBreakAssistantGroup(msg)) {
      result.push({ isGroupStart: true, isGroupEnd: true, groupSize: 1, msg })
      index += 1
      continue
    }

    let end = index
    while (
      end < messages.length
      && messages[end]!.role === 'assistant'
      && !isAiMessageBoundary(messages[end]!)
    ) {
      end += 1
    }

    const groupSize = end - index
    for (let cursor = index; cursor < end; cursor += 1) {
      result.push({
        isGroupStart: cursor === index,
        isGroupEnd: cursor === end - 1,
        groupSize,
        msg: messages[cursor]!,
      })
    }
    index = end
  }

  return result
}

function buildToolSignature(message: AiMessage): string {
  const toolCalls = message.toolCalls ?? []
  const toolResults = message.toolResults ?? []
  if (toolCalls.length === 0 && toolResults.length === 0) return ''

  return [
    toolCalls.map(tool => `${tool.id}:${tool.name}:${tool.status}:${tool.arguments.length}:${tool.result?.length ?? 0}:${tool.error?.length ?? 0}`).join(','),
    toolResults.map(result => `${result.toolCallId}:${result.success ? 1 : 0}:${result.content.length}`).join(','),
  ].join('|')
}

function buildDividerMetaSignature(message: AiMessage): string {
  if (!message.dividerMeta) return ''
  return [
    message.dividerMeta.kind,
    message.dividerMeta.loadedRecords,
    message.dividerMeta.totalRecords,
    message.dividerMeta.remainingRecords,
  ].join(':')
}

function buildCompactMetadataSignature(message: AiMessage): string {
  if (!message.compactMetadata) return ''
  return [
    message.compactMetadata.trigger,
    message.compactMetadata.preTokens,
    message.compactMetadata.summarizedMessages,
    message.compactMetadata.createdAt,
    message.compactMetadata.summaryMessageId,
    message.compactMetadata.source,
  ].join(':')
}

function buildRewindMetadataSignature(message: AiMessage): string {
  if (!message.rewindMetadata) return ''
  return [
    message.rewindMetadata.targetMessageId,
    message.rewindMetadata.targetMessageRole,
    message.rewindMetadata.hiddenMessages,
    message.rewindMetadata.createdAt,
  ].join(':')
}

function buildMessageSignature(message: AiMessage): string {
  return [
    message.id,
    message.role,
    message.type ?? '',
    buildTextSignature(message.content),
    buildTextSignature(message.thinking),
    message.isStreaming ? 1 : 0,
    message.saveStatus ?? '',
    message.notice ? `${message.notice.kind}:${message.notice.text}` : '',
    message.dividerText ?? '',
    buildDividerMetaSignature(message),
    buildCompactMetadataSignature(message),
    buildRewindMetadataSignature(message),
    message.tokens ?? 0,
    message.promptTokens ?? 0,
    message.completionTokens ?? 0,
    message.cacheReadTokens ?? 0,
    buildToolSignature(message),
  ].join('\u001f')
}

function buildItemSignature(group: MessageGroupProjection, index: number, latestUserMessageId: string | null): string {
  const stickyCompact = group.msg.id === latestUserMessageId
  return [
    index,
    group.isGroupStart ? 1 : 0,
    group.isGroupEnd ? 1 : 0,
    group.groupSize,
    stickyCompact ? 1 : 0,
    buildMessageSignature(group.msg),
  ].join('\u001e')
}

function createItem(group: MessageGroupProjection, index: number, latestUserMessageId: string | null): AiMessageListItem {
  return {
    key: `${group.msg.id}-${index}${group.msg.isStreaming ? '-s' : ''}`,
    message: group.msg,
    hideHeader: !group.isGroupStart,
    isGroupEnd: group.isGroupEnd,
    inGroup: group.groupSize > 1,
    stickyCompact: group.msg.id === latestUserMessageId,
  }
}

export function createAiMessageProjectionCache(maxSize = DEFAULT_MAX_CACHE_SIZE): AiMessageProjectionCache {
  const cache = new Map<string, CachedProjectionItem>()

  function trimCache(activeKeys: Set<string>): void {
    for (const key of cache.keys()) {
      if (!activeKeys.has(key)) cache.delete(key)
    }
    if (cache.size <= maxSize) return
    const overflow = cache.size - maxSize
    let removed = 0
    for (const key of cache.keys()) {
      cache.delete(key)
      removed += 1
      if (removed >= overflow) break
    }
  }

  return {
    project(messages: AiMessage[], latestUserMessageId: string | null): AiMessageListItem[] {
      const groups = buildGroups(messages)
      const activeKeys = new Set<string>()
      const items = groups.map((group, index) => {
        const key = `${group.msg.id}-${index}${group.msg.isStreaming ? '-s' : ''}`
        const signature = buildItemSignature(group, index, latestUserMessageId)
        activeKeys.add(key)

        const cached = cache.get(key)
        if (cached?.signature === signature) return cached.item

        const item = createItem(group, index, latestUserMessageId)
        cache.set(key, { signature, item })
        return item
      })
      trimCache(activeKeys)
      return items
    },
    clear(): void {
      cache.clear()
    },
    size(): number {
      return cache.size
    },
  }
}
