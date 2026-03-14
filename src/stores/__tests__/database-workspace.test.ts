/**
 * database-workspace store 单元测试
 *
 * 覆盖场景：
 * - getOrCreate：创建默认工作区 / 幂等返回已有工作区
 * - addQueryTab：自动编号、激活新 tab
 * - addInnerTab：添加新 tab / 重复 id 只激活不添加
 * - closeInnerTab：普通关闭、关闭 active tab 后切换、不可关闭 tab 保护
 * - closeOtherTabs / closeAllTabs
 * - setActiveInnerTab
 * - updateTabContext：不可变更新（新旧引用不同）
 * - setTabDirty
 * - cleanup
 * - reopenLastClosedTab / getClosedTabCount
 * - openTableEditor / openTableData（便捷方法）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestPinia } from '@/__tests__/helpers'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import type { InnerTab, QueryTabContext } from '@/types/database-workspace'

// ===== Mock 外部依赖 =====

// mock 持久化插件，避免触发 SQLite 操作
vi.mock('@/plugins/persistence', () => ({
  usePersistence: () => ({
    load: vi.fn().mockResolvedValue(false),
    autoSave: vi.fn(),
  }),
}))

// mock 数据库 API，避免 closeInnerTab 中的动态 import 实际发出请求
// 注意：store 使用运行时动态 import('@/api/database')，
// 使用普通函数（非 vi.fn()）避免被 vitest mockReset 清除返回值
vi.mock('@/api/database', () => ({
  dbReleaseSession: () => Promise.resolve(undefined),
}))

// 通知 vitest 该模块有动态 import，需要在模拟中也覆盖
// （vitest 的 vi.mock 会自动处理动态 import，无需额外操作，
//  但必须确保 mock 工厂的函数签名返回 Promise）

// mock locales，store 内部用 i18n.global.t 生成 tab 标题
vi.mock('@/locales', () => ({
  i18n: {
    global: {
      t: (key: string) => key,
    },
  },
}))

// ===== 测试辅助 =====

/** 构造一个最简单的可关闭 InnerTab */
function makeTab(id: string, title = 'Tab'): InnerTab {
  return {
    id,
    type: 'query',
    title,
    closable: true,
    context: {
      type: 'query',
      sql: '',
      result: null,
      isExecuting: false,
    },
  }
}

const CONN = 'conn-1'

// ===== 测试套件 =====

