<script setup lang="ts">
import { computed } from 'vue'
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
  Search,
  Command,
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
</script>

<template>
  <div class="relative flex h-10 items-center border-b border-border/40 bg-background/60 backdrop-blur-md">
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
              >
                <!-- Active indicator handled by before pseudo-element -->

                <component :is="getTabIcon(tab.type)" class="h-3.5 w-3.5 shrink-0" />
                <span class="max-w-[120px] truncate">{{ tab.title }}</span>

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
      <!-- 快捷搜索/命令面板触发器 -->
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex h-7 items-center gap-2 rounded-md bg-muted/30 px-2 text-muted-foreground/60 transition-all hover:bg-muted/50 hover:text-foreground/80 active:scale-95"
              @click="workspace.toggleCommandPalette()"
            >
              <Search class="h-3.5 w-3.5" />
              <div class="flex items-center gap-0.5 text-[10px] font-bold opacity-60">
                 <Command class="h-2.5 w-2.5" />
                 <span>K</span>
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="text-[11px] font-medium">{{ t('command.palette') }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

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
</template>
