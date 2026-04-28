/**
 * AI Feature Gate 管理
 *
 * 三层覆盖优先级：workspace > local_settings > default
 * - workspace: 从 .devforge/config.json 的 features 字段读取
 * - local_settings: 从 localStorage 读取
 * - default: 代码硬编码默认值
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { aiReadWorkspaceConfig, aiWriteWorkspaceConfig } from '@/api/ai'
import { readFeatureGates, writeFeatureGate, deleteFeatureGate } from '@/api/feature-gate'
import { createLogger } from '@/utils/logger'

const log = createLogger('ai.feature-gate')

const LOCAL_STORAGE_KEY = 'ai-feature-gates'

export interface AiFeatureGate {
  key: string
  enabled: boolean
  source: 'default' | 'local_settings' | 'workspace'
  reason?: string
}

/** 默认开关（代码级兜底） */
const DEFAULT_GATES: Record<string, boolean> = {
  'ai.compact.v2': true,
  'ai.agent.runtime': true,
  'ai.diagnostics.capture': true,
  'ai.permission.strict': false,
  'ai.proactive.enabled': false,
  'ai.tools.parallel': true,
  'ai.experimental.ui': false,
  'ai.experimental.virtual_scroll': false,
}

function readLocalGates(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return {}
}

function writeLocalGates(gates: Record<string, boolean>): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(gates))
  } catch {
    // ignore
  }
}