describe('useDatabaseWorkspaceStore', () => {
  beforeEach(() => {
    // 每个测试重新初始化独立 Pinia，保证状态隔离
    setupTestPinia()
  })

  afterEach(async () => {
    // flush 动态 import 产生的微任务（closeInnerTab 内部的 dbReleaseSession），
    // 防止 vitest 报 unhandled rejection
    await new Promise((r) => setTimeout(r, 0))
  })

  // ─────────────────────────────────────────────
  // getOrCreate
  // ─────────────────────────────────────────────
  describe('getOrCreate', () => {
    it('首次调用：创建含 1 个不可关闭 query tab 的默认工作区', () => {
      const store = useDatabaseWorkspaceStore()
      const ws = store.getOrCreate(CONN)

      // 工作区应存在
      expect(ws).toBeDefined()
      // 默认只有 1 个 tab
      expect(ws.tabs).toHaveLength(1)

      const defaultTab = ws.tabs[0]!
      // 默认 tab 类型必须是 query
      expect(defaultTab.type).toBe('query')
      // 默认 tab 不可关闭
      expect(defaultTab.closable).toBe(false)
      // activeTabId 指向该 tab
      expect(ws.activeTabId).toBe(defaultTab.id)
    })

    it('重复调用：返回已有工作区，不创建新工作区', () => {
      const store = useDatabaseWorkspaceStore()
      const ws1 = store.getOrCreate(CONN)
      const ws2 = store.getOrCreate(CONN)

      // 两次调用应返回相同内容的工作区（不可变模式下 reactive 代理可能不同引用）
      expect(ws2).toStrictEqual(ws1)
      // store 中只有 1 个工作区
      expect(store.workspaces.size).toBe(1)
    })

    it('不同 connId 分别创建独立工作区', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate('conn-A')
      store.getOrCreate('conn-B')

      expect(store.workspaces.size).toBe(2)
      expect(store.workspaces.has('conn-A')).toBe(true)
      expect(store.workspaces.has('conn-B')).toBe(true)
    })
  })

  // ─────────────────────────────────────────────
  // addQueryTab
  // ─────────────────────────────────────────────
  describe('addQueryTab', () => {
    it('添加第二个 query tab，编号递增为 Query 2', () => {
      const store = useDatabaseWorkspaceStore()
      // 先创建默认工作区（Query 1）
      store.getOrCreate(CONN)
      const newTab = store.addQueryTab(CONN)

      // 标题应包含递增编号
      expect(newTab.title).toBe('Query 2')
      // 新 tab 必须是可关闭的
      expect(newTab.closable).toBe(true)
    })

    it('连续添加 3 个 query tab，编号依次为 2、3、4', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN) // Query 1
      const t2 = store.addQueryTab(CONN) // Query 2
      const t3 = store.addQueryTab(CONN) // Query 3
      const t4 = store.addQueryTab(CONN) // Query 4

      expect(t2.title).toBe('Query 2')
      expect(t3.title).toBe('Query 3')
      expect(t4.title).toBe('Query 4')
    })

    it('添加 query tab 后，新 tab 成为 activeTabId', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)
      const newTab = store.addQueryTab(CONN)

      const ws = store.getWorkspace(CONN)!
      expect(ws.activeTabId).toBe(newTab.id)
    })

    it('添加 query tab 后，tabs 总数增加 1', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN) // 1 个 tab
      store.addQueryTab(CONN)

      const ws = store.getWorkspace(CONN)!
      expect(ws.tabs).toHaveLength(2)
    })
  })

  // ─────────────────────────────────────────────
  // addInnerTab
  // ─────────────────────────────────────────────
  describe('addInnerTab', () => {
    it('添加新 tab：tabs 增加 1 且新 tab 成为 active', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      const tab = makeTab('custom-tab-1', '自定义标签')
      store.addInnerTab(CONN, tab)

      const ws = store.getWorkspace(CONN)!
      expect(ws.tabs).toHaveLength(2)
      expect(ws.activeTabId).toBe('custom-tab-1')
    })

    it('重复添加相同 id 的 tab：只激活，不重复添加', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      const tab = makeTab('dup-tab')
      store.addInnerTab(CONN, tab) // 第一次添加
      const countAfterFirst = store.getWorkspace(CONN)!.tabs.length

      // 切换 active 到默认 tab，再次添加重复 id
      const defaultTabId = store.getWorkspace(CONN)!.tabs[0]!.id
      store.setActiveInnerTab(CONN, defaultTabId)

      store.addInnerTab(CONN, tab) // 第二次：重复 id
      const ws = store.getWorkspace(CONN)!

      // tab 数量不变
      expect(ws.tabs).toHaveLength(countAfterFirst)
      // 激活已存在的 tab
      expect(ws.activeTabId).toBe('dup-tab')
    })

    it('添加 tab 到不存在的 connId：自动创建工作区', () => {
      const store = useDatabaseWorkspaceStore()
      const tab = makeTab('new-conn-tab')
      store.addInnerTab('new-conn', tab)

      const ws = store.getWorkspace('new-conn')
      // 自动创建工作区，应存在
      expect(ws).toBeDefined()
      // 工作区包含默认 tab + 新添加的 tab
      expect(ws!.tabs.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ─────────────────────────────────────────────
  // closeInnerTab
  // ─────────────────────────────────────────────
  describe('closeInnerTab', () => {
    it('关闭可关闭的 tab：tab 被移除', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)
      const tab = store.addQueryTab(CONN) // 可关闭

      store.closeInnerTab(CONN, tab.id)

      const ws = store.getWorkspace(CONN)!
      // tab 应已不存在
      expect(ws.tabs.find(t => t.id === tab.id)).toBeUndefined()
    })

    it('关闭 tab 后，该 tab 保存到 closedTabs 栈', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)
      const tab = store.addQueryTab(CONN)

      store.closeInnerTab(CONN, tab.id)

      // closedTabs 应有 1 条记录
      expect(store.getClosedTabCount(CONN)).toBe(1)
    })

    it('关闭 closable=false 的 tab：操作被忽略', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      const ws = store.getWorkspace(CONN)!
      const defaultTab = ws.tabs[0]! // closable=false
      const beforeCount = ws.tabs.length

      store.closeInnerTab(CONN, defaultTab.id)

      // tab 数量不变
      expect(store.getWorkspace(CONN)!.tabs).toHaveLength(beforeCount)
    })

    it('关闭当前 active tab：自动切换到相邻 tab', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN) // tab 0（不可关闭）
      const tab2 = store.addQueryTab(CONN) // tab 1（可关闭）
      store.addQueryTab(CONN) // tab 2（可关闭）

      // 激活 tab2（索引 1）
      store.setActiveInnerTab(CONN, tab2.id)
      store.closeInnerTab(CONN, tab2.id)

      const ws = store.getWorkspace(CONN)!
      // 关闭后 active 应变为其他 tab，不能是被关闭的 tab
      expect(ws.activeTabId).not.toBe(tab2.id)
      // 剩余 tab 中必须有一个 id 等于 activeTabId
      expect(ws.tabs.find(t => t.id === ws.activeTabId)).toBeDefined()
    })

    it('关闭最后一个非 active 的 tab：active 不变', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)
      const tab2 = store.addQueryTab(CONN)
      const tab3 = store.addQueryTab(CONN)

      // 激活 tab2，关闭 tab3（不是 active）
      store.setActiveInnerTab(CONN, tab2.id)
      store.closeInnerTab(CONN, tab3.id)

      const ws = store.getWorkspace(CONN)!
      // active 应保持 tab2
      expect(ws.activeTabId).toBe(tab2.id)
    })

    it('关闭不存在的 connId：不报错', () => {
      const store = useDatabaseWorkspaceStore()
      expect(() => store.closeInnerTab('nonexistent', 'any-tab')).not.toThrow()
    })
  })

  // ─────────────────────────────────────────────
  // closeOtherTabs
  // ─────────────────────────────────────────────
  describe('closeOtherTabs', () => {
    it('关闭其他可关闭的 tab，保留目标 tab 和不可关闭 tab', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN) // 不可关闭的默认 tab
      const tab2 = store.addQueryTab(CONN)
      const tab3 = store.addQueryTab(CONN)

      // 保留 tab2，关闭其他可关闭的
      store.closeOtherTabs(CONN, tab2.id)

      const ws = store.getWorkspace(CONN)!
      // tab3 应被关闭
      expect(ws.tabs.find(t => t.id === tab3.id)).toBeUndefined()
      // tab2 应保留
      expect(ws.tabs.find(t => t.id === tab2.id)).toBeDefined()
      // 不可关闭的默认 tab 应保留
      expect(ws.tabs.filter(t => !t.closable)).toHaveLength(1)
      // active 应切换到目标 tab
      expect(ws.activeTabId).toBe(tab2.id)
    })

    it('对不存在的 connId 调用不报错', () => {
      const store = useDatabaseWorkspaceStore()
      expect(() => store.closeOtherTabs('nonexistent', 'any')).not.toThrow()
    })
  })

  // ─────────────────────────────────────────────
  // closeAllTabs
  // ─────────────────────────────────────────────
  describe('closeAllTabs', () => {
    it('关闭所有可关闭的 tab，只保留不可关闭 tab', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN) // 不可关闭
      store.addQueryTab(CONN)
      store.addQueryTab(CONN)

      store.closeAllTabs(CONN)

      const ws = store.getWorkspace(CONN)!
      // 所有 closable=true 的 tab 应被清除
      expect(ws.tabs.filter(t => t.closable)).toHaveLength(0)
      // 不可关闭的 tab 应保留
      expect(ws.tabs.filter(t => !t.closable)).toHaveLength(1)
    })

    it('closeAllTabs 后，activeTabId 指向第一个剩余 tab', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)
      store.addQueryTab(CONN)

      store.closeAllTabs(CONN)

      const ws = store.getWorkspace(CONN)!
      expect(ws.activeTabId).toBe(ws.tabs[0]?.id)
    })

    it('对不存在的 connId 调用不报错', () => {
      const store = useDatabaseWorkspaceStore()
      expect(() => store.closeAllTabs('nonexistent')).not.toThrow()
    })
  })

  // ─────────────────────────────────────────────
  // setActiveInnerTab
  // ─────────────────────────────────────────────
  describe('setActiveInnerTab', () => {
    it('切换 activeTabId 到指定 tab', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)
      const tab2 = store.addQueryTab(CONN)

      store.setActiveInnerTab(CONN, tab2.id)

      expect(store.getWorkspace(CONN)!.activeTabId).toBe(tab2.id)
    })

    it('对不存在的 connId 调用不报错', () => {
      const store = useDatabaseWorkspaceStore()
      expect(() => store.setActiveInnerTab('nonexistent', 'any')).not.toThrow()
    })
  })

  // ─────────────────────────────────────────────
  // updateTabContext —— 不可变更新验证
  // ─────────────────────────────────────────────
  describe('updateTabContext', () => {
    it('更新后 context 字段合并，SQL 被更新', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      const ws = store.getWorkspace(CONN)!
      const tabId = ws.tabs[0]!.id

      store.updateTabContext(CONN, tabId, { sql: 'SELECT 1' })

      const updatedTab = store.getWorkspace(CONN)!.tabs[0]!
      expect((updatedTab.context as QueryTabContext).sql).toBe('SELECT 1')
    })

    it('不可变更新：更新后 tab 对象引用与更新前不同', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      const beforeTab = store.getWorkspace(CONN)!.tabs[0]!
      store.updateTabContext(CONN, beforeTab.id, { sql: 'SELECT 2' })
      const afterTab = store.getWorkspace(CONN)!.tabs[0]!

      // 引用不同，证明是新对象（不可变更新）
      expect(afterTab).not.toBe(beforeTab)
    })

    it('不可变更新：更新后工作区对象引用与更新前不同', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      const beforeWs = store.getWorkspace(CONN)!
      const tabId = beforeWs.tabs[0]!.id

      store.updateTabContext(CONN, tabId, { sql: 'SELECT 3' })
      const afterWs = store.getWorkspace(CONN)!

      expect(afterWs).not.toBe(beforeWs)
    })

    it('只更新指定字段，其他字段保持原值', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      const tabId = store.getWorkspace(CONN)!.tabs[0]!.id
      // 先设置 isExecuting=true
      store.updateTabContext(CONN, tabId, { isExecuting: true })
      // 再只更新 sql，isExecuting 应保持 true
      store.updateTabContext(CONN, tabId, { sql: 'SELECT 1' })

      const ctx = store.getWorkspace(CONN)!.tabs[0]!.context as QueryTabContext
      expect(ctx.sql).toBe('SELECT 1')
      expect(ctx.isExecuting).toBe(true)
    })

    it('对不存在的 connId 调用不报错', () => {
      const store = useDatabaseWorkspaceStore()
      expect(() => store.updateTabContext('nonexistent', 'any', { sql: '' })).not.toThrow()
    })
  })

  // ─────────────────────────────────────────────
  // setTabDirty
  // ─────────────────────────────────────────────
  describe('setTabDirty', () => {
    it('将 dirty 设置为 true', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      const tabId = store.getWorkspace(CONN)!.tabs[0]!.id
      store.setTabDirty(CONN, tabId, true)

      expect(store.getWorkspace(CONN)!.tabs[0]!.dirty).toBe(true)
    })

    it('将 dirty 从 true 恢复为 false', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      const tabId = store.getWorkspace(CONN)!.tabs[0]!.id
      store.setTabDirty(CONN, tabId, true)
      store.setTabDirty(CONN, tabId, false)

      expect(store.getWorkspace(CONN)!.tabs[0]!.dirty).toBe(false)
    })

    it('不可变更新：setTabDirty 后 tab 引用变化', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      const before = store.getWorkspace(CONN)!.tabs[0]!
      store.setTabDirty(CONN, before.id, true)
      const after = store.getWorkspace(CONN)!.tabs[0]!

      expect(after).not.toBe(before)
    })

    it('对不存在的 connId 调用不报错', () => {
      const store = useDatabaseWorkspaceStore()
      expect(() => store.setTabDirty('nonexistent', 'any', true)).not.toThrow()
    })
  })

  // ─────────────────────────────────────────────
  // cleanup
  // ─────────────────────────────────────────────
  describe('cleanup', () => {
    it('cleanup 后工作区从 Map 中移除', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      expect(store.workspaces.has(CONN)).toBe(true)
      store.cleanup(CONN)
      expect(store.workspaces.has(CONN)).toBe(false)
    })

    it('cleanup 后再次 getOrCreate 从 1 重新编号', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)
      store.addQueryTab(CONN) // Query 2
      store.cleanup(CONN)

      // 重新创建，queryCounter 应重置，从 Query 1 开始
      const ws = store.getOrCreate(CONN)
      expect(ws.tabs[0]!.title).toBe('Query 1')
    })

    it('cleanup 不存在的 connId 不报错', () => {
      const store = useDatabaseWorkspaceStore()
      expect(() => store.cleanup('nonexistent')).not.toThrow()
    })
  })

  // ─────────────────────────────────────────────
  // reopenLastClosedTab / getClosedTabCount
  // ─────────────────────────────────────────────
  describe('reopenLastClosedTab', () => {
    it('恢复最近关闭的 tab，closedTabs 数量减 1', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)
      const tab2 = store.addQueryTab(CONN)
      const tab3 = store.addQueryTab(CONN)

      store.closeInnerTab(CONN, tab2.id)
      store.closeInnerTab(CONN, tab3.id)

      // 关闭了 2 个 tab
      expect(store.getClosedTabCount(CONN)).toBe(2)

      const restored = store.reopenLastClosedTab(CONN)

      // 恢复最近关闭的（tab3），closedTabs 减少 1
      expect(restored).not.toBeNull()
      expect(store.getClosedTabCount(CONN)).toBe(1)
    })

    it('恢复后 tab 以新 id 添加到工作区', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)
      const tab2 = store.addQueryTab(CONN)
      store.closeInnerTab(CONN, tab2.id)

      const restored = store.reopenLastClosedTab(CONN)!

      // 新 id 与原 id 不同（避免冲突）
      expect(restored.id).not.toBe(tab2.id)
      // 工作区中应包含新 id 的 tab
      expect(store.getWorkspace(CONN)!.tabs.find(t => t.id === restored.id)).toBeDefined()
    })

    it('恢复后新 tab 成为 active', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)
      const tab2 = store.addQueryTab(CONN)
      store.closeInnerTab(CONN, tab2.id)

      const restored = store.reopenLastClosedTab(CONN)!
      expect(store.getWorkspace(CONN)!.activeTabId).toBe(restored.id)
    })

    it('没有已关闭 tab 时返回 null', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      const result = store.reopenLastClosedTab(CONN)
      expect(result).toBeNull()
    })

    it('对不存在的 connId 返回 null', () => {
      const store = useDatabaseWorkspaceStore()
      const result = store.reopenLastClosedTab('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('getClosedTabCount', () => {
    it('初始状态返回 0', () => {
      const store = useDatabaseWorkspaceStore()
      expect(store.getClosedTabCount(CONN)).toBe(0)
    })

    it('关闭 N 个 tab 后返回 N', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)
      const t1 = store.addQueryTab(CONN)
      const t2 = store.addQueryTab(CONN)
      const t3 = store.addQueryTab(CONN)

      store.closeInnerTab(CONN, t1.id)
      store.closeInnerTab(CONN, t2.id)
      store.closeInnerTab(CONN, t3.id)

      expect(store.getClosedTabCount(CONN)).toBe(3)
    })

    it('closedTabs 最多保存 20 条', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      // 添加并关闭 25 个 tab
      for (let i = 0; i < 25; i++) {
        const tab = store.addQueryTab(CONN)
        store.closeInnerTab(CONN, tab.id)
      }

      // 应截断到 20 条
      expect(store.getClosedTabCount(CONN)).toBe(20)
    })
  })

  // ─────────────────────────────────────────────
  // openTableEditor
  // ─────────────────────────────────────────────
  describe('openTableEditor', () => {
    it('打开编辑已有表：tab id 含表名，类型为 table-editor', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      store.openTableEditor(CONN, 'mydb', 'users')

      const ws = store.getWorkspace(CONN)!
      const editorTab = ws.tabs.find(t => t.type === 'table-editor')
      expect(editorTab).toBeDefined()
      expect(editorTab!.id).toContain('users')
      expect(editorTab!.closable).toBe(true)
    })

    it('打开新建表（无 table 参数）：tab id 含 new', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      store.openTableEditor(CONN, 'mydb')

      const ws = store.getWorkspace(CONN)!
      const editorTab = ws.tabs.find(t => t.type === 'table-editor')
      expect(editorTab).toBeDefined()
      expect(editorTab!.id).toContain('new')
    })

    it('重复打开同一张表：只激活，不重复添加 tab', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      store.openTableEditor(CONN, 'mydb', 'users')
      const countAfterFirst = store.getWorkspace(CONN)!.tabs.length

      store.openTableEditor(CONN, 'mydb', 'users')
      const countAfterSecond = store.getWorkspace(CONN)!.tabs.length

      expect(countAfterSecond).toBe(countAfterFirst)
    })

    it('打开 table-editor 后该 tab 成为 active', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      store.openTableEditor(CONN, 'mydb', 'orders')

      const ws = store.getWorkspace(CONN)!
      const editorTab = ws.tabs.find(t => t.type === 'table-editor')!
      expect(ws.activeTabId).toBe(editorTab.id)
    })
  })

  // ─────────────────────────────────────────────
  // openTableData
  // ─────────────────────────────────────────────
  describe('openTableData', () => {
    it('创建 table-data tab，context 包含正确的分页默认值', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      store.openTableData(CONN, 'mydb', 'products')

      const ws = store.getWorkspace(CONN)!
      const dataTab = ws.tabs.find(t => t.type === 'table-data')
      expect(dataTab).toBeDefined()

      const ctx = dataTab!.context as { type: string; page: number; pageSize: number }
      expect(ctx.page).toBe(1)
      expect(ctx.pageSize).toBe(100)
    })

    it('table-data tab 的 context 包含正确的 database 和 table', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      store.openTableData(CONN, 'shop', 'orders')

      const ws = store.getWorkspace(CONN)!
      const dataTab = ws.tabs.find(t => t.type === 'table-data')!
      const ctx = dataTab.context as { database: string; table: string }
      expect(ctx.database).toBe('shop')
      expect(ctx.table).toBe('orders')
    })

    it('重复打开同一张表数据：只激活，不重复添加', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)

      store.openTableData(CONN, 'mydb', 'users')
      const countAfterFirst = store.getWorkspace(CONN)!.tabs.length

      store.openTableData(CONN, 'mydb', 'users')
      expect(store.getWorkspace(CONN)!.tabs.length).toBe(countAfterFirst)
    })
  })

  // ─────────────────────────────────────────────
  // getWorkspace
  // ─────────────────────────────────────────────
  describe('getWorkspace', () => {
    it('不存在的 connId 返回 undefined', () => {
      const store = useDatabaseWorkspaceStore()
      expect(store.getWorkspace('nonexistent')).toBeUndefined()
    })

    it('存在的 connId 返回工作区对象', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)
      expect(store.getWorkspace(CONN)).toBeDefined()
    })
  })

  // ─────────────────────────────────────────────
  // 边界情况：空 / null 输入
  // ─────────────────────────────────────────────
  describe('边界情况', () => {
    it('closeInnerTab：tabId 不存在时不报错、不修改 tabs', () => {
      const store = useDatabaseWorkspaceStore()
      store.getOrCreate(CONN)
      const before = store.getWorkspace(CONN)!.tabs.length

      store.closeInnerTab(CONN, 'nonexistent-tab-id')

      expect(store.getWorkspace(CONN)!.tabs.length).toBe(before)
    })

    it('addQueryTab 对不存在的 connId：自动创建工作区并添加', () => {
      const store = useDatabaseWorkspaceStore()
      const tab = store.addQueryTab('brand-new-conn')

      expect(tab).toBeDefined()
      expect(store.getWorkspace('brand-new-conn')).toBeDefined()
    })
  })
})
