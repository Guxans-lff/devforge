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
    class="flex flex-col border-t border-border bg-background transition-all duration-300 ease-out-expo"
    :style="{
      height: workspace.panelState.bottomPanelCollapsed
        ? '28px'
        : `${workspace.panelState.bottomPanelHeight}px`,
    }"
  >
    <!-- Panel Header / Status Bar (Sharp Visuals) -->
    <div 
      class="flex h-8 shrink-0 items-center justify-between border-b border-border/10 px-3 transition-colors bg-muted/5 font-medium"
    >
      <div class="flex h-full items-center gap-3">
        <!-- 极简化药丸切换器 -->
        <div class="flex h-6 items-center rounded-full bg-muted/30 p-0.5 border border-border/20 shadow-inner">
          <button
            v-for="tab in panelTabs"
            :key="tab.id"
            class="relative flex h-full items-center gap-2 rounded-full px-3 text-[10px] font-semibold transition-all duration-300"
            :class="[
              workspace.panelState.bottomPanelTab === tab.id && !workspace.panelState.bottomPanelCollapsed
                ? 'bg-background text-primary shadow-[0_1px_3px_rgba(0,0,0,0.1)] ring-1 ring-black/5 dark:ring-white/5'
                : 'text-muted-foreground/50 hover:text-foreground/80 hover:bg-muted/10',
            ]"
            @click="workspace.setBottomPanelTab(tab.id); if(workspace.panelState.bottomPanelCollapsed) workspace.toggleBottomPanel()"
          >
            <component 
              :is="tab.icon" 
              class="h-3 w-3" 
              :class="{ 'animate-pulse text-primary': tab.id === 'transfer' && activeTransferCount > 0 }"
            />
            <span v-if="!workspace.panelState.bottomPanelCollapsed" class="whitespace-nowrap uppercase tracking-tighter">{{ t(tab.labelKey) }}</span>
            <span
              v-if="tab.id === 'transfer' && activeTransferCount > 0"
              class="inline-flex h-3 min-w-3 items-center justify-center rounded-full bg-primary/20 px-1 text-[8px] font-bold text-primary"
            >
              {{ activeTransferCount }}
            </span>
          </button>
        </div>

        <!-- 垂直分割线 -->
        <div class="h-3 w-px bg-border/20 mx-1"></div>

        <!-- 工业级状态指示 -->
        <div class="flex items-center gap-4 text-[10px] font-medium tracking-tight">
           <div class="flex items-center gap-2 px-2 py-0.5 rounded-md bg-emerald-500/5 border border-emerald-500/10 text-emerald-500/80 transition-all hover:bg-emerald-500/10 active:scale-95 cursor-default group">
             <div class="relative h-1 w-1 rounded-full bg-current">
               <div class="absolute inset-0 animate-ping rounded-full bg-current opacity-40"></div>
             </div>
             <span class="uppercase font-bold tracking-widest text-[9px]">{{ t('bottomPanel.ready') }}</span>
           </div>

           <div v-if="activeTransferCount > 0" class="flex items-center gap-2 px-2 py-0.5 rounded-md bg-primary/5 border border-primary/10 text-primary/80 animate-in fade-in slide-in-from-left-2 duration-300">
             <ArrowUpDown class="h-3 w-3 animate-bounce opacity-80" style="animation-duration: 2s;" />
             <span class="font-bold tabular-nums text-[10px]">{{ activeTransferCount }}</span>
             <span class="opacity-60 text-[9px] uppercase tracking-wider text-xs">{{ t('transfer.tasks') }}</span>
           </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <!-- 侧边折叠控制 -->
        <button
          class="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/30 transition-all hover:bg-muted/30 hover:text-foreground active:scale-90"
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
