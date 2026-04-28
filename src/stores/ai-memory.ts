/**
 * AI 记忆 Pinia Store
 *
 * 管理记忆列表 CRUD、workspace hash 计算、关键词召回。
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { aiListMemories, aiSaveMemory, aiDeleteMemory, aiSearchMemories } from '@/api/ai-memory'
import type { AiMemory, MemoryReviewStatus, MemorySourceType, MemoryType, CompactRule } from '@/types/ai'

/** 默认压缩规则 */
const DEFAULT_COMPACT_RULE: CompactRule = {
  p0: '进行中任务 + todo 列表 + 阻塞点 + 用户决策 + 当前分支 + 未提交变更',
  p1: '修改过的文件路径清单（仅路径）、关键架构决策（一句话）、用户明确指示',
  p2: '所有工具调用的原始输出、文件完整内容、搜索结果、堆栈跟踪、已完成步骤详情、闲聊、重复信息',
  ratio: 0.2,
}

/** 中文停用词（召回时过滤） */
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '他', '她', '它', '们', '那', '些', '什么', '怎么', '如何', '可以',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with',
  'at', 'by', 'from', 'this', 'that', 'it', 'and', 'or', 'not', 'no',
])

/**
 * 计算 workspace hash（SHA-256 前 16 位 hex）
 *
 * 使用 Web Crypto API，异步计算。
 */
