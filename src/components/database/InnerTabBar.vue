<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Play, Table2, FileUp, Database, Plus, X, GitCompareArrows } from 'lucide-vue-next'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import type { InnerTabType } from '@/types/database-workspace'

const props = defineProps<{
  connectionId: string
}>()

const { t } = useI18n()
const store = useDatabaseWorkspaceStore()

const workspace = computed(() => store.getOrCreate(props.connectionId))
const tabs = computed(() => workspace.value.tabs)
const activeTabId = computed(() => workspace.value.activeTabId)

const iconMap: Record<InnerTabType, typeof Play> = {
  'query': Play,
  'table-editor': Table2,
  'import': FileUp,
  'table-data': Database,
  'schema-compare': GitCompareArrows,
}

// 右键菜单状态
const contextMenu = ref<{ visible: boolean; x: number; y: number; tabId: string }>({
  visible: false, x: 0, y: 0, tabId: '',
})

const contextTab = computed(() => tabs.value.find((t) => t.id === contextMenu.value.tabId))

function handleClick(tabId: string) {
  store.setActiveInnerTab(props.connectionId, tabId)
}

function handleClose(e: Event, tabId: string) {
  e.stopPropagation()
  store.closeInnerTab(props.connectionId, tabId)
}

function handleMiddleClick(e: MouseEvent, tabId: string) {
  if (e.button === 1) {
    e.preventDefault()
    store.closeInnerTab(props.connectionId, tabId)
  }
}

function handleAddQuery() {
  store.addQueryTab(props.connectionId)
}

function handleContextMenu(e: MouseEvent, tabId: string) {
  e.preventDefault()
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, tabId }
}

function closeContextMenu() {
  contextMenu.value = { ...contextMenu.value, visible: false }
}

function closeCurrentTab() {
  const tabId = contextMenu.value.tabId
  closeContextMenu()
  store.closeInnerTab(props.connectionId, tabId)
}

function closeOtherTabs() {
  const tabId = contextMenu.value.tabId
  closeContextMenu()
  const closable = tabs.value.filter((t) => t.id !== tabId && t.closable)
  for (const tab of closable) {
    store.closeInnerTab(props.connectionId, tab.id)
  }
}

function closeTabsToLeft() {
  const tabId = contextMenu.value.tabId
  closeContextMenu()
  const idx = tabs.value.findIndex((t) => t.id === tabId)
  if (idx <= 0) return
  const closable = tabs.value.slice(0, idx).filter((t) => t.closable)
  for (const tab of closable) {
    store.closeInnerTab(props.connectionId, tab.id)
  }
}

function closeTabsToRight() {
  const tabId = contextMenu.value.tabId
  closeContextMenu()
  const idx = tabs.value.findIndex((t) => t.id === tabId)
  if (idx < 0) return
  const closable = tabs.value.slice(idx + 1).filter((t) => t.closable)
  for (const tab of closable) {
    store.closeInnerTab(props.connectionId, tab.id)
  }
}

function closeAllTabs() {
  closeContextMenu()
  const closable = tabs.value.filter((t) => t.closable)
  for (const tab of closable) {
    store.closeInnerTab(props.connectionId, tab.id)
  }
}
</script>

<template>
  <div class="flex h-8 items-center border-b border-border bg-muted/30" role="tablist">
    <div class="flex flex-1 items-center overflow-x-auto">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        role="tab"
        :aria-selected="tab.id === activeTabId"
        class="group flex h-8 shrink-0 items-center gap-1.5 border-r border-border px-2.5 text-[11px] transition-colors"
        :class="[
          tab.id === activeTabId
            ? 'bg-background text-foreground'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        ]"
        @click="handleClick(tab.id)"
        @mousedown="handleMiddleClick($event, tab.id)"
        @contextmenu="handleContextMenu($event, tab.id)"
      >
        <component :is="iconMap[tab.type]" class="h-3 w-3 shrink-0" />
        <span class="max-w-[120px] truncate">{{ tab.title }}</span>
        <span v-if="tab.dirty" class="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--df-warning)]" />
        <button
          v-if="tab.closable"
          class="ml-0.5 hidden h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted group-hover:flex"
          :class="{ '!flex': tab.id === activeTabId }"
          @click="handleClose($event, tab.id)"
        >
          <X class="h-3 w-3" />
        </button>
      </button>
    </div>

    <button
      class="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      title="New Query"
      @click="handleAddQuery"
    >
      <Plus class="h-3.5 w-3.5" />
    </button>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="fixed inset-0 z-50"
        @click="closeContextMenu"
        @contextmenu.prevent="closeContextMenu"
      />
      <div
        v-if="contextMenu.visible"
        class="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-md"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      >
        <button
          class="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
          :disabled="!contextTab?.closable"
          :class="{ 'opacity-40 pointer-events-none': !contextTab?.closable }"
          @click="closeCurrentTab"
        >
          {{ t('common.close') }}
        </button>
        <button
          class="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
          @click="closeOtherTabs"
        >
          {{ t('innerTab.closeOthers') }}
        </button>
        <button
          class="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
          @click="closeTabsToLeft"
        >
          {{ t('innerTab.closeLeft') }}
        </button>
        <button
          class="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
          @click="closeTabsToRight"
        >
          {{ t('innerTab.closeRight') }}
        </button>
        <div class="my-1 h-px bg-border" />
        <button
          class="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
          @click="closeAllTabs"
        >
          {{ t('innerTab.closeAll') }}
        </button>
      </div>
    </Teleport>
  </div>
</template>
