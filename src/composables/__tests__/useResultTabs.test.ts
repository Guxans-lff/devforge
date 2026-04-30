import { computed, nextTick, ref } from 'vue'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestPinia } from '@/__tests__/helpers'
import { useResultTabs } from '@/composables/useResultTabs'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import type { QueryResult } from '@/types/database'
import type { QueryTabContext, ResultTab } from '@/types/database-workspace'

vi.mock('@/plugins/persistence', () => ({
  usePersistence: () => ({
    load: vi.fn().mockResolvedValue(false),
    autoSave: vi.fn(),
  }),
}))

vi.mock('@/api/database', () => ({
  dbReleaseSession: () => Promise.resolve(undefined),
}))

vi.mock('@/locales', () => ({
  i18n: {
    global: {
      t: (key: string) => key,
    },
  },
}))

const CONN = 'conn-1'
const TAB_ID = 'conn-1-query-1'

function makeResult(label: string): QueryResult {
  return {
    columns: [{ name: 'id', dataType: 'INT', nullable: false }],
    rows: [[label]],
    affectedRows: 0,
    executionTimeMs: 1,
    isError: false,
    error: null,
    totalCount: 1,
    truncated: false,
  }
}

function makeResultTab(id: string, label: string): ResultTab {
  return {
    id,
    title: label,
    result: makeResult(label),
    sql: `SELECT '${label}'`,
    isPinned: false,
    createdAt: 1,
  }
}

function setupComposable(initialContext: Partial<QueryTabContext> = {}) {
  const store = useDatabaseWorkspaceStore()
  store.getOrCreate(CONN)
  store.updateTabContext(CONN, TAB_ID, initialContext)

  const tabContext = computed(() => {
    const ws = store.getWorkspace(CONN)
    return ws?.tabs.find(tab => tab.id === TAB_ID)?.context as QueryTabContext | undefined
  })

  return {
    store,
    composable: useResultTabs({
      connectionId: ref(CONN),
      tabId: ref(TAB_ID),
      tabContext,
    }),
  }
}

describe('useResultTabs', () => {
  beforeEach(() => {
    setupTestPinia()
  })

  it('activeResultTabId 指向失效标签时自动回退到最后一个可用结果标签', async () => {
    const { store, composable } = setupComposable({
      result: makeResult('fallback'),
      resultTabs: [
        makeResultTab('tab-1', '结果 1'),
        makeResultTab('tab-2', '结果 2'),
      ],
      activeResultTabId: 'missing-tab',
    })

    expect(composable.activeResultTabId.value).toBe('tab-2')
    expect(composable.activeResultTab.value?.id).toBe('tab-2')
    expect(composable.displayResult.value?.rows).toEqual([['结果 2']])

    const ctx = store.getWorkspace(CONN)!.tabs[0]!.context as QueryTabContext
    expect(ctx.activeResultTabId).toBe('tab-2')
  })

  it('结果标签清空后自动清理失效 activeResultTabId 并回退到主结果', async () => {
    const { store, composable } = setupComposable({
      result: makeResult('main-result'),
      resultTabs: [makeResultTab('tab-1', '结果 1')],
      activeResultTabId: 'tab-1',
    })

    store.updateTabContext(CONN, TAB_ID, {
      resultTabs: [],
      activeResultTabId: 'tab-1',
    })
    await nextTick()

    expect(composable.activeResultTabId.value).toBe(null)
    expect(composable.activeResultTab.value).toBeNull()
    expect(composable.displayResult.value?.rows).toEqual([['main-result']])

    const ctx = store.getWorkspace(CONN)!.tabs[0]!.context as QueryTabContext
    expect(ctx.activeResultTabId).toBeUndefined()
  })
})
