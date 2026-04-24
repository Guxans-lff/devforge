import { aiReadContextFile, aiSaveMessage, type ChatMessage } from '@/api/ai'
import type { useAiChatStore } from '@/stores/ai-chat'
import type { useAiMemoryStore } from '@/stores/ai-memory'
import type { AiMessage, AiMessageRecord, FileAttachment, ModelConfig, ProviderConfig } from '@/types/ai'
import type { Logger } from '@/utils/logger'
import { buildFileMarkedContent } from '@/utils/file-markers'
import { buildChatMessagesWithOptions } from './chatMessageBuilder'
import { genId } from './chatHelpers'
import { saveNewSessionShellIfMissing } from './chatSessionPersistence'

type AiChatStore = ReturnType<typeof useAiChatStore>
type AiMemoryStore = ReturnType<typeof useAiMemoryStore>

const CONTEXT_FILE_MAX_LINES = 400
const CONTEXT_FILE_MAX_CHARS = 12_000
const CONTEXT_FILES_TOTAL_MAX_CHARS = 24_000

function truncateContextContent(content: string): { content: string; truncated: boolean } {
  const lines = content.split('\n')
  let truncatedByLines = false
  let nextContent = content

  if (lines.length > CONTEXT_FILE_MAX_LINES) {
    nextContent = lines.slice(0, CONTEXT_FILE_MAX_LINES).join('\n')
    truncatedByLines = true
  }

  if (nextContent.length > CONTEXT_FILE_MAX_CHARS) {
    return {
      content: `${nextContent.slice(0, CONTEXT_FILE_MAX_CHARS)}\n...[truncated]`,
      truncated: true,
    }
  }

  return {
    content: nextContent,
    truncated: truncatedByLines,
  }
}

export interface PrepareSendResult {
  chatMessages: ChatMessage[]
  enableTools: boolean
  enrichedSystemPrompt?: string
  hasVisionCapability: boolean
}

export interface PrepareSendContextParams {
  content: string
  provider: ProviderConfig
  model: ModelConfig
  systemPrompt: string | undefined
  attachments: FileAttachment[] | undefined
  sessionId: string
  messages: { value: AiMessage[] }
  workDir: string
  planGateEnabled: boolean
  planApproved: boolean
  aiStore: AiChatStore
  memoryStore: AiMemoryStore
  log: Logger
}

interface ContextFileReadResult {
  entry: NonNullable<AiChatStore['currentWorkspaceConfig']>['contextFiles'][number]
  fileContent: string
}

async function readContextFiles(
  contextFiles: NonNullable<AiChatStore['currentWorkspaceConfig']>['contextFiles'],
  workDir: string,
  log: Logger,
): Promise<Array<ContextFileReadResult | null>> {
  return await Promise.all(contextFiles.map(async (entry) => {
    try {
      const fileContent = await aiReadContextFile(workDir, entry.path, CONTEXT_FILE_MAX_LINES)
      return { entry, fileContent }
    } catch (error) {
      log.warn('context_file_read_failed', { path: entry.path }, error)
      return null
    }
  }))
}