async function computeWorkspaceId(rootPath: string): Promise<string> {
  const normalized = rootPath.replace(/\\/g, '/').toLowerCase()
  const data = new TextEncoder().encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 从文本中提取关键词
 *
 * 按空格/标点拆分，去停用词，去重，限制数量。
 */
function extractKeywords(text: string, maxCount = 10): string[] {
  const words = text
    .toLowerCase()
    .split(/[\s,，。！？；：、""''（）【】《》\-+*/=<>{}[\]()#@!?.;:'"]+/)
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w))

  return [...new Set(words)].slice(0, maxCount)
}

/**
 * 时间衰减因子
 *
 * decay = 1 / (1 + daysSinceLastUsed × 0.05)
 */
function decayFactor(lastUsedAt: number | undefined): number {
  if (!lastUsedAt) return 0.5 // 从未使用过给 0.5 基础分
  const days = (Date.now() - lastUsedAt) / (1000 * 60 * 60 * 24)
  return 1 / (1 + days * 0.05)
}

export interface MemoryProposal {
  id: string
  type: MemoryType
  title: string
  content: string
  tags: string
  sourceSessionId?: string
  sourceType?: MemorySourceType
  sourceRef?: string
  confidence?: number
  proposedAt: number
}

function clamp01(value: number | undefined, fallback = 0.8): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

function normalizeReviewStatus(status: MemoryReviewStatus | undefined): MemoryReviewStatus {
  return status ?? 'approved'
}

function normalizeMemory(memory: AiMemory): AiMemory {
  return {
    ...memory,
    tags: memory.tags ?? '',
    sourceType: memory.sourceType ?? (memory.sourceSessionId ? 'chat' : 'manual'),
    confidence: clamp01(memory.confidence, 0.8),
    reviewStatus: normalizeReviewStatus(memory.reviewStatus),
    usageCount: Math.max(0, Math.trunc(memory.usageCount ?? 0)),
  }
}

export const useAiMemoryStore = defineStore('ai-memory', () => {
  const memories = ref<AiMemory[]>([])
  const currentWorkspaceId = ref<string>('_global')
  const isLoading = ref(false)
  const pendingProposals = ref<MemoryProposal[]>([])

  /** 按类型分组 */
  const memoriesByType = computed(() => {
    const groups: Record<MemoryType, AiMemory[]> = {
      knowledge: [],
      summary: [],
      preference: [],
      project_rule: [],
      architecture_decision: [],
      bug_lesson: [],
      user_preference: [],
      domain_knowledge: [],
    }
    for (const m of memories.value) {
      const type = m.type as MemoryType
      if (groups[type]) groups[type].push(m)
    }
    return groups
  })

  /** 获取当前压缩规则（从 preference 类型记忆中读取） */
  const compactRule = computed<CompactRule>(() => {
    const pref = memories.value.find(
      m => m.type === 'preference' && m.title === '压缩规则',
    )
    if (pref) {
      try {
        return JSON.parse(pref.content) as CompactRule
      } catch { /* 解析失败用默认 */ }
    }
    return DEFAULT_COMPACT_RULE
  })

  /** 设置当前工作区并加载记忆 */
  async function setWorkspace(rootPath: string | null): Promise<void> {
    if (!rootPath) {
      currentWorkspaceId.value = '_global'
    } else {
      currentWorkspaceId.value = await computeWorkspaceId(rootPath)
    }
    await loadMemories()
  }

  /** 加载当前工作区的记忆 */
  async function loadMemories(): Promise<void> {
    isLoading.value = true
    try {
      memories.value = (await aiListMemories(currentWorkspaceId.value)).map(normalizeMemory)
    } catch (e) {
      console.error('[AI Memory] 加载记忆失败:', e)
    } finally {
      isLoading.value = false
    }
  }

  /** 保存记忆 */
  async function saveMemory(memory: AiMemory): Promise<void> {
    const normalized = normalizeMemory(memory)
    await aiSaveMemory(normalized)
    // 乐观更新
    const idx = memories.value.findIndex(m => m.id === normalized.id)
    if (idx >= 0) {
      memories.value = memories.value.map((m, i) => i === idx ? normalized : m)
    } else {
      memories.value = [normalized, ...memories.value]
    }
  }

  /** 删除记忆 */
  async function deleteMemory(id: string): Promise<void> {
    await aiDeleteMemory(id)
    memories.value = memories.value.filter(m => m.id !== id)
  }

  /** 保存压缩规则 */
  async function saveCompactRule(rule: CompactRule): Promise<void> {
    const existing = memories.value.find(
      m => m.type === 'preference' && m.title === '压缩规则',
    )
    const now = Date.now()
    const memory: AiMemory = {
      id: existing?.id ?? `pref-compact-rule-${now}`,
      workspaceId: currentWorkspaceId.value,
      type: 'preference',
      title: '压缩规则',
      content: JSON.stringify(rule),
      tags: '压缩,规则,compact',
      weight: 1.0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await saveMemory(memory)
  }

  /**
   * 智能召回：按用户输入检索相关记忆
   *
   * @param userInput 用户输入文本
   * @param maxTokenBudget 召回 token 预算
   * @returns 格式化后的记忆注入文本
   */
  async function recall(userInput: string, maxTokenBudget: number): Promise<string> {
    const keywords = extractKeywords(userInput)
    if (keywords.length === 0) return ''

    try {
      const results = (await aiSearchMemories(currentWorkspaceId.value, keywords))
        .map(normalizeMemory)
        .filter(memory => memory.reviewStatus !== 'rejected' && memory.reviewStatus !== 'archived')
      if (results.length === 0) return ''

      // 计算综合得分并排序
      const scored = results.map(m => {
        const tagWords = m.tags.split(',').map(t => t.trim().toLowerCase())
        // tags 精确匹配得 2 分，title/content 模糊匹配得 1 分
        let matchScore = 0
        for (const kw of keywords) {
          if (tagWords.includes(kw)) matchScore += 2
          else if (m.title.toLowerCase().includes(kw) || m.content.toLowerCase().includes(kw)) matchScore += 1
        }
        const decay = decayFactor(m.lastUsedAt)
        return { memory: m, score: m.weight * clamp01(m.confidence, 0.8) * matchScore * decay }
      })
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)

      if (scored.length === 0) return ''

      // 格式化输出，控制 token 预算（粗略：4 字符 ≈ 1 token）
      const typeLabel: Record<string, string> = {
        knowledge: '知识',
        summary: '摘要',
        preference: '偏好',
      }
      let output = '【项目记忆】\n'
      let tokenCount = 10 // 标题开销

      for (const { memory: m } of scored) {
        const line = `- [${typeLabel[m.type] ?? m.type}] ${m.title}: ${m.content}\n`
        const lineTokens = Math.ceil(line.length / 4)
        if (tokenCount + lineTokens > maxTokenBudget) break
        output += line
        tokenCount += lineTokens

        // 更新 last_used_at（fire and forget）
        aiSaveMemory(normalizeMemory({
          ...m,
          lastUsedAt: Date.now(),
          usageCount: (m.usageCount ?? 0) + 1,
        })).catch(() => {})
      }

      return output
    } catch (e) {
      console.warn('[AI Memory] 召回失败:', e)
      return ''
    }
  }

  function proposeMemory(proposal: Omit<MemoryProposal, 'id' | 'proposedAt'>): void {
    const pending: MemoryProposal = {
      ...proposal,
      id: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      proposedAt: Date.now(),
    }
    pendingProposals.value = [pending, ...pendingProposals.value]
  }

  async function approveProposal(proposalId: string): Promise<void> {
    const proposal = pendingProposals.value.find(item => item.id === proposalId)
    if (!proposal) return
    const now = Date.now()
    await saveMemory({
      id: `mem-${now}`,
      workspaceId: currentWorkspaceId.value,
      type: proposal.type,
      title: proposal.title,
      content: proposal.content,
      tags: proposal.tags,
      sourceSessionId: proposal.sourceSessionId,
      sourceType: proposal.sourceType ?? (proposal.sourceSessionId ? 'chat' : 'manual'),
      sourceRef: proposal.sourceRef ?? proposal.sourceSessionId,
      confidence: clamp01(proposal.confidence, 0.8),
      reviewStatus: 'approved',
      usageCount: 0,
      weight: 1,
      createdAt: now,
      updatedAt: now,
    })
    pendingProposals.value = pendingProposals.value.filter(item => item.id !== proposalId)
  }

  function rejectProposal(proposalId: string): void {
    pendingProposals.value = pendingProposals.value.filter(item => item.id !== proposalId)
  }

  function clearProposals(): void {
    pendingProposals.value = []
  }

  return {
    memories,
    memoriesByType,
    currentWorkspaceId,
    isLoading,
    compactRule,
    pendingProposals,
    setWorkspace,
    loadMemories,
    saveMemory,
    deleteMemory,
    saveCompactRule,
    recall,
    proposeMemory,
    approveProposal,
    rejectProposal,
    clearProposals,
  }
})

export { DEFAULT_COMPACT_RULE, extractKeywords, computeWorkspaceId }
