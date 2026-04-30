import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

const mocks = vi.hoisted(() => ({
  dbGetServerStatusMock: vi.fn(),
  dbGetProcessListMock: vi.fn(),
  dbGetServerVariablesMock: vi.fn(),
  dbKillProcessMock: vi.fn(),
  messageSuccessMock: vi.fn(),
  messageErrorMock: vi.fn(),
}))

vi.mock('lucide-vue-next', () => {
  const createIcon = (name: string) => defineComponent({
    name,
    setup() {
      return () => h('svg', { 'data-icon': name })
    },
  })

  return {
    Activity: createIcon('Activity'),
    Database: createIcon('Database'),
    Gauge: createIcon('Gauge'),
    Clock: createIcon('Clock'),
    AlertTriangle: createIcon('AlertTriangle'),
    RefreshCw: createIcon('RefreshCw'),
    Terminal: createIcon('Terminal'),
    Settings: createIcon('Settings'),
    Search: createIcon('Search'),
    Trash2: createIcon('Trash2'),
    Shield: createIcon('Shield'),
    Info: createIcon('Info'),
    GitCompare: createIcon('GitCompare'),
  }
})

vi.mock('@/components/ui/button', () => ({
  Button: defineComponent({
    name: 'Button',
    emits: ['click'],
    setup(_props, { slots, attrs, emit }) {
      return () => h('button', {
        ...attrs,
        onClick: (event: MouseEvent) => emit('click', event),
      }, slots.default?.())
    },
  }),
}))

vi.mock('@/components/ui/input', () => ({
  Input: defineComponent({
    name: 'Input',
    props: ['modelValue', 'placeholder'],
    emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () => h('input', {
        ...attrs,
        value: props.modelValue ?? '',
        placeholder: props.placeholder,
        onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value),
      })
    },
  }),
}))

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: defineComponent({
    name: 'ScrollArea',
    setup(_props, { slots }) {
      return () => h('div', { class: 'scroll-area-stub' }, slots.default?.())
    },
  }),
}))

vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: defineComponent({
    name: 'ConfirmDialog',
    setup() {
      return () => h('div')
    },
  }),
}))

vi.mock('@/components/database/SlowQueryPanel.vue', () => ({
  default: defineComponent({
    name: 'SlowQueryPanel',
    setup() {
      return () => h('div', { class: 'slow-query-panel-stub' })
    },
  }),
}))

vi.mock('@/components/database/InnoDbPanel.vue', () => ({
  default: defineComponent({
    name: 'InnoDbPanel',
    setup() {
      return () => h('div', { class: 'innodb-panel-stub' })
    },
  }),
}))

vi.mock('@/components/database/IndexAdvisorPanel.vue', () => ({
  default: defineComponent({
    name: 'IndexAdvisorPanel',
    setup() {
      return () => h('div', { class: 'index-advisor-panel-stub' })
    },
  }),
}))

vi.mock('@/components/database/ExplainComparePanel.vue', () => ({
  default: defineComponent({
    name: 'ExplainComparePanel',
    setup() {
      return () => h('div', { class: 'explain-compare-panel-stub' })
    },
  }),
}))

vi.mock('@/components/database/AuditLogPanel.vue', () => ({
  default: defineComponent({
    name: 'AuditLogPanel',
    setup() {
      return () => h('div', { class: 'audit-log-panel-stub' })
    },
  }),
}))

vi.mock('@/api/database', () => ({
  dbGetServerStatus: mocks.dbGetServerStatusMock,
  dbGetProcessList: mocks.dbGetProcessListMock,
  dbKillProcess: mocks.dbKillProcessMock,
  dbGetServerVariables: mocks.dbGetServerVariablesMock,
}))

vi.mock('@/stores/message-center', () => ({
  useMessage: () => ({
    success: mocks.messageSuccessMock,
    error: mocks.messageErrorMock,
  }),
}))

import PerformanceDashboard from '@/components/database/PerformanceDashboard.vue'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'

function mountDashboard(activeSubTab: 'dashboard' | 'processes' | 'variables' = 'dashboard') {
  const workspaceStore = useDatabaseWorkspaceStore()
  workspaceStore.addInnerTab('conn-1', {
    id: 'perf-1',
    type: 'performance',
    title: '性能监控',
    closable: true,
    context: {
      type: 'performance',
      activeSubTab,
    },
  })

  return mount(PerformanceDashboard, {
    props: {
      connectionId: 'conn-1',
      tabId: 'perf-1',
      isConnected: true,
    },
    attachTo: document.body,
  })
}

