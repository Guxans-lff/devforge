import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FileNode, WorkspaceRoot } from '@/types/workspace-files'
import FileTreeRow from '@/components/layout/panels/files/FileTreeRow.vue'
import WorkspaceRootHeader from '@/components/layout/panels/files/WorkspaceRootHeader.vue'

function createNode(overrides: Partial<FileNode> = {}): FileNode {
  return {
    id: 'root:src',
    rootId: 'root',
    name: 'src',
    path: 'src',
    absolutePath: 'D:/Project/devforge/src',
    depth: 1,
    isDirectory: true,
    isExpanded: false,
    isLoading: false,
    isCompressed: false,
    ...overrides,
  }
}

function createRoot(overrides: Partial<WorkspaceRoot> = {}): WorkspaceRoot {
  return {
    id: 'root',
    path: 'D:/Project/devforge',
    name: 'devforge',
    collapsed: false,
    sortOrder: 0,
    ...overrides,
  }
}

describe('file tree context styling', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('does not render context badge text for parent directories', () => {
    const wrapper = mount(FileTreeRow, {
      props: {
        node: createNode(),
        focused: false,
        selected: false,
        dragOver: false,
        focusedTaskParent: true,
      },
      global: {
        stubs: {
          ChevronRight: true,
          Folder: true,
          FolderOpen: true,
          FileTreeRenameInput: true,
        },
      },
    })

    expect(wrapper.text()).toContain('src')
    expect(wrapper.text()).not.toContain('路径')
    expect(wrapper.text()).not.toContain('当前')
    expect(wrapper.text()).not.toContain('相关')
  })

  it('does not render context badge text for referenced leaf files', () => {
    const wrapper = mount(FileTreeRow, {
      props: {
        node: createNode({
          id: 'root:src/main.ts',
          name: 'main.ts',
          path: 'src/main.ts',
          absolutePath: 'D:/Project/devforge/src/main.ts',
          isDirectory: false,
        }),
        focused: false,
        selected: false,
        dragOver: false,
        taskReferenced: true,
      },
      global: {
        stubs: {
          ChevronRight: true,
          Folder: true,
          FolderOpen: true,
          FileTreeRenameInput: true,
        },
      },
    })

    expect(wrapper.text()).toContain('main.ts')
    expect(wrapper.text()).not.toContain('路径')
    expect(wrapper.text()).not.toContain('当前')
    expect(wrapper.text()).not.toContain('相关')
  })

  it('does not render context badge text for current leaf files', () => {
    const wrapper = mount(FileTreeRow, {
      props: {
        node: createNode({
          id: 'root:src/App.vue',
          name: 'App.vue',
          path: 'src/App.vue',
          absolutePath: 'D:/Project/devforge/src/App.vue',
          isDirectory: false,
        }),
        focused: false,
        selected: false,
        dragOver: false,
        focusedTask: true,
      },
      global: {
        stubs: {
          ChevronRight: true,
          Folder: true,
          FolderOpen: true,
          FileTreeRenameInput: true,
        },
      },
    })

    expect(wrapper.text()).toContain('App.vue')
    expect(wrapper.text()).not.toContain('路径')
    expect(wrapper.text()).not.toContain('当前')
    expect(wrapper.text()).not.toContain('相关')
  })

  it('does not render context badge text for referenced directories', () => {
    const wrapper = mount(FileTreeRow, {
      props: {
        node: createNode(),
        focused: false,
        selected: false,
        dragOver: false,
        taskReferenced: true,
      },
      global: {
        stubs: {
          ChevronRight: true,
          Folder: true,
          FolderOpen: true,
          FileTreeRenameInput: true,
        },
      },
    })

    expect(wrapper.text()).toContain('src')
    expect(wrapper.text()).not.toContain('路径')
    expect(wrapper.text()).not.toContain('当前')
    expect(wrapper.text()).not.toContain('相关')
  })

  it('does not render context badge text on path-only workspace roots', () => {
    const wrapper = mount(WorkspaceRootHeader, {
      props: {
        root: createRoot(),
        pathActive: true,
      },
      global: {
        stubs: {
          ChevronRight: true,
          FolderOpen: true,
          X: true,
          RefreshCw: true,
        },
      },
    })

    expect(wrapper.text()).toContain('devforge')
    expect(wrapper.text()).not.toContain('路径')
    expect(wrapper.text()).not.toContain('当前')
    expect(wrapper.text()).not.toContain('相关')
  })

  it('does not render context badge text on active workspace roots', () => {
    const wrapper = mount(WorkspaceRootHeader, {
      props: {
        root: createRoot(),
        focusedActive: true,
      },
      global: {
        stubs: {
          ChevronRight: true,
          FolderOpen: true,
          X: true,
          RefreshCw: true,
        },
      },
    })

    expect(wrapper.text()).toContain('devforge')
    expect(wrapper.text()).not.toContain('路径')
    expect(wrapper.text()).not.toContain('当前')
    expect(wrapper.text()).not.toContain('相关')
  })
})
