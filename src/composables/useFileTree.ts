import { ref, computed, type Ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useAdaptiveOverscan } from '@/composables/useAdaptiveOverscan'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import type { FileNode } from '@/types/workspace-files'

export function useFileTree(scrollContainerRef: Ref<HTMLElement | null>) {
  const store = useWorkspaceFilesStore()
  const focusedIndex = ref(-1)
  const selectedNodeId = ref<string | null>(null)

  // ─── 虚拟滚动 ───
  const { overscan, attach } = useAdaptiveOverscan(scrollContainerRef, {
    baseOverscan: 20,
    maxOverscan: 60,
    rowHeight: 28,
    velocityThreshold: 15,
    decayDelay: 300,
  })

  const virtualizer = useVirtualizer(computed(() => ({
    count: store.flatNodes.length,
    getScrollElement: () => scrollContainerRef.value,
    estimateSize: (index: number) => store.flatNodes[index]?.isRootHeader ? 32 : 28,
    overscan: overscan.value,
  })))

  const virtualItems = computed(() => virtualizer.value.getVirtualItems())
  const totalSize = computed(() => virtualizer.value.getTotalSize())

  // ─── 键盘导航 ───
  function handleKeyDown(e: KeyboardEvent): void {
    const nodes = store.flatNodes
    if (nodes.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusedIndex.value = Math.min(focusedIndex.value + 1, nodes.length - 1)
        selectedNodeId.value = nodes[focusedIndex.value]?.id ?? null
        virtualizer.value.scrollToIndex(focusedIndex.value)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusedIndex.value = Math.max(focusedIndex.value - 1, 0)
        selectedNodeId.value = nodes[focusedIndex.value]?.id ?? null
        virtualizer.value.scrollToIndex(focusedIndex.value)
        break
      case 'ArrowRight':
        e.preventDefault()
        {
          const node = nodes[focusedIndex.value]
          if (node?.isDirectory && !store.expandedDirs.has(node.id)) {
            store.expandDir(node.id)
          }
        }
        break
      case 'ArrowLeft':
        e.preventDefault()
        {
          const node = nodes[focusedIndex.value]
          if (node?.isDirectory && store.expandedDirs.has(node.id)) {
            store.collapseDir(node.id)
          }
        }
        break
      case 'Enter':
        e.preventDefault()
        {
          const node = nodes[focusedIndex.value]
          if (node?.isDirectory) {
            store.toggleDir(node.id)
          }
        }
        break
      case 'F2':
        e.preventDefault()
        if (selectedNodeId.value) {
          store.renamingNodeId = selectedNodeId.value
        }
        break
      case 'Delete':
        e.preventDefault()
        {
          const node = nodes[focusedIndex.value]
          if (node) {
            store.deleteEntry(node.absolutePath)
          }
        }
        break
    }
  }

  // ─── 拖拽 ───
  const dragOverNodeId = ref<string | null>(null)
  let dragExpandTimer: ReturnType<typeof setTimeout> | null = null

  function handleDragStart(e: DragEvent, node: FileNode): void {
    e.dataTransfer?.setData('application/x-devforge-file', JSON.stringify({
      id: node.id,
      absolutePath: node.absolutePath,
      isDirectory: node.isDirectory,
    }))
    e.dataTransfer!.effectAllowed = 'move'
  }

  function handleDragOver(e: DragEvent, node: FileNode): void {
    if (!node.isDirectory) return
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'

    if (dragOverNodeId.value !== node.id) {
      dragOverNodeId.value = node.id
      if (dragExpandTimer) clearTimeout(dragExpandTimer)
      dragExpandTimer = setTimeout(() => {
        if (!store.expandedDirs.has(node.id)) {
          store.expandDir(node.id)
        }
      }, 600)
    }
  }

  function handleDragLeave(): void {
    dragOverNodeId.value = null
    if (dragExpandTimer) {
      clearTimeout(dragExpandTimer)
      dragExpandTimer = null
    }
  }

  function handleDrop(e: DragEvent, targetNode: FileNode): void {
    e.preventDefault()
    dragOverNodeId.value = null
    if (dragExpandTimer) clearTimeout(dragExpandTimer)

    const data = e.dataTransfer?.getData('application/x-devforge-file')
    if (!data || !targetNode.isDirectory) return

    const source = JSON.parse(data)
    if (source.absolutePath === targetNode.absolutePath) return
    store.moveEntry(source.absolutePath, targetNode.absolutePath)
  }

  return {
    virtualizer,
    virtualItems,
    totalSize,
    attachOverscan: attach,
    focusedIndex,
    selectedNodeId,
    handleKeyDown,
    dragOverNodeId,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}
