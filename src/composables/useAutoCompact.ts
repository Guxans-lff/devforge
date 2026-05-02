/**
 * 自动压缩 composable
 *
 * 检测对话 token 是否接近上下文上限（90%），
 * 触发两级压缩：轻量裁剪 → AI 摘要。
 * 含熔断器（连续 3 次失败停止）。
 */

import { ref } from 'vue'
import { useAiMemoryStore } from '@/stores/ai-memory'
import { useAiChatStore } from '@/stores/ai-chat'
import { aiSaveCompaction } from '@/api/ai-memory'
import { aiSaveMessage } from '@/api/ai'
import { executeGatewayRequest } from '@/ai-gateway/AiGateway'
import { collectFallbackApiKeys } from '@/ai-gateway/fallbackKeys'
import { buildFallbackChain } from '@/ai-gateway/router'
import { createLogger } from '@/utils/logger'
import { COMPACT_BOUNDARY_CONTENT_TYPE, serializeCompactBoundaryPayload } from './ai/chatCompactBoundaryRecord'
import type { AiMessage, AiMemory, AiMessageRecord, AiStreamEvent, ProviderConfig, ModelConfig, CompactRule, AiCompaction } from '@/types/ai'

const log = createLogger('ai.compact')

/** 压缩阈值：maxContext 的 90% */
const COMPACT_THRESHOLD = 0.9
/** Level 1 适用条件：被裁剪 token < 20% */
const LEVEL1_MAX_RATIO = 0.2
/** 保留最近 N 轮对话（user+assistant = 1 轮） */
const KEEP_RECENT_ROUNDS = 10
/** 熔断器上限 */
const MAX_FAILURES = 3