describe('PerformanceDashboard 加载状态隔离', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useRealTimers()

    mocks.dbGetServerStatusMock.mockResolvedValue({
      qps: 12,
      tps: 4,
      activeConnections: 3,
      totalConnections: 8,
      bufferPoolUsage: 0.61,
      slowQueries: 0,
      uptime: 7200,
      bytesSent: 1024,
      bytesReceived: 2048,
      rawStatus: [],
    })
    mocks.dbGetProcessListMock.mockResolvedValue([
      {
        id: 101,
        user: 'root',
        host: '127.0.0.1:3306',
        db: 'demo',
        command: 'Query',
        time: 1,
        state: 'running',
        info: 'select 1',
      },
    ])
    mocks.dbGetServerVariablesMock.mockResolvedValue([
      { name: 'max_connections', value: '151' },
    ])
  })

  it('dashboard 子标签只触发服务器状态加载', async () => {
    const wrapper = mountDashboard('dashboard')
    await flushPromises()

    expect(mocks.dbGetServerStatusMock).toHaveBeenCalledTimes(1)
    expect(mocks.dbGetProcessListMock).not.toHaveBeenCalled()
    expect(mocks.dbGetServerVariablesMock).not.toHaveBeenCalled()
    expect(wrapper.html()).toContain('Auto Sync On')
    expect(wrapper.html()).toContain('每秒查询')

    wrapper.unmount()
  })

  it('processes 子标签只触发进程列表加载且不串到变量区', async () => {
    let resolveProcesses: ((value: unknown[]) => void) | null = null
    mocks.dbGetProcessListMock.mockImplementation(() => new Promise(resolve => {
      resolveProcesses = resolve
    }))

    const wrapper = mountDashboard('processes')
    await flushPromises()

    expect(mocks.dbGetProcessListMock).toHaveBeenCalledTimes(1)
    expect(mocks.dbGetServerStatusMock).not.toHaveBeenCalled()
    expect(mocks.dbGetServerVariablesMock).not.toHaveBeenCalled()
    expect(wrapper.html()).toContain('采集数据中')
    expect(wrapper.html()).not.toContain('Loading Variables...')

    resolveProcesses?.([])
    await flushPromises()

    expect(wrapper.html()).toContain('Auto Sync On')

    wrapper.unmount()
  })

  it('variables 子标签只触发变量加载且不启动轮询', async () => {
    vi.useFakeTimers()

    const wrapper = mountDashboard('variables')
    await flushPromises()

    expect(mocks.dbGetServerVariablesMock).toHaveBeenCalledTimes(1)
    expect(mocks.dbGetProcessListMock).not.toHaveBeenCalled()
    expect(mocks.dbGetServerStatusMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(15000)
    await flushPromises()

    expect(mocks.dbGetServerVariablesMock).toHaveBeenCalledTimes(1)
    expect(wrapper.html()).toContain('max_connections')

    wrapper.unmount()
    vi.useRealTimers()
  })

  it('切换子标签后只启动对应分区加载', async () => {
    const wrapper = mountDashboard('dashboard')
    const workspaceStore = useDatabaseWorkspaceStore()
    await flushPromises()

    expect(mocks.dbGetServerStatusMock).toHaveBeenCalledTimes(1)

    workspaceStore.updateTabContext('conn-1', 'perf-1', { activeSubTab: 'processes' })
    await flushPromises()

    expect(mocks.dbGetProcessListMock).toHaveBeenCalledTimes(1)
    expect(mocks.dbGetServerVariablesMock).not.toHaveBeenCalled()

    workspaceStore.updateTabContext('conn-1', 'perf-1', { activeSubTab: 'variables' })
    await flushPromises()

    expect(mocks.dbGetServerVariablesMock).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('processes 加载失败时只提示进程区错误，不污染 dashboard 错误态', async () => {
    mocks.dbGetProcessListMock.mockRejectedValueOnce(new Error('process boom'))

    const wrapper = mountDashboard('processes')
    await flushPromises()

    expect(mocks.messageErrorMock).toHaveBeenCalledWith('获取进程列表失败: Error: process boom')
    expect(wrapper.html()).not.toContain('process boom')
    expect(wrapper.html()).not.toContain('Loading Variables...')
    expect(mocks.dbGetServerStatusMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('variables 加载失败时只提示变量区错误，不污染其他分区', async () => {
    mocks.dbGetServerVariablesMock.mockRejectedValueOnce(new Error('variables boom'))

    const wrapper = mountDashboard('variables')
    await flushPromises()

    expect(mocks.messageErrorMock).toHaveBeenCalledWith('获取变量失败: Error: variables boom')
    expect(wrapper.html()).not.toContain('variables boom')
    expect(wrapper.html()).not.toContain('正在获取服务器状态...')
    expect(mocks.dbGetProcessListMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('dashboard 加载失败时只写入 dashboard 错误区，不走 message 提示', async () => {
    mocks.dbGetServerStatusMock.mockRejectedValueOnce(new Error('status boom'))

    const wrapper = mountDashboard('dashboard')
    await flushPromises()

    expect(wrapper.html()).toContain('Error: status boom')
    expect(mocks.messageErrorMock).not.toHaveBeenCalled()
    expect(mocks.dbGetProcessListMock).not.toHaveBeenCalled()
    expect(mocks.dbGetServerVariablesMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })
})
