<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import TerminalPanel from '@/components/terminal/TerminalPanel.vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { FolderOpen } from 'lucide-vue-next'

const props = defineProps<{
  connectionId: string
  connectionName: string
}>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const terminalRef = ref<InstanceType<typeof TerminalPanel>>()
const terminalStatus = ref('connecting')

function onStatusChange(status: string) {
  terminalStatus.value = status
}
function openFileTransfer() {
  workspace.addTab({
    id: `file-manager-${props.connectionId}`,
    type: 'file-manager',
    title: props.connectionName,
    connectionId: props.connectionId,
    closable: true,
  })
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 border-b border-border px-3 py-1.5">
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-muted-foreground hover:text-foreground"
              @click="openFileTransfer"
            >
              <FolderOpen class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{{ t('terminal.openFileTransfer') }}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div class="flex-1" />
      <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <div
          class="h-2 w-2 rounded-full"
          :class="{
            'bg-[var(--df-success)]': terminalStatus === 'connected',
            'bg-[var(--df-warning)] animate-pulse': terminalStatus === 'connecting',
            'bg-destructive': terminalStatus === 'error',
            'bg-muted-foreground': terminalStatus === 'disconnected',
          }"
        />
        <span>{{ connectionName }}</span>
      </div>
    </div>

    <!-- Terminal -->
    <div class="flex-1 overflow-hidden">
      <TerminalPanel
        ref="terminalRef"
        :connection-id="connectionId"
        :connection-name="connectionName"
        @status-change="onStatusChange"
      />
    </div>
  </div>
</template>
