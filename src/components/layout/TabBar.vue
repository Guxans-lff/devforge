<script setup lang="ts">
import { useWorkspaceStore } from '@/stores/workspace'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Database,
  Terminal,
  FolderOpen,
  Settings,
  Home,
  X,
} from 'lucide-vue-next'
import type { TabType } from '@/types/workspace'

const workspace = useWorkspaceStore()

const iconMap: Record<TabType, typeof Database> = {
  database: Database,
  terminal: Terminal,
  'file-manager': FolderOpen,
  settings: Settings,
  welcome: Home,
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
  <div class="flex h-9 items-center border-b border-border bg-background">
    <ScrollArea orientation="horizontal" class="flex-1">
      <div class="flex h-9 items-center">
        <button
          v-for="tab in workspace.tabs"
          :key="tab.id"
          class="group relative flex h-full items-center gap-1.5 border-r border-border px-3 text-xs transition-colors duration-[var(--df-duration-fast)]"
          :class="[
            workspace.activeTabId === tab.id
              ? 'bg-background text-foreground'
              : 'bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          ]"
          @click="workspace.setActiveTab(tab.id)"
          @mousedown="handleMiddleClick($event, tab.id)"
        >
          <!-- Active indicator -->
          <div
            v-if="workspace.activeTabId === tab.id"
            class="absolute inset-x-0 top-0 h-[2px] bg-primary"
          />

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
      </div>
    </ScrollArea>
  </div>
</template>
