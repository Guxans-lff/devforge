<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTransferStore } from '@/stores/transfer'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import TransferQueue from '@/components/file-manager/TransferQueue.vue'
import TransferHistory from '@/components/file-manager/TransferHistory.vue'
import {
  ChevronDown,
  ChevronUp,
  FileOutput,
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
  { id: 'output' as const, labelKey: 'bottomPanel.output', icon: FileOutput },
  { id: 'log' as const, labelKey: 'bottomPanel.log', icon: ScrollText },
  { id: 'transfer' as const, labelKey: 'bottomPanel.transfer', icon: ArrowUpDown },
  { id: 'history' as const, labelKey: 'bottomPanel.history', icon: History },
]
</script>

<template>
  <div
    class="flex flex-col border-t border-border bg-background transition-[height] duration-[var(--df-duration-normal)] ease-[var(--df-ease-out)]"
    :style="{
      height: workspace.panelState.bottomPanelCollapsed
        ? '32px'
        : `${workspace.panelState.bottomPanelHeight}px`,
    }"
  >
    <!-- Panel Header -->
    <div class="flex h-8 shrink-0 items-center justify-between border-b border-border px-2">
      <div class="flex items-center gap-0.5">
        <Button
          v-for="tab in panelTabs"
          :key="tab.id"
          variant="ghost"
          size="sm"
          class="h-6 gap-1 px-2 text-xs"
          :class="[
            workspace.panelState.bottomPanelTab === tab.id && !workspace.panelState.bottomPanelCollapsed
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground',
          ]"
          @click="workspace.setBottomPanelTab(tab.id)"
        >
          <component :is="tab.icon" class="h-3 w-3" />
          {{ t(tab.labelKey) }}
          <span
            v-if="tab.id === 'transfer' && activeTransferCount > 0"
            class="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground"
          >
            {{ activeTransferCount }}
          </span>
        </Button>
      </div>
      <Button
        variant="ghost"
        size="icon"
        class="h-5 w-5 text-muted-foreground hover:text-foreground"
        @click="workspace.toggleBottomPanel()"
      >
        <ChevronDown
          v-if="!workspace.panelState.bottomPanelCollapsed"
          class="h-3 w-3"
        />
        <ChevronUp v-else class="h-3 w-3" />
      </Button>
    </div>

    <!-- Panel Content -->
    <div v-if="!workspace.panelState.bottomPanelCollapsed" class="flex-1 overflow-hidden">
      <!-- Output Tab -->
      <ScrollArea v-if="workspace.panelState.bottomPanelTab === 'output'" class="h-full">
        <div class="p-2 font-mono text-xs text-muted-foreground">
          <p>{{ t('bottomPanel.ready') }}</p>
        </div>
      </ScrollArea>

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
