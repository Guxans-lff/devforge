<script setup lang="ts">
/**
 * Side Panel — 动态面板容器
 *
 * 根据 ActivityBar 选中的面板 ID，动态加载对应面板组件。
 * 支持宽度拖拽调整（200-500px），KeepAlive 保持面板状态。
 */
import { computed, ref, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { X } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import type { SidePanelId } from '@/types/workspace'

// 懒加载面板组件
const ConnectionsPanel = defineAsyncComponent(() => import('./panels/ConnectionsPanel.vue'))
const SearchPanel = defineAsyncComponent(() => import('./panels/SearchPanel.vue'))
const AiPanel = defineAsyncComponent(() => import('./panels/AiPanel.vue'))
const FilesPanel = defineAsyncComponent(() => import('./panels/FilesPanel.vue'))

const { t } = useI18n()
const workspace = useWorkspaceStore()

// 面板组件映射
const panelComponents: Record<SidePanelId, ReturnType<typeof defineAsyncComponent>> = {
  connections: ConnectionsPanel,
  files: FilesPanel,
  search: SearchPanel,
  ai: AiPanel,
}

// 面板标题映射
const panelTitles: Record<SidePanelId, string> = {
  connections: 'sidebar.connections',
  files: 'tab.files',
  search: 'sidebar.searchConnections',
  ai: 'AI',
}

const activePanelComponent = computed(() => {
  const id = workspace.panelState.activeSidePanel
  return id ? panelComponents[id] : null
})

const panelTitle = computed(() => {
  const id = workspace.panelState.activeSidePanel
  if (!id) return ''
  if (id === 'ai') return 'AI'
  return t(panelTitles[id])
})

const panelWidth = computed(() => workspace.panelState.sidePanelWidth)

// ─────────── 拖拽调整宽度 ───────────
const isResizing = ref(false)
let startX = 0
let startWidth = 0

function startResize(e: MouseEvent) {
  isResizing.value = true
  startX = e.clientX
  startWidth = workspace.panelState.sidePanelWidth
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  const delta = e.clientX - startX
  const newWidth = Math.max(200, Math.min(500, startWidth + delta))
  workspace.setSidePanelWidth(newWidth)
}

function onMouseUp() {
  isResizing.value = false
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
}

function closePanel() {
  workspace.setActiveSidePanel(null)
}

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <div
    v-if="workspace.panelState.activeSidePanel"
    class="relative flex shrink-0 flex-col overflow-hidden bg-muted/20 dark:bg-df-shell-bg"
    :style="{ width: panelWidth + 'px' }"
  >
    <!-- 面板标题栏 -->
    <div class="flex h-9 shrink-0 items-center justify-between border-b border-border/30 px-3">
      <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{{ panelTitle }}</span>
      <Button variant="ghost" size="icon" class="h-6 w-6 text-muted-foreground hover:text-foreground" @click="closePanel">
        <X class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- 动态面板内容 -->
    <div class="flex-1 overflow-hidden">
      <KeepAlive>
        <component :is="activePanelComponent" :key="workspace.panelState.activeSidePanel" />
      </KeepAlive>
    </div>

    <!-- 右侧拖拽边缘 -->
    <div
      class="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30 transition-colors"
      :class="{ 'bg-primary/40': isResizing }"
      @mousedown="startResize"
    />
  </div>
</template>
