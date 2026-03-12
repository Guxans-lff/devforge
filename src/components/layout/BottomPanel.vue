<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTransferStore } from '@/stores/transfer'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import TransferQueue from '@/components/file-manager/TransferQueue.vue'
import TransferHistory from '@/components/file-manager/TransferHistory.vue'
import LogPanel from '@/components/layout/LogPanel.vue'
import QueryHistoryPanel from '@/components/database/QueryHistoryPanel.vue'
import { useLogStore } from '@/stores/log'
import { onMounted } from 'vue'
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
const logStore = useLogStore()

onMounted(() => {
  logStore.info('SYSTEM', t('log.systemInit'))
})

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
    <!-- Panel Header / Status Bar (Masterpiece Dashboard Style) -->
    <div 
      class="flex h-9 shrink-0 items-center justify-between border-b border-border/10 px-4 transition-colors bg-background/95 backdrop-blur-md font-medium z-10"
    >
      <div class="flex h-full items-center gap-4">
        <!-- 极进化灵动切换器 -->
        <div class="flex h-6 items-center rounded-full bg-muted/20 p-0.5 border border-muted/30 shadow-inner">
          <button
            v-for="tab in panelTabs"
            :key="tab.id"
            class="relative flex h-full items-center gap-2 rounded-full px-3.5 text-[10px] font-black transition-all duration-300 uppercase tracking-tight group"
            :class="[
              workspace.panelState.bottomPanelTab === tab.id && !workspace.panelState.bottomPanelCollapsed
                ? 'bg-background text-primary shadow-[0_2px_8px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.03] dark:ring-white/[0.03]'
                : 'text-muted-foreground/40 hover:text-foreground/80 hover:bg-muted/10',
            ]"
            @click="workspace.setBottomPanelTab(tab.id); if(workspace.panelState.bottomPanelCollapsed) workspace.toggleBottomPanel()"
          >
            <component 
              :is="tab.icon" 
              class="h-3 w-3 transition-transform group-active:scale-90" 
              :class="{ 'animate-pulse text-primary': tab.id === 'transfer' && activeTransferCount > 0 }"
            />
            <span v-if="!workspace.panelState.bottomPanelCollapsed" class="whitespace-nowrap">{{ t(tab.labelKey) }}</span>
            
            <!-- 传输任务数字气泡 -->
            <span
              v-if="tab.id === 'transfer' && activeTransferCount > 0"
              class="ml-1 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-primary/20 px-1 text-[8px] font-black text-primary border border-primary/20"
            >
              {{ activeTransferCount }}
            </span>
          </button>
        </div>

        <!-- 极细分割线 -->
        <div class="h-3 w-[1px] bg-border/40 mx-0.5"></div>

        <!-- 旗舰仪表级状态指示 -->
        <div class="flex items-center gap-4">
           <div class="flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-emerald-500/5 border border-emerald-500/10 text-emerald-500/90 transition-all hover:bg-emerald-500/10 cursor-default group">
             <div class="relative flex items-center justify-center">
               <div class="h-1 w-1 rounded-full bg-current shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
               <div class="absolute inset-[-4px] animate-ping rounded-full bg-current opacity-20"></div>
             </div>
             <span class="font-black tracking-[0.1em] text-[9px] uppercase">{{ t('bottomPanel.ready') }}</span>
           </div>

           <!-- 活跃传输指示器 -->
           <div v-if="activeTransferCount > 0" class="flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-primary/5 border border-primary/10 text-primary/90 animate-in fade-in zoom-in-95 duration-500">
             <div class="relative">
               <ArrowUpDown class="h-3 w-3 animate-bounce" style="animation-duration: 2.5s;" />
             </div>
             <div class="flex items-center gap-1">
               <span class="font-black tabular-nums text-[10px]">{{ activeTransferCount }}</span>
               <span class="opacity-40 text-[8px] font-black uppercase tracking-widest">{{ t('transfer.tasks') }}</span>
             </div>
           </div>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <!-- 面板功能操作 (后续可扩展) -->
        
        <!-- 大师级折叠控制 -->
        <button
          class="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground/30 transition-all hover:bg-muted/40 hover:text-foreground active:scale-[0.85] border border-transparent hover:border-muted/30"
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
      <LogPanel v-else-if="workspace.panelState.bottomPanelTab === 'log'" />

      <!-- Transfer Tab -->
      <TransferQueue v-else-if="workspace.panelState.bottomPanelTab === 'transfer'" />

      <!-- History Tab -->
      <TransferHistory v-else-if="workspace.panelState.bottomPanelTab === 'history'" />
    </div>
  </div>
</template>