export async function prepareSendContext(params: PrepareSendContextParams): Promise<PrepareSendResult> {
  const {
    content,
    provider,
    model,
    systemPrompt,
    attachments,
    sessionId,
    messages,
    workDir,
    planGateEnabled,
    planApproved,
    aiStore,
    memoryStore,
    log,
  } = params

  const readyFiles = (attachments ?? []).filter(file => file.status === 'ready' && file.content)
  const finalContent = readyFiles.length > 0
    ? buildFileMarkedContent(
        content.trim(),
        readyFiles.map(file => ({
          name: file.name,
          path: file.path,
          size: file.size,
          content: file.content!,
          lines: file.lines ?? 0,
          type: file.type,
        })),
      )
    : content.trim()
  const contentType = readyFiles.length > 0 ? 'text_with_files' : 'text'
  const enableTools = model.capabilities.toolUse && !!workDir

  const userMessage: AiMessage = {
    id: genId(),
    role: 'user',
    content: finalContent,
    timestamp: Date.now(),
  }
  messages.value = [...messages.value, userMessage]

  const userRecord: AiMessageRecord = {
    id: userMessage.id,
    sessionId,
    role: 'user',
    content: finalContent,
    contentType,
    tokens: 0,
    cost: 0,
    createdAt: userMessage.timestamp,
  }
  aiSaveMessage(userRecord).catch(error => log.warn('save_user_msg_failed', { sessionId }, error))

  saveNewSessionShellIfMissing({
    store: aiStore,
    sessionId,
    titleSource: content,
    provider,
    model,
    log,
  })

  let enrichedSystemPrompt = systemPrompt
  const tokenBudget = Math.floor(model.capabilities.maxContext * 0.05)
  const recallPromise = memoryStore.currentWorkspaceId !== '_global'
    ? memoryStore.recall(content, tokenBudget).catch((error) => {
      log.warn('memory_recall_failed', { sessionId }, error)
      return ''
    })
    : Promise.resolve('')

  const workspaceConfig = aiStore.currentWorkspaceConfig
  const contextFileReadsPromise = workspaceConfig && workDir && workspaceConfig.contextFiles && workspaceConfig.contextFiles.length > 0
    ? readContextFiles(workspaceConfig.contextFiles, workDir, log)
    : Promise.resolve([])

  const recalled = await recallPromise
  if (recalled) {
    enrichedSystemPrompt = `${systemPrompt ?? ''}\n\n${recalled}`
  }

  if (workspaceConfig && workDir) {
    if (workspaceConfig.systemPromptExtra) {
      enrichedSystemPrompt = `${enrichedSystemPrompt ?? ''}\n\n${workspaceConfig.systemPromptExtra}`
    }

    if (workspaceConfig.contextFiles && workspaceConfig.contextFiles.length > 0) {
      const contextFileReads = await contextFileReadsPromise
      const contextParts: string[] = []
      let totalContextChars = 0
      for (const fileResult of contextFileReads) {
        if (totalContextChars >= CONTEXT_FILES_TOTAL_MAX_CHARS) break
        if (!fileResult) continue

        const { entry, fileContent } = fileResult
        const { content: truncatedContent, truncated } = truncateContextContent(fileContent)
        const remainingBudget = CONTEXT_FILES_TOTAL_MAX_CHARS - totalContextChars
        if (remainingBudget <= 0) break

        const boundedContent = truncatedContent.length > remainingBudget
          ? `${truncatedContent.slice(0, Math.max(remainingBudget - 16, 0))}\n...[truncated]`
          : truncatedContent
        const header = entry.reason ? `# ${entry.path} (${entry.reason})` : `# ${entry.path}`
        const suffix = truncated || boundedContent.length < fileContent.length
          ? '\n[context-file truncated due to budget]'
          : ''
        const section = `${header}\n\`\`\`\n${boundedContent}\n\`\`\`${suffix}`
        totalContextChars += boundedContent.length
        contextParts.push(section)
      }

      if (contextParts.length > 0) {
        enrichedSystemPrompt = `${enrichedSystemPrompt ?? ''}\n\n<context-files>\n${contextParts.join('\n\n')}\n</context-files>`
      }
    }
  }

  if (planGateEnabled && !planApproved) {
    enrichedSystemPrompt = `${enrichedSystemPrompt ?? ''}\n\n[PLAN GATE ACTIVE] 你必须先输出清晰的执行计划（步骤列表），不能调用任何工具，等待用户确认后才开始执行。计划中每个步骤请以 "- " 开头。`
  }

  const hasVisionCapability = model.capabilities.vision
  return {
    chatMessages: buildChatMessagesWithOptions(messages.value, {
      hasVision: hasVisionCapability,
      replayToolContext: enableTools,
    }),
    enableTools,
    enrichedSystemPrompt,
    hasVisionCapability,
  }
}
