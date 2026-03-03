<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTransferStore } from '@/stores/transfer'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import TransferQueue from '@/components/file-manager/TransferQueue.vue'
import TransferHistory from '@/components/file-manager/TransferHistory.vue'
import QueryHistoryPanel from '@/components/database/QueryHistoryPanel.vue'
import {
  ChevronDown,
  ChevronUp,
  Clock,
  ScrollText,
  ArrowUpDown,
  History,
} from 'lucide-vue-next'

const { t } = useI18n()
const workspace = useWorkspaceStore()
const transferStore = useTransferStore()

const activeTransferCount = computed(() => {
  let count = 0
  for (const task of transferStore.tasks.values()) {
    if (task.status === 'pending' || task.status === 'transferring') {
      count++
    }
  }
  return count
})

const panelTabs = [
  { id: 'query-history' as const, labelKey: 'bottomPanel.queryHistory', icon: Clock },
  { id: 'log' as const, labelKey: 'bottomPanel.log', icon: ScrollText },
  { id: 'transfer' as const, labelKey: 'bottomPanel.transfer', icon: ArrowUpDown },
  { id: 'history' as const, labelKey: 'bottomPanel.history', icon: History },
]
</script>

<template>
  <div
    class="flex flex-col border-t border-border/20 bg-background/80 backdrop-blur-xl transition-all duration-300 ease-out-expo"
    :style="{
      height: workspace.panelState.bottomPanelCollapsed
        ? '28px'
        : `${workspace.panelState.bottomPanelHeight}px`,
    }"
  >
    <!-- Panel Header / Status Bar -->
    <div 
      class="flex h-7 shrink-0 items-center justify-between border-b border-border/10 px-2 transition-colors"
      :class="workspace.panelState.bottomPanelCollapsed ? 'bg-transparent' : 'bg-muted/10'"
    >
      <div class="flex h-full items-center gap-1.5">
        <!-- 药丸切换器 -->
        <div class="flex h-[22px] items-center rounded-lg bg-muted/20 p-0.5 ring-1 ring-border/5">
          <button
            v-for="tab in panelTabs"
            :key="tab.id"
            class="relative flex h-full items-center gap-1.5 rounded-[6px] px-2 text-[11px] font-medium transition-all"
            :class="[
              workspace.panelState.bottomPanelTab === tab.id && !workspace.panelState.bottomPanelCollapsed
                ? 'bg-background text-primary shadow-sm ring-1 ring-black/5 dark:ring-white/5'
                : 'text-muted-foreground/60 hover:text-foreground/80 hover:bg-muted/10',
            ]"
            @click="workspace.setBottomPanelTab(tab.id); if(workspace.panelState.bottomPanelCollapsed) workspace.toggleBottomPanel()"
          >
            <component 
              :is="tab.icon" 
              class="h-3 w-3" 
              :class="{ 'animate-pulse text-primary': tab.id === 'transfer' && activeTransferCount > 0 }"
            />
            <span v-if="!workspace.panelState.bottomPanelCollapsed" class="whitespace-nowrap">{{ t(tab.labelKey) }}</span>
            <span
              v-if="tab.id === 'transfer' && activeTransferCount > 0"
              class="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary/20 px-1 text-[9px] font-bold text-primary"
            >
              {{ activeTransferCount }}
            </span>
          </button>
        </div>

        <!-- 垂直分割线 -->
        <div class="h-3 w-[1px] bg-border/20 mx-1"></div>

        <!-- 状态简讯 (仅折叠时或重点显示) -->
        <div class="flex items-center gap-3 text-[11px] font-medium text-muted-foreground/50 transition-all duration-500">
           <div class="flex items-center gap-1.5">
             <div class="relative h-1.5 w-1.5 rounded-full bg-emerald-500">
               <div class="absolute inset-0 animate-ping rounded-full bg-emerald-500 opacity-30"></div>
             </div>
             <span>{{ t('bottomPanel.ready') }}</span>
           </div>
           <span v-if="activeTransferCount > 0" class="flex items-center gap-1 text-primary/70 animate-in fade-in slide-in-from-left-2 duration-300">
             <ArrowUpDown class="h-3 w-3 animate-bounce" style="animation-duration: 2s;" />
             {{ activeTransferCount }} {{ t('transfer.tasks') }}
           </span>
        </div>
      </div>

      <div class="flex items-center gap-1">
        <button
          class="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/40 transition-all hover:bg-muted/30 hover:text-foreground active:scale-90"
          @click="workspace.toggleBottomPanel()"
        >
          <ChevronDown
            v-if="!workspace.panelState.bottomPanelCollapsed"
            class="h-3.5 w-3.5"
          />
          <ChevronUp v-else class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <!-- Panel Content -->
    <div v-if="!workspace.panelState.bottomPanelCollapsed" class="flex-1 overflow-hidden">
      <!-- Query History Tab -->
      <QueryHistoryPanel v-if="workspace.panelState.bottomPanelTab === 'query-history'" />

      <!-- Log Tab -->
      <ScrollArea v-else-if="workspace.panelState.bottomPanelTab === 'log'" class="h-full">
        <div class="p-2 font-mono text-xs text-muted-foreground">
          <p>{{ t('bottomPanel.noLog') }}</p>
        </div>
      </ScrollArea>

      <!-- Transfer Tab -->
      <TransferQueue v-else-if="workspace.panelState.bottomPanelTab === 'transfer'" />

      <!-- History Tab -->
      <TransferHistory v-else-if="workspace.panelState.bottomPanelTab === 'history'" />
    </div>
  </div>
</template>
