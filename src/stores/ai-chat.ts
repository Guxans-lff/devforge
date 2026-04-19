/**
 * AI 对话状态管理
 *
 * 管理 Provider 列表、会话列表、当前活跃会话等全局状态。
 * 对话消息的流式处理由 useAiChat composable 负责。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ProviderConfig, AiSession, WorkspaceConfig } from '@/types/ai'
import {
  aiListProviders,
  aiSaveProvider,
  aiDeleteProvider,
  aiListSessions,
  aiSaveSession,
  aiDeleteSession,
  aiGetUsageStats,
  aiReadWorkspaceConfig,
  aiWriteWorkspaceConfig,
} from '@/api/ai'
import type { DailyUsage } from '@/types/ai'

export const useAiChatStore = defineStore('ai-chat', () => {
  // ─────────────────────── Provider 状态 ───────────────────────

  const providers = ref<ProviderConfig[]>([])
  const providersLoaded = ref(false)

  /** 默认 Provider（is_default = true 的第一个，否则列表第一个） */
  const defaultProvider = computed(() =>
    providers.value.find(p => p.isDefault) ?? providers.value[0] ?? null,
  )

  /** 加载 Provider 列表 */
  async function loadProviders(): Promise<void> {
    providers.value = await aiListProviders()
    providersLoaded.value = true
  }

  /** 保存 Provider（新增或更新） */
  async function saveProvider(config: ProviderConfig): Promise<void> {
    await aiSaveProvider(config)
    await loadProviders()
  }

  /** 删除 Provider */
  async function removeProvider(id: string): Promise<void> {
    await aiDeleteProvider(id)
    providers.value = providers.value.filter(p => p.id !== id)
  }

  // ─────────────────────── 会话状态 ───────────────────────

  const sessions = ref<AiSession[]>([])
  const activeSessionId = ref<string | null>(null)
  const sessionsLoaded = ref(false)

  /** 当前活跃会话 */
  const activeSession = computed(() =>
    sessions.value.find(s => s.id === activeSessionId.value) ?? null,
  )

  /** 加载会话列表 */
  async function loadSessions(): Promise<void> {
    sessions.value = await aiListSessions()
    sessionsLoaded.value = true
  }

  /** 保存会话（新增或更新） */
  async function saveSession(session: AiSession): Promise<void> {
    await aiSaveSession(session)
    // 更新本地列表
    const idx = sessions.value.findIndex(s => s.id === session.id)
    if (idx >= 0) {
      sessions.value = sessions.value.map((s, i) => i === idx ? session : s)
    } else {
      sessions.value = [session, ...sessions.value]
    }
  }

  /** 删除会话 */
  async function removeSession(id: string): Promise<void> {
    await aiDeleteSession(id)
    sessions.value = sessions.value.filter(s => s.id !== id)
    if (activeSessionId.value === id) {
      activeSessionId.value = sessions.value[0]?.id ?? null
    }
  }

  /** 切换活跃会话 */
  function setActiveSession(id: string | null): void {
    activeSessionId.value = id
  }

  // ─────────────────────── 用量统计 ───────────────────────

  const usageStats = ref<DailyUsage[]>([])

  async function loadUsageStats(startDate: string, endDate: string): Promise<void> {
    usageStats.value = await aiGetUsageStats(startDate, endDate)
  }

  // ─────────────────────── Workspace 配置 ───────────────────────

  /** 当前工作目录对应的 .devforge/config.json 内容（按 workDir 缓存） */
  const workspaceConfigs = ref<Map<string, WorkspaceConfig>>(new Map())
  const currentWorkDir = ref<string>('')

  /** 当前工作区配置 */
  const currentWorkspaceConfig = computed<WorkspaceConfig | null>(() =>
    currentWorkDir.value ? (workspaceConfigs.value.get(currentWorkDir.value) ?? null) : null,
  )

  /** 加载指定工作目录的 workspace config */
  async function loadWorkspaceConfig(workDir: string): Promise<void> {
    if (!workDir) return
    currentWorkDir.value = workDir
    try {
      const raw = await aiReadWorkspaceConfig(workDir)
      if (raw) {
        const cfg = JSON.parse(raw) as WorkspaceConfig
        workspaceConfigs.value = new Map(workspaceConfigs.value).set(workDir, cfg)
      } else {
        workspaceConfigs.value = new Map(workspaceConfigs.value).set(workDir, {})
      }
    } catch (e) {
      console.warn('[AI Store] 加载 workspace config 失败:', e)
      workspaceConfigs.value = new Map(workspaceConfigs.value).set(workDir, {})
    }
  }

  /** 保存 workspace config */
  async function saveWorkspaceConfig(workDir: string, cfg: WorkspaceConfig): Promise<void> {
    await aiWriteWorkspaceConfig(workDir, JSON.stringify(cfg, null, 2))
    workspaceConfigs.value = new Map(workspaceConfigs.value).set(workDir, cfg)
  }

  // ─────────────────────── 初始化 ───────────────────────

  /** 一次性初始化（加载 Provider + 会话列表） */
  let _initialized = false
  async function init(): Promise<void> {
    if (_initialized) return
    _initialized = true
    try {
      await Promise.all([loadProviders(), loadSessions()])
    } catch (e) {
      _initialized = false  // 失败后允许重试
      console.error('[AI Store] 初始化失败:', e)
      throw e
    }
  }

  return {
    // Provider
    providers,
    providersLoaded,
    defaultProvider,
    loadProviders,
    saveProvider,
    removeProvider,
    // 会话
    sessions,
    activeSessionId,
    activeSession,
    sessionsLoaded,
    loadSessions,
    saveSession,
    removeSession,
    setActiveSession,
    // 用量
    usageStats,
    loadUsageStats,
    // Workspace 配置
    currentWorkDir,
    currentWorkspaceConfig,
    loadWorkspaceConfig,
    saveWorkspaceConfig,
    // 初始化
    init,
  }
})
