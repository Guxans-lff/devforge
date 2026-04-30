import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import type { QueryResult } from '@/types/database'
import type { QueryTabContext, ResultTab } from '@/types/database-workspace'

/** 最大结果标签页数量 */
const MAX_RESULT_TABS = 10

export interface UseResultTabsOptions {
  connectionId: Ref<string>
  tabId: Ref<string>
  tabContext: ComputedRef<QueryTabContext | undefined>
}

function resolveActiveResultTab(resultTabs: ResultTab[], activeResultTabId: string | null | undefined): ResultTab | null {
  if (!activeResultTabId) return null
  return resultTabs.find(t => t.id === activeResultTabId) ?? null
}

/**
 * 结果标签页管理 composable
 * 负责：结果标签页的增删改查、固定、右键菜单、多语句子结果切换
 */
export function useResultTabs(options: UseResultTabsOptions) {
  const { connectionId, tabId, tabContext } = options
  const store = useDatabaseWorkspaceStore()

  // ===== 标签页状态 =====
  const resultTabs = computed(() => tabContext.value?.resultTabs ?? [])
  const activeResultTabId = computed(() => tabContext.value?.activeResultTabId ?? null)

  const activeResultTab = computed(() => resolveActiveResultTab(resultTabs.value, activeResultTabId.value))

  watch(
    () => [resultTabs.value, activeResultTabId.value] as const,
    ([tabs, activeId]) => {
      if (tabs.length === 0) {
        if (activeId !== null && activeId !== undefined) {
          store.updateTabContext(connectionId.value, tabId.value, {
            activeResultTabId: undefined,
          })
        }
        return
      }

      if (resolveActiveResultTab(tabs, activeId)) return
      store.updateTabContext(connectionId.value, tabId.value, {
        activeResultTabId: tabs[tabs.length - 1]!.id,
      })
    },
    { immediate: true },
  )

  // ===== 多语句子结果切换 =====
  const activeSubResultIndex = ref(-1)
  const subResults = computed(() => activeResultTab.value?.subResults ?? [])
  const isMultiResultTab = computed(() => subResults.value.length > 0)

  function setActiveSubResult(index: number) {
    activeSubResultIndex.value = index
  }

  // 切换结果 Tab 时重置子结果索引
  watch(activeResultTabId, () => {
    activeSubResultIndex.value = -1
  })

  // ===== 当前显示的查询结果 =====
  const displayResult = computed(() => {
    if (activeResultTab.value) {
      if (isMultiResultTab.value && activeSubResultIndex.value >= 0) {
        const sub = subResults.value[activeSubResultIndex.value]
        if (sub) return sub.result
      }
      return activeResultTab.value.result
    }
    return tabContext.value?.result ?? null
  })

  // ===== 标签页操作 =====
  function addResultTab(sql: string, result: QueryResult) {
    const tabs = [...resultTabs.value]

    // 超过最大数量时，关闭最早的非固定标签页
    while (tabs.length >= MAX_RESULT_TABS) {
      const unpinnedIdx = tabs.findIndex(t => !t.isPinned)
      if (unpinnedIdx === -1) break
      tabs.splice(unpinnedIdx, 1)
    }

    const nextIndex = tabs.length + 1
    const newTab: ResultTab = {
      id: crypto.randomUUID(),
      title: `结果 ${nextIndex}`,
      result,
      sql: sql.trim(),
      isPinned: false,
      createdAt: Date.now(),
    }
    tabs.push(newTab)

    store.updateTabContext(connectionId.value, tabId.value, {
      resultTabs: tabs,
      activeResultTabId: newTab.id,
    })
  }

  function setActiveResultTab(resultTabId: string) {
    store.updateTabContext(connectionId.value, tabId.value, {
      activeResultTabId: resultTabId,
    })
  }

  function closeResultTab(resultTabId: string) {
    const tabs = resultTabs.value.filter(t => t.id !== resultTabId)
    const newActiveId = activeResultTabId.value === resultTabId
      ? (tabs.length > 0 ? tabs[tabs.length - 1]!.id : undefined)
      : (activeResultTabId.value ?? undefined)
    store.updateTabContext(connectionId.value, tabId.value, {
      resultTabs: tabs,
      activeResultTabId: newActiveId,
    })
  }

  function closeOtherResultTabs(resultTabId: string) {
    const tabs = resultTabs.value.filter(t => t.id === resultTabId || t.isPinned)
    store.updateTabContext(connectionId.value, tabId.value, {
      resultTabs: tabs,
      activeResultTabId: resultTabId,
    })
  }

  function closeAllResultTabs() {
    const tabs = resultTabs.value.filter(t => t.isPinned)
    store.updateTabContext(connectionId.value, tabId.value, {
      resultTabs: tabs,
      activeResultTabId: tabs.length > 0 ? tabs[0]!.id : undefined,
    })
  }

  function togglePinResultTab(resultTabId: string) {
    const tabs = resultTabs.value.map(t =>
      t.id === resultTabId ? { ...t, isPinned: !t.isPinned } : t,
    )
    store.updateTabContext(connectionId.value, tabId.value, {
      resultTabs: tabs,
    })
  }

  // ===== 右键菜单 =====
  const contextMenu = ref<{ x: number; y: number; tabId: string } | null>(null)

  function showContextMenu(e: MouseEvent, resultTabId: string) {
    e.preventDefault()
    contextMenu.value = { x: e.clientX, y: e.clientY, tabId: resultTabId }
  }

  function closeContextMenu() {
    contextMenu.value = null
  }

  return {
    // 标签页状态
    resultTabs,
    activeResultTabId,
    activeResultTab,
    displayResult,

    // 多语句子结果
    activeSubResultIndex,
    subResults,
    isMultiResultTab,
    setActiveSubResult,

    // 标签页操作
    addResultTab,
    setActiveResultTab,
    closeResultTab,
    closeOtherResultTabs,
    closeAllResultTabs,
    togglePinResultTab,

    // 右键菜单
    contextMenu,
    showContextMenu,
    closeContextMenu,
  }
}
