import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import App from '@/App.vue'
import { invoke } from '@tauri-apps/api/core'

const {
  initSchedulerMock,
  destroyUpdaterMock,
  initUpdaterMock,
  startPerformanceMonitoringMock,
  settingsStoreMock,
  workspaceStoreMock,
  connectionStoreMock,
} = vi.hoisted(() => ({
  initSchedulerMock: vi.fn(),
  destroyUpdaterMock: vi.fn(),
  initUpdaterMock: vi.fn(),
  startPerformanceMonitoringMock: vi.fn(),
  settingsStoreMock: {
    settings: { uiFontSize: 14 },
    restoreState: vi.fn<() => Promise<boolean>>(),
    enableAutoSave: vi.fn(),
    initializeDataPath: vi.fn<() => Promise<void>>(),
  },
  workspaceStoreMock: {
    restoreState: vi.fn<() => Promise<boolean>>(),
    enableAutoSave: vi.fn(),
  },
  connectionStoreMock: {
    loadConnections: vi.fn<() => Promise<void>>(),
  },
}))

vi.mock('@/composables/useTheme', () => ({
  useTheme: () => ({
    initScheduler: initSchedulerMock,
  }),
}))

vi.mock('@/composables/useUpdater', () => ({
  useUpdater: () => ({
    initUpdater: initUpdaterMock,
    destroyUpdater: destroyUpdaterMock,
  }),
}))

vi.mock('@/composables/usePerformance', () => ({
  startPerformanceMonitoring: startPerformanceMonitoringMock,
}))

vi.mock('@/composables/useGlobalScreenshot', () => ({
  useGlobalScreenshot: vi.fn(),
  cleanupGlobalScreenshot: vi.fn(),
}))

vi.mock('@/composables/useGlobalErrorHandler', () => ({
  cleanupGlobalErrorHandler: vi.fn(),
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => settingsStoreMock,
}))

vi.mock('@/stores/workspace', () => ({
  useWorkspaceStore: () => workspaceStoreMock,
}))

vi.mock('@/stores/connections', () => ({
  useConnectionStore: () => connectionStoreMock,
}))

vi.mock('@/components/layout/UpdateNotification.vue', () => ({
  default: {
    name: 'UpdateNotification',
    template: '<div data-test="update-notification" />',
  },
}))

describe('App 启动流程', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('不会等待状态恢复完成才显示主窗口', async () => {
    const pendingPromise = new Promise<never>(() => {})

    settingsStoreMock.restoreState.mockReturnValue(pendingPromise)
    settingsStoreMock.initializeDataPath.mockResolvedValue()
    workspaceStoreMock.restoreState.mockResolvedValue(true)
    connectionStoreMock.loadConnections.mockResolvedValue()
    vi.mocked(invoke).mockResolvedValue(undefined)

    mount(App, {
      global: {
        stubs: {
          RouterView: { template: '<div data-test="router-view" />' },
        },
      },
    })

    await flushPromises()
    await vi.runAllTimersAsync()

    expect(invoke).toHaveBeenCalledWith('show_main_window')
    expect(settingsStoreMock.initializeDataPath).not.toHaveBeenCalled()
    expect(connectionStoreMock.loadConnections).not.toHaveBeenCalled()
    expect(workspaceStoreMock.restoreState).not.toHaveBeenCalled()
  })

  it('显示主窗口失败时会记录错误日志', async () => {
    const showWindowError = new Error('show window failed')

    settingsStoreMock.restoreState.mockResolvedValue(true)
    settingsStoreMock.initializeDataPath.mockResolvedValue()
    workspaceStoreMock.restoreState.mockResolvedValue(true)
    connectionStoreMock.loadConnections.mockResolvedValue()
    vi.mocked(invoke).mockRejectedValue(showWindowError)

    mount(App, {
      global: {
        stubs: {
          RouterView: { template: '<div data-test="router-view" />' },
        },
      },
    })

    await flushPromises()
    await vi.runAllTimersAsync()

    expect(invoke).toHaveBeenCalledWith('show_main_window')
    expect(console.error).toHaveBeenCalledWith('[app.startup] show_main_window_failed', showWindowError)
  })
})