export const useAiFeatureGateStore = defineStore('ai-feature-gate', () => {
  const localGates = ref<Record<string, boolean>>(readLocalGates())
  const workspaceGates = ref<Record<string, boolean>>({})
  const workspaceGatesLoaded = ref(false)

  /**
   * 读取 workspace 级 Feature Gate 配置
   */
  async function loadWorkspaceGates(workDir: string): Promise<void> {
    if (!workDir) {
      workspaceGates.value = {}
      workspaceGatesLoaded.value = false
      return
    }
    try {
      const content = await aiReadWorkspaceConfig(workDir)
      if (content) {
        const config = JSON.parse(content) as { features?: Record<string, boolean> }
        workspaceGates.value = config.features ?? {}
      } else {
        workspaceGates.value = {}
      }
      workspaceGatesLoaded.value = true
    } catch (e) {
      log.warn('load_workspace_gates_failed', { workDir }, e)
      workspaceGates.value = {}
      workspaceGatesLoaded.value = false
    }
  }

  /**
   * 查询单个 Feature Gate 是否启用
   *
   * 优先级：workspace > local_settings > default
   */
  function isEnabled(key: string): boolean {
    if (workspaceGates.value[key] !== undefined) {
      return workspaceGates.value[key]!
    }
    if (localGates.value[key] !== undefined) {
      return localGates.value[key]!
    }
    return DEFAULT_GATES[key] ?? false
  }

  /**
   * 获取单个 Feature Gate 的完整信息（含来源）
   */
  function getGate(key: string): AiFeatureGate {
    if (workspaceGates.value[key] !== undefined) {
      return { key, enabled: workspaceGates.value[key]!, source: 'workspace' }
    }
    if (localGates.value[key] !== undefined) {
      return { key, enabled: localGates.value[key]!, source: 'local_settings' }
    }
    return { key, enabled: DEFAULT_GATES[key] ?? false, source: 'default' }
  }

  /**
   * 获取所有已知 Feature Gate 的状态
   */
  function allGates(): AiFeatureGate[] {
    const keys = new Set([
      ...Object.keys(DEFAULT_GATES),
      ...Object.keys(localGates.value),
      ...Object.keys(workspaceGates.value),
    ])
    return Array.from(keys).map(key => getGate(key))
  }

  /**
   * 设置本地级 Feature Gate
   */
  async function setLocal(key: string, enabled: boolean): Promise<void> {
    localGates.value = { ...localGates.value, [key]: enabled }
    writeLocalGates(localGates.value)
    try {
      await writeFeatureGate(key, enabled)
    } catch (e) {
      log.warn('feature_gate_backend_sync_failed', { key, enabled }, e)
    }
    log.info('feature_gate_local_set', { key, enabled })
  }

  /**
   * 移除本地级覆盖（回退到 default/workspace）
   */
  async function removeLocal(key: string): Promise<void> {
    const next = { ...localGates.value }
    delete next[key]
    localGates.value = next
    writeLocalGates(next)
    try {
      await deleteFeatureGate(key)
    } catch (e) {
      log.warn('feature_gate_backend_remove_failed', { key }, e)
    }
    log.info('feature_gate_local_removed', { key })
  }

  /**
   * 设置 workspace 级 Feature Gate（写入 .devforge/config.json）
   */
  async function setWorkspace(key: string, enabled: boolean, workDir: string): Promise<void> {
    if (!workDir) {
      log.warn('feature_gate_workspace_set_no_workdir', { key })
      return
    }
    try {
      const content = await aiReadWorkspaceConfig(workDir)
      const config = content ? (JSON.parse(content) as Record<string, unknown>) : {}
      const features = (config.features as Record<string, boolean> | undefined) ?? {}
      features[key] = enabled
      config.features = features
      await aiWriteWorkspaceConfig(workDir, JSON.stringify(config, null, 2))
      workspaceGates.value = { ...workspaceGates.value, [key]: enabled }
      log.info('feature_gate_workspace_set', { key, enabled, workDir })
    } catch (e) {
      log.warn('feature_gate_workspace_set_failed', { key, enabled, workDir }, e)
      throw e
    }
  }

  /**
   * 移除 workspace 级覆盖
   */
  async function removeWorkspace(key: string, workDir: string): Promise<void> {
    if (!workDir) return
    try {
      const content = await aiReadWorkspaceConfig(workDir)
      if (!content) return
      const config = JSON.parse(content) as Record<string, unknown>
      const features = (config.features as Record<string, boolean> | undefined) ?? {}
      delete features[key]
      if (Object.keys(features).length === 0) {
        delete config.features
      } else {
        config.features = features
      }
      await aiWriteWorkspaceConfig(workDir, JSON.stringify(config, null, 2))
      const next = { ...workspaceGates.value }
      delete next[key]
      workspaceGates.value = next
      log.info('feature_gate_workspace_removed', { key, workDir })
    } catch (e) {
      log.warn('feature_gate_workspace_remove_failed', { key, workDir }, e)
    }
  }

  /**
   * 重置所有本地覆盖
   */
  async function resetLocal(): Promise<void> {
    const keys = Object.keys(localGates.value)
    localGates.value = {}
    writeLocalGates({})
    for (const key of keys) {
      try {
        await deleteFeatureGate(key)
      } catch (e) {
        log.warn('feature_gate_backend_remove_failed', { key }, e)
      }
    }
    log.info('feature_gate_local_reset')
  }

  /**
   * 从后端加载本地级 Feature Gate 覆盖值
   */
  async function loadLocalGates(): Promise<void> {
    try {
      const entries = await readFeatureGates()
      const map: Record<string, boolean> = {}
      for (const e of entries) {
        map[e.key] = e.enabled
      }
      localGates.value = map
      writeLocalGates(map)
      log.info('feature_gate_local_loaded', { count: entries.length })
    } catch (e) {
      log.warn('feature_gate_local_load_failed', undefined, e)
    }
  }

  return {
    localGates: computed(() => ({ ...localGates.value })),
    workspaceGates: computed(() => ({ ...workspaceGates.value })),
    workspaceGatesLoaded,
    isEnabled,
    getGate,
    allGates,
    loadWorkspaceGates,
    setLocal,
    removeLocal,
    setWorkspace,
    removeWorkspace,
    resetLocal,
    loadLocalGates,
  }
})
