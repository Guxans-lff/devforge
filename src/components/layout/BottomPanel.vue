<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTransferStore } from '@/stores/transfer'
import { useSettingsStore } from '@/stores/settings'
import TransferQueue from '@/components/file-manager/TransferQueue.vue'
import TransferHistory from '@/components/file-manager/TransferHistory.vue'
import LogPanel from '@/components/layout/LogPanel.vue'
import DevPanel from '@/components/layout/DevPanel.vue'
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
  Bug,
} from 'lucide-vue-next'

const { t } = useI18n()
const workspace = useWorkspaceStore()
const transferStore = useTransferStore()
const logStore = useLogStore()
const settingsStore = useSettingsStore()

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

const baseTabs = [
  { id: 'query-history' as const, labelKey: 'bottomPanel.queryHistory', icon: Clock },
  { id: 'log' as const, labelKey: 'bottomPanel.log', icon: ScrollText },
  { id: 'transfer' as const, labelKey: 'bottomPanel.transfer', icon: ArrowUpDown },
  { id: 'history' as const, labelKey: 'bottomPanel.history', icon: History },
]

const panelTabs = computed(() => {
  if (settingsStore.settings.devMode) {
    return [...baseTabs, { id: 'dev' as const, labelKey: 'bottomPanel.devTools', icon: Bug }]
  }
  return baseTabs
})
</script>

<template>
  <div
    class="flex flex-col border-t border-border bg-background transition-[height] duration-300 ease-out-expo"
    :style="{
      height: workspace.panelState.bottomPanelCollapsed
        ? '36px'
        : `${workspace.panelState.bottomPanelHeight}px`,
    }"
  >
    <!-- Panel Header / Status Bar (Masterpiece Dashboard Style) -->
    <div 
      class="flex h-9 shrink-0 items-center justify-between border-b border-border/10 px-4 transition-colors bg-background/95 backdrop-blur-md font-medium z-10"
    >
      <div class="flex h-full items-center gap-4">
        <!-- Tab 切换器 — role="tablist" + aria-selected -->
        <div role="tablist" class="flex h-6 items-center rounded-full bg-muted/20 p-0.5 border border-muted/30 shadow-inner">
          <button
            v-for="tab in panelTabs"
            :key="tab.id"
            role="tab"
            :aria-selected="workspace.panelState.bottomPanelTab === tab.id && !workspace.panelState.bottomPanelCollapsed"
            :aria-controls="`bottom-tabpanel-${tab.id}`"
            :id="`bottom-tab-${tab.id}`"
            class="relative flex h-full items-center gap-2 rounded-full px-3.5 text-[10px] font-black transition-[background-color,color,box-shadow] duration-300 uppercase tracking-tight group outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

        <!-- 活跃传输指示器 -->
        <div v-if="activeTransferCount > 0" class="flex items-center gap-4">
          <div class="h-3 w-[1px] bg-border/40 mx-0.5"></div>
          <div class="flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-primary/5 border border-primary/10 text-primary/90 animate-in fade-in zoom-in-95 duration-500">
             <div class="relative">
               <ArrowUpDown class="h-3 w-3 animate-pulse" style="animation-duration: 2.5s;" />
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
          :aria-label="workspace.panelState.bottomPanelCollapsed ? t('bottomPanel.expand') : t('bottomPanel.collapse')"
          class="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground/30 transition-[background-color,color,border-color] hover:bg-muted/40 hover:text-foreground active:scale-[0.85] border border-transparent hover:border-muted/30 outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
    <div
      v-if="!workspace.panelState.bottomPanelCollapsed"
      :id="`bottom-tabpanel-${workspace.panelState.bottomPanelTab}`"
      role="tabpanel"
      :aria-labelledby="`bottom-tab-${workspace.panelState.bottomPanelTab}`"
      class="flex-1 overflow-hidden"
    >
      <!-- Query History Tab -->
      <QueryHistoryPanel v-if="workspace.panelState.bottomPanelTab === 'query-history'" />

      <!-- Log Tab -->
      <LogPanel v-else-if="workspace.panelState.bottomPanelTab === 'log'" />

      <!-- Transfer Tab -->
      <TransferQueue v-else-if="workspace.panelState.bottomPanelTab === 'transfer'" />

      <!-- History Tab -->
      <TransferHistory v-else-if="workspace.panelState.bottomPanelTab === 'history'" />

      <!-- Dev Tools Tab -->
      <DevPanel v-else-if="workspace.panelState.bottomPanelTab === 'dev'" />
    </div>
  </div>
</template>
