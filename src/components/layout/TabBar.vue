<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useMessageCenterStore } from '@/stores/message-center'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Database,
  Terminal,
  FolderOpen,
  Settings,
  Home,
  X,
  Bell,
  Play,
  TerminalSquare,
} from 'lucide-vue-next'
import type { TabType } from '@/types/workspace'
import MessageCenter from './MessageCenter.vue'

const workspace = useWorkspaceStore()
const messageCenter = useMessageCenterStore()
const { t } = useI18n()

const iconMap: Record<TabType, typeof Database> = {
  database: Database,
  terminal: Terminal,
  'file-manager': FolderOpen,
  settings: Settings,
  welcome: Home,
  'terminal-player': Play,
  'multi-exec': TerminalSquare,
}

function getTabIcon(type: TabType) {
  return iconMap[type] ?? Home
}

function handleMiddleClick(event: MouseEvent, tabId: string) {
  if (event.button === 1) {
    event.preventDefault()
    workspace.closeTab(tabId)
  }
}

// 右键菜单状态
const contextMenu = ref<{ visible: boolean; x: number; y: number; tabId: string }>({
  visible: false, x: 0, y: 0, tabId: '',
})

const contextTab = computed(() => workspace.tabs.find((t) => t.id === contextMenu.value.tabId))

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
  workspace.closeTab(tabId)
}

function closeOtherTabs() {
  const tabId = contextMenu.value.tabId
  closeContextMenu()
  const closable = workspace.tabs.filter((t) => t.id !== tabId && t.closable)
  for (const tab of closable) {
    workspace.closeTab(tab.id)
  }
}

function closeTabsToLeft() {
  const tabId = contextMenu.value.tabId
  closeContextMenu()
  const idx = workspace.tabs.findIndex((t) => t.id === tabId)
  if (idx <= 0) return
  const closable = workspace.tabs.slice(0, idx).filter((t) => t.closable)
  for (const tab of closable) {
    workspace.closeTab(tab.id)
  }
}

function closeTabsToRight() {
  const tabId = contextMenu.value.tabId
  closeContextMenu()
  const idx = workspace.tabs.findIndex((t) => t.id === tabId)
  if (idx < 0) return
  const closable = workspace.tabs.slice(idx + 1).filter((t) => t.closable)
  for (const tab of closable) {
    workspace.closeTab(tab.id)
  }
}

function closeAllTabs() {
  closeContextMenu()
  const closable = workspace.tabs.filter((t) => t.closable)
  for (const tab of closable) {
    workspace.closeTab(tab.id)
  }
}
</script>

<template>
  <div class="relative z-30 flex h-10 items-center border-b border-border/40 bg-background/60 backdrop-blur-md">
    <ScrollArea orientation="horizontal" class="flex-1">
      <div class="flex h-10 items-center">
        <TooltipProvider :delay-duration="500">
          <Tooltip v-for="tab in workspace.tabs" :key="tab.id">
            <TooltipTrigger as-child>
              <button
                class="group relative flex h-full items-center gap-2 border-r border-border/30 px-4 text-xs font-medium transition-all duration-200"
                :class="[
                  workspace.activeTabId === tab.id
                    ? 'bg-primary/10 text-primary shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]'
                    : 'bg-transparent text-muted-foreground/70 hover:bg-muted/30 hover:text-foreground',
                ]"
                @click="workspace.setActiveTab(tab.id)"
                @mousedown="handleMiddleClick($event, tab.id)"
                @contextmenu="handleContextMenu($event, tab.id)"
              >
                <!-- Active indicator handled by before pseudo-element -->

                <component :is="getTabIcon(tab.type)" class="h-3.5 w-3.5 shrink-0" />
                <span class="max-w-[120px] truncate">{{ tab.type === 'welcome' ? t('tab.homepage') : tab.title }}</span>

                <!-- Dirty indicator -->
                <div
                  v-if="tab.dirty"
                  class="h-1.5 w-1.5 rounded-full bg-primary"
                />

                <!-- Close button -->
                <button
                  v-if="tab.closable"
                  class="ml-1 rounded p-0.5 opacity-0 transition-opacity duration-[var(--df-duration-fast)] hover:bg-accent group-hover:opacity-100"
                  :class="{ 'opacity-100': workspace.activeTabId === tab.id }"
                  @click.stop="workspace.closeTab(tab.id)"
                >
                  <X class="h-3 w-3" />
                </button>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" class="text-xs">
              {{ tab.title }}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </ScrollArea>

    <!-- 右侧功能区 -->
    <div class="flex h-full items-center gap-1 px-2 border-l border-border/40">
      <!-- 消息中心按钮 -->
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="relative flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/60 transition-all hover:bg-primary/10 hover:text-primary active:scale-90"
              :class="{ 'bg-primary/15 text-primary': messageCenter.isOpen }"
              @click.stop="messageCenter.togglePanel()"
            >
              <Bell class="h-4 w-4" />
              <!-- 未读呼吸点 -->
              <div
                v-if="messageCenter.unreadCount > 0"
                class="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-background bg-destructive shadow-[0_0_4px_rgba(var(--color-destructive),0.5)]"
              >
                <div class="absolute inset-0 animate-ping rounded-full bg-destructive opacity-40"></div>
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="text-[11px] font-medium">{{ t('tooltip.messageCenter') }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>

    <!-- Message Center Panel -->
    <MessageCenter />
  </div>

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
</template>