function genId(): string {
  return `compact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function makeCompactBoundaryMessage(params: {
  id: string
  summaryMessageId: string
  trigger: 'manual' | 'auto' | 'recovery'
  compressedTokens: number
  summarizedMessages: number
  source: 'ai' | 'local'
  createdAt: number
}): AiMessage {
  return {
    id: params.id,
    role: 'system',
    type: 'compact-boundary',
    content: '',
    timestamp: params.createdAt,
    tokens: 0,
    compactMetadata: {
      trigger: params.trigger,
      preTokens: params.compressedTokens,
      summarizedMessages: params.summarizedMessages,
      createdAt: params.createdAt,
      summaryMessageId: params.summaryMessageId,
      source: params.source,
    },
  }
}

function persistCompactBoundary(sessionId: string, boundary: AiMessage, logContext: Record<string, unknown>): void {
  const record: AiMessageRecord = {
    id: boundary.id,
    sessionId,
    role: 'system',
    content: serializeCompactBoundaryPayload(boundary),
    contentType: COMPACT_BOUNDARY_CONTENT_TYPE,
    tokens: boundary.compactMetadata?.preTokens ?? 0,
    cost: 0,
    createdAt: boundary.timestamp,
  }
  aiSaveMessage(record).catch(error => log.warn('save_compact_boundary_failed', logContext, error))
}

function persistCompactSummary(sessionId: string, summary: AiMessage, logContext: Record<string, unknown>): void {
  const record: AiMessageRecord = {
    id: summary.id,
    sessionId,
    role: 'system',
    content: summary.content,
    contentType: 'text',
    tokens: summary.tokens ?? 0,
    cost: 0,
    createdAt: summary.timestamp,
  }
  aiSaveMessage(record).catch(error => log.warn('save_compact_summary_failed', logContext, error))
}

export function findLastCompactBoundaryIndex(messages: AiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.type === 'compact-boundary') return index
  }
  return -1
}

export function getMessagesAfterCompactBoundary(messages: AiMessage[]): AiMessage[] {
  const boundaryIndex = findLastCompactBoundaryIndex(messages)
  return boundaryIndex === -1 ? messages : messages.slice(boundaryIndex)
}

/**
 * 构建压缩 prompt
 */
function buildCompactPrompt(messages: AiMessage[], rule: CompactRule): string {
  const conversation = messages
    .filter(m => m.role !== 'error' && m.type !== 'compact-boundary')
    .map(m => `[${m.role}]: ${m.content.slice(0, 2000)}`)
    .join('\n\n')

  return `你是一个对话压缩助手。请将以下对话历史压缩为结构化摘要。

## 压缩规则

**P0-必须保留:** ${rule.p0}
**P1-尽量保留:** ${rule.p1}
**P2-立即丢弃:** ${rule.p2}
**压缩比目标:** 压缩到原文的 ${Math.round(rule.ratio * 100)}%

## 对话历史

${conversation}

## 输出要求

直接输出压缩摘要，不要解释你的压缩过程。摘要应包含所有 P0 内容和尽量多的 P1 内容。以"以下是本次对话早期内容的摘要："开头。`
}

export function useAutoCompact() {
  const isCompacting = ref(false)
  const consecutiveFailures = ref(0)
  const memoryStore = useAiMemoryStore()
  const aiStore = useAiChatStore()

  /**
   * 检测并执行自动压缩
   *
   * @param messages 当前消息列表
   * @param totalTokens 当前总 token 数
   * @param maxContext 模型最大上下文
   * @param sessionId 当前会话 ID
   * @param provider Provider 配置
   * @param model 模型配置
   * @param apiKey API Key
   * @returns 压缩后的消息列表（如果执行了压缩），或 null（未触发/失败）
   */
  async function checkAndCompact(
    messages: AiMessage[],
    totalTokens: number,
    maxContext: number,
    sessionId: string,
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
  ): Promise<AiMessage[] | null> {
    // 熔断器检查
    if (consecutiveFailures.value >= MAX_FAILURES) return null

    // 阈值检查
    if (totalTokens < maxContext * COMPACT_THRESHOLD) return null

    // 消息太少不压缩
    const nonErrorMsgs = messages.filter(m => m.role !== 'error')
    if (nonErrorMsgs.length <= KEEP_RECENT_ROUNDS * 2) return null

    isCompacting.value = true

    try {
      // ── Level 1: 轻量裁剪 ──
      const keepCount = KEEP_RECENT_ROUNDS * 2
      const toRemove = nonErrorMsgs.slice(0, nonErrorMsgs.length - keepCount)
      const removedTokens = toRemove.reduce((sum, m) => sum + (m.tokens ?? 0), 0)

      if (removedTokens < maxContext * LEVEL1_MAX_RATIO) {
        // Level 1 够用：直接裁剪
        const keepStartAt = messages[messages.length - keepCount]?.timestamp ?? Date.now()
        const boundaryCreatedAt = Math.max(0, keepStartAt - 2)
        const summaryCreatedAt = Math.max(0, keepStartAt - 1)
        const summaryMessageId = `compact-local-summary-${boundaryCreatedAt}`
        const boundary = makeCompactBoundaryMessage({
          id: `compact-boundary-${boundaryCreatedAt}`,
          summaryMessageId,
          trigger: 'auto',
          compressedTokens: removedTokens,
          summarizedMessages: toRemove.length,
          source: 'local',
          createdAt: boundaryCreatedAt,
        })
        const summaryMsg: AiMessage = {
          id: summaryMessageId,
          role: 'system',
          content: `【本地轻量压缩】已移除 ${toRemove.length} 条较早消息，释放约 ${removedTokens.toLocaleString()} tokens。`,
          timestamp: summaryCreatedAt,
        }
        const kept = messages.slice(messages.length - keepCount)
        const compacted = [boundary, summaryMsg, ...kept]
        const newTotal = compacted.reduce((sum, m) => sum + (m.tokens ?? 0), 0)

        // 裁剪后仍超阈值？升级 Level 2
        if (newTotal >= maxContext * COMPACT_THRESHOLD) {
          return await level2Compact(messages, sessionId, provider, model, apiKey)
        }

        persistCompactBoundary(sessionId, boundary, { sessionId, trigger: 'auto', source: 'local' })
        persistCompactSummary(sessionId, summaryMsg, { sessionId, trigger: 'auto', source: 'local' })
        consecutiveFailures.value = 0
        return compacted
      }

      // ── Level 2: AI 摘要压缩 ──
      return await level2Compact(messages, sessionId, provider, model, apiKey)
    } catch (e) {
      consecutiveFailures.value++
      log.error('compact_failed', { sessionId }, e)
      return null
    } finally {
      isCompacting.value = false
    }
  }

  /**
   * Level 2 压缩：调用 AI 生成摘要
   */
  async function level2Compact(
    messages: AiMessage[],
    sessionId: string,
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
    trigger: 'manual' | 'auto' | 'recovery' = 'auto',
  ): Promise<AiMessage[] | null> {
    const nonErrorMsgs = messages.filter(m => m.role !== 'error')
    const keepCount = KEEP_RECENT_ROUNDS * 2
    const toCompress = nonErrorMsgs.slice(0, nonErrorMsgs.length - keepCount)
    const toKeep = messages.slice(messages.length - keepCount)

    if (toCompress.length === 0) return null

    const rule = memoryStore.compactRule
    const prompt = buildCompactPrompt(toCompress, rule)

    // 调用 AI 生成摘要（非流式收集完整结果）
    let summary = ''
    const fallbackChain = buildFallbackChain(aiStore.providers, provider, model)
    const apiKeysByProvider = await collectFallbackApiKeys(provider.id, fallbackChain)

    await executeGatewayRequest(
      {
        sessionId: `compact-${sessionId}`,
        messages: [{ role: 'user', content: prompt }],
        provider,
        model,
        apiKey,
        apiKeysByProvider,
        fallbackChain,
        maxTokens: Math.min(model.capabilities.maxOutput, 4096),
        systemPrompt: '你是一个专业的对话压缩助手，严格按照规则压缩对话内容。',
        enableTools: false,
        source: 'compact',
        kind: 'compact',
      },
      (event: AiStreamEvent) => {
        if (event.type === 'TextDelta') summary += event.delta
      },
    )

    if (!summary.trim()) {
      throw new Error('AI 返回空摘要')
    }

    // 保存压缩记录
    const compressedTokens = toCompress.reduce((sum, m) => sum + (m.tokens ?? 0), 0)
    const compaction: AiCompaction = {
      id: genId(),
      sessionId,
      summary,
      originalCount: toCompress.length,
      originalTokens: compressedTokens,
      createdAt: Date.now(),
    }
    aiSaveCompaction(compaction).catch(e => log.warn('save_compaction_failed', { sessionId }, e))

    // 从摘要中提取关键知识点存入记忆库
    const knowledgeMemory: AiMemory = {
      id: `mem-summary-${Date.now()}`,
      workspaceId: memoryStore.currentWorkspaceId,
      type: 'summary',
      title: `对话摘要 (${new Date().toLocaleDateString()})`,
      content: summary.slice(0, 2000),
      tags: '自动摘要,压缩',
      sourceSessionId: sessionId,
      weight: 0.8,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    memoryStore.saveMemory(knowledgeMemory).catch(e => log.warn('save_summary_memory_failed', { sessionId }, e))

    const keepStartAt = toKeep[0]?.timestamp ?? Date.now()
    const createdAt = Math.max(0, keepStartAt - 2)
    const summaryCreatedAt = Math.max(0, keepStartAt - 1)
    const summaryMessageId = genId()
    const boundaryMsg = makeCompactBoundaryMessage({
      id: `compact-boundary-${createdAt}`,
      summaryMessageId,
      trigger,
      compressedTokens,
      summarizedMessages: toCompress.length,
      source: 'ai',
      createdAt,
    })

    // 构建摘要消息
    const summaryMsg: AiMessage = {
      id: summaryMessageId,
      role: 'system',
      content: summary,
      timestamp: summaryCreatedAt,
    }

    // 插入压缩分割线，显示释放了多少 tokens
    const dividerMsg: AiMessage = {
      id: `compact-divider-${createdAt}`,
      role: 'system',
      type: 'divider',
      dividerText: `Compacted chat · auto · ${compressedTokens.toLocaleString()} tokens freed`,
      content: '',
      timestamp: summaryCreatedAt,
    }

    persistCompactBoundary(sessionId, boundaryMsg, { sessionId, trigger, source: 'ai' })
    persistCompactSummary(sessionId, summaryMsg, { sessionId, trigger, source: 'ai' })
    consecutiveFailures.value = 0
    log.info('compact_done', {
      sessionId,
      originalCount: toCompress.length,
      originalTokens: compressedTokens,
      summaryChars: summary.length,
    })
    return [boundaryMsg, summaryMsg, dividerMsg, ...toKeep]
  }

  /** 重置熔断器（新对话时调用） */
  function resetCircuitBreaker(): void {
    consecutiveFailures.value = 0
  }

  /**
   * 强制压缩（跳过阈值判断）— 用于 context_length_exceeded 紧急恢复
   * 直接走 Level 2 AI 摘要路径
   */
  async function forceCompact(
    messages: AiMessage[],
    sessionId: string,
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
    trigger: 'manual' | 'auto' | 'recovery' = 'recovery',
  ): Promise<AiMessage[] | null> {
    if (consecutiveFailures.value >= MAX_FAILURES) return null
    const nonErrorMsgs = messages.filter(m => m.role !== 'error')
    if (nonErrorMsgs.length <= KEEP_RECENT_ROUNDS * 2) return null
    isCompacting.value = true
    try {
      return await level2Compact(messages, sessionId, provider, model, apiKey, trigger)
    } catch (e) {
      consecutiveFailures.value++
      log.error('force_compact_failed', { sessionId }, e)
      return null
    } finally {
      isCompacting.value = false
    }
  }

  return {
    isCompacting,
    consecutiveFailures,
    checkAndCompact,
    forceCompact,
    resetCircuitBreaker,
  }
}
