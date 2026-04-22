import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestPinia } from '@/__tests__/helpers'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'

const closeLocalFileMock = vi.fn()
const cleanupDatabaseWorkspaceMock = vi.fn()
const updateConnectionStatusMock = vi.fn()

vi.mock('@/plugins/persistence', () => ({
  usePersistence: () => ({
    load: vi.fn().mockResolvedValue(false),
    autoSave: vi.fn(),
    saveImmediate: vi.fn(),
  }),
}))

vi.mock('@/stores/database-workspace', () => ({
  useDatabaseWorkspaceStore: () => ({
    cleanup: cleanupDatabaseWorkspaceMock,
  }),
}))

vi.mock('@/stores/connections', () => ({
  useConnectionStore: () => ({
    updateConnectionStatus: updateConnectionStatusMock,
  }),
}))

vi.mock('@/stores/transfer', () => ({
  useTransferStore: () => ({
    tasks: new Map(),
  }),
}))

vi.mock('@/stores/local-file-editor', () => ({
  useLocalFileEditorStore: () => ({
    close: closeLocalFileMock,
  }),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

describe('useWorkspaceStore editor context cleanup', () => {
  beforeEach(() => {
    setupTestPinia()
    vi.useFakeTimers()
    closeLocalFileMock.mockReset()
    cleanupDatabaseWorkspaceMock.mockReset()
    updateConnectionStatusMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('closing a file-editor tab clears pending activeEditor state immediately', async () => {
    const workspace = useWorkspaceStore()
    const wsFiles = useWorkspaceFilesStore()
    const absolutePath = 'D:/Project/devforge/settings.json'
    const tabId = `file-editor:${absolutePath}`

    workspace.addTab({
      id: tabId,
      type: 'file-editor',
      title: 'settings.json',
      closable: true,
      meta: { absolutePath },
    })

    wsFiles.setActiveEditor({
      path: absolutePath,
      language: 'json',
      cursorLine: 3,
      selectedText: '',
    })

    workspace.closeTab(tabId)

    expect(wsFiles.activeEditor).toBeNull()

    vi.advanceTimersByTime(400)

    expect(wsFiles.activeEditor).toBeNull()
    expect(workspace.tabs.some(tab => tab.id === tabId)).toBe(false)

    await vi.dynamicImportSettled()
    expect(closeLocalFileMock).toHaveBeenCalledWith(absolutePath)
  })

  it('closing another file tab does not wipe the active editor of the current file', async () => {
    const workspace = useWorkspaceStore()
    const wsFiles = useWorkspaceFilesStore()
    const oldPath = 'D:/Project/devforge/settings.json'
    const nextPath = 'D:/Project/devforge/src/views/AiChatView.vue'
    const oldTabId = `file-editor:${oldPath}`

    workspace.addTab({
      id: oldTabId,
      type: 'file-editor',
      title: 'settings.json',
      closable: true,
      meta: { absolutePath: oldPath },
    })
    workspace.addTab({
      id: `file-editor:${nextPath}`,
      type: 'file-editor',
      title: 'AiChatView.vue',
      closable: true,
      meta: { absolutePath: nextPath },
    })

    wsFiles.setActiveEditor({
      path: oldPath,
      language: 'json',
      cursorLine: 1,
      selectedText: '',
    })
    vi.advanceTimersByTime(400)

    wsFiles.setActiveEditor({
      path: nextPath,
      language: 'vue',
      cursorLine: 12,
      selectedText: '',
    })

    workspace.closeTab(oldTabId)

    expect(wsFiles.activeEditor).toBeNull()

    vi.advanceTimersByTime(400)

    expect(wsFiles.activeEditor).toMatchObject({
      path: nextPath,
      language: 'vue',
      cursorLine: 12,
    })

    await vi.dynamicImportSettled()
    expect(closeLocalFileMock).toHaveBeenCalledWith(oldPath)
  })

  it('switching away from a file-editor tab clears activeEditor immediately', () => {
    const workspace = useWorkspaceStore()
    const wsFiles = useWorkspaceFilesStore()
    const filePath = 'D:/Project/devforge/src/assets/index.css'

    workspace.addTab({
      id: `file-editor:${filePath}`,
      type: 'file-editor',
      title: 'index.css',
      closable: true,
      meta: { absolutePath: filePath },
    })
    wsFiles.setActiveEditor({
      path: filePath,
      language: 'css',
      cursorLine: 8,
      selectedText: '',
    })
    vi.advanceTimersByTime(400)

    expect(wsFiles.activeEditor?.path).toBe(filePath)

    workspace.addTab({
      id: 'ai-tab-1',
      type: 'ai-chat',
      title: '你好',
      closable: true,
      meta: { sessionId: 'session-1' },
    })

    wsFiles.clearActiveEditor(filePath)

    expect(wsFiles.activeEditor).toBeNull()
  })
})
