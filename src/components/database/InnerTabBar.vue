<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Play, Table2, FileUp, Database, Plus, X, GitCompareArrows, Activity, Users, Network } from 'lucide-vue-next'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import type { InnerTabType } from '@/types/database-workspace'
import type { EnvironmentType } from '@/types/environment'
import { ENV_PRESETS } from '@/types/environment'

const props = defineProps<{
  connectionId: string
  /** 连接环境类型（用于显示环境色带） */
  environment?: EnvironmentType
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
  'performance': Activity,
  'user-management': Users,
  'er-diagram': Network,
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

function reopenClosedTab() {
  closeContextMenu()
  store.reopenLastClosedTab(props.connectionId)
}
</script>

<template>
  <div>
    <!-- 环境色带 -->
    <div
      v-if="environment"
      class="h-0.5 shrink-0"
      :style="{ backgroundColor: ENV_PRESETS[environment]?.color ?? 'transparent' }"
    />
    <div class="flex h-9 items-center border-b border-border/30 bg-muted/30 px-1.5 gap-1" role="tablist">
      <div class="flex flex-1 items-center overflow-x-auto h-full scrollbar-none py-1 pr-1 gap-0.5 select-none">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          role="tab"
          :aria-selected="tab.id === activeTabId"
          class="group relative flex h-7 shrink-0 items-center gap-1.5 rounded-md px-3 text-[11px] font-medium transition-all duration-200"
          :class="[
            tab.id === activeTabId
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border/30'
              : 'text-muted-foreground/60 hover:bg-background/60 hover:text-foreground/80',
          ]"
          @click="handleClick(tab.id)"
          @mousedown="handleMiddleClick($event, tab.id)"
          @contextmenu="handleContextMenu($event, tab.id)"
        >
          <component
            :is="iconMap[tab.type]"
            class="h-3.5 w-3.5 shrink-0 transition-colors"
            :class="tab.id === activeTabId ? 'text-primary/80' : ''"
          />
          <span class="max-w-[120px] truncate tracking-tight">{{ tab.title }}</span>

          <!-- Unsaved dot -->
          <span v-if="tab.dirty" class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />

          <button
            v-if="tab.closable"
            class="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-all duration-150 opacity-0 group-hover:opacity-50 hover:bg-muted hover:!opacity-100"
            :class="{ '!opacity-40': tab.id === activeTabId }"
            @click="handleClose($event, tab.id)"
          >
            <X class="h-2.5 w-2.5" />
          </button>
        </button>
      </div>

      <button
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/40 transition-all hover:bg-muted/80 hover:text-foreground/70"
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
        <template v-if="store.getClosedTabCount(props.connectionId) > 0">
          <div class="my-1 h-px bg-border" />
          <button
            class="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
            @click="reopenClosedTab"
          >
            {{ t('innerTab.reopenClosed') }}
          </button>
        </template>
      </div>
    </Teleport>
  </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";

.scrollbar-none::-webkit-scrollbar {
  display: none;
}

.scrollbar-none {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

:deep([role="tablist"]) {
  @apply select-none;
}
</style>
