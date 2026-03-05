<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useConnectionStore } from '@/stores/connections'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import TerminalPanel from '@/components/terminal/TerminalPanelLazy.vue'
import SftpSidebar from '@/components/terminal/SftpSidebar.vue'
import CommandSnippetPanel from '@/components/terminal/CommandSnippetPanel.vue'
import RecordingIndicator from '@/components/terminal/RecordingIndicator.vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { FolderOpen, PanelRightClose, PanelRightOpen, Bookmark, Columns2, Rows2 } from 'lucide-vue-next'

const props = defineProps<{
  connectionId: string
  connectionName: string
}>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const connectionStore = useConnectionStore()
const terminalRef = ref<InstanceType<typeof TerminalPanel>>()
const terminalRef2 = ref<InstanceType<typeof TerminalPanel>>()
const sftpRef = ref<InstanceType<typeof SftpSidebar>>()
const terminalStatus1 = ref('connecting')
const terminalStatus2 = ref('connecting')
const sftpVisible = ref(false)
const snippetsVisible = ref(false)
const splitMode = ref<'none' | 'horizontal' | 'vertical'>('none')
const activePanel = ref<1 | 2>(1)

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error'

// 汇总状态：任一终端 connected 则为 connected
const terminalStatus = computed(() => {
  if (splitMode.value === 'none') return terminalStatus1.value
  if (terminalStatus1.value === 'connected' || terminalStatus2.value === 'connected') return 'connected'
  if (terminalStatus1.value === 'connecting' || terminalStatus2.value === 'connecting') return 'connecting'
  if (terminalStatus1.value === 'error' || terminalStatus2.value === 'error') return 'error'
  return 'disconnected'
})

function onStatusChange1(status: string) {
  terminalStatus1.value = status
  syncConnectionStatus()
}

function onStatusChange2(status: string) {
  terminalStatus2.value = status
  syncConnectionStatus()
}

function syncConnectionStatus() {
  const status = terminalStatus.value
  const valid: ConnectionStatus[] = ['connected', 'connecting', 'error', 'disconnected']
  if (valid.includes(status as ConnectionStatus)) {
    connectionStore.updateConnectionStatus(props.connectionId, status as ConnectionStatus)
  }
}

// 分屏模式切换时清理状态
watch(splitMode, (mode) => {
  if (mode === 'none') {
    activePanel.value = 1
    terminalStatus2.value = 'disconnected'
  }
})

onBeforeUnmount(() => {
  connectionStore.updateConnectionStatus(props.connectionId, 'disconnected')
})

function openFileTransfer() {
  workspace.addTab({
    id: `file-manager-${props.connectionId}`,
    type: 'file-manager',
    title: props.connectionName,
    connectionId: props.connectionId,
    closable: true,
  })
}

function toggleSftp() {
  sftpVisible.value = !sftpVisible.value
  // 打开 SFTP 时，发送 pwd 触发目录同步
  if (sftpVisible.value) {
    const target = activePanel.value === 2 ? terminalRef2.value : terminalRef.value
    ;(target as any)?.sendData('pwd\n')
  }
}

function toggleSnippets() {
  snippetsVisible.value = !snippetsVisible.value
}

function splitVertical() {
  splitMode.value = splitMode.value === 'vertical' ? 'none' : 'vertical'
}

function splitHorizontal() {
  splitMode.value = splitMode.value === 'horizontal' ? 'none' : 'horizontal'
}



/** 向当前活跃终端发送命令（自动加换行） */
function sendCommandToTerminal(command: string) {
  const target = activePanel.value === 2 ? terminalRef2.value : terminalRef.value
  ;(target as any)?.sendData(command + '\n')
}

/** SFTP 侧栏插入文本到终端（不加换行） */
function handleSftpInsert(text: string) {
  const target = activePanel.value === 2 ? terminalRef2.value : terminalRef.value
  ;(target as any)?.sendData(text)
}

/** 终端检测到 pwd 输出，同步 SFTP 侧栏目录 */
function handleCwdChange(path: string) {
  if (sftpVisible.value) {
    sftpRef.value?.syncToPath(path)
  }
}

const activeSessionInfo = computed(() => {
  const target = activePanel.value === 2 ? terminalRef2.value : terminalRef.value
  return (target as any)?.getSessionInfo() ?? { sessionId: '', cols: 120, rows: 40 }
})
</script>

<template>
  <div class="flex h-full flex-col bg-transparent">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 border-b border-border/30 bg-background/50 backdrop-blur-md px-3 py-1.5">
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              :class="sftpVisible ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground'"
              @click="toggleSftp"
            >
              <PanelRightOpen v-if="!sftpVisible" class="h-3.5 w-3.5" />
              <PanelRightClose v-else class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{{ t('terminal.toggleSftp') }}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              :class="snippetsVisible ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground'"
              @click="toggleSnippets"
            >
              <Bookmark class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{{ t('terminal.commandSnippets') }}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              :class="splitMode === 'vertical' ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground'"
              @click="splitVertical"
            >
              <Columns2 class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{{ t('terminal.splitVertical') }}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              :class="splitMode === 'horizontal' ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground'"
              @click="splitHorizontal"
            >
              <Rows2 class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{{ t('terminal.splitHorizontal') }}</p>
          </TooltipContent>
        </Tooltip>
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
        <!-- 录制指示器 -->
        <RecordingIndicator
          v-if="terminalStatus === 'connected'"
          :session-id="activeSessionInfo.sessionId"
          :cols="activeSessionInfo.cols"
          :rows="activeSessionInfo.rows"
        />
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

    <!-- Terminal + Sidebars -->
    <div class="flex-1 overflow-hidden flex p-2 gap-2 bg-muted/5 pl-0">
      <div class="glass-panel flex-1 overflow-hidden rounded-xl flex">
        <!-- Split mode -->
        <Splitpanes v-if="splitMode !== 'none'" :horizontal="splitMode === 'horizontal'" class="h-full">
          <Pane :size="50">
            <div
              class="h-full rounded-l-xl transition-all duration-300 relative"
              :class="{ 'ring-2 ring-inset ring-primary/60 shadow-[0_0_20px_rgba(var(--color-primary)/0.15)] z-10': activePanel === 1 }"
              @click="activePanel = 1"
            >
              <TerminalPanel
                ref="terminalRef"
                :connection-id="connectionId"
                :connection-name="connectionName"
                @status-change="onStatusChange1"
                @cwd-change="handleCwdChange"
              />
            </div>
          </Pane>
          <Pane :size="50">
            <div
              class="h-full transition-all duration-300 relative"
              :class="{ 'ring-2 ring-inset ring-primary/60 shadow-[0_0_20px_rgba(var(--color-primary)/0.15)] z-10': activePanel === 2 }"
              @click="activePanel = 2"
            >
              <TerminalPanel
                ref="terminalRef2"
                :connection-id="connectionId"
                :connection-name="connectionName"
                @status-change="onStatusChange2"
                @cwd-change="handleCwdChange"
              />
            </div>
          </Pane>
        </Splitpanes>
        <!-- Single mode with optional SFTP -->
        <Splitpanes v-else-if="sftpVisible" class="h-full">
          <Pane :size="70" :min-size="40">
            <TerminalPanel
              ref="terminalRef"
              :connection-id="connectionId"
              :connection-name="connectionName"
              @status-change="onStatusChange1"
              @cwd-change="handleCwdChange"
            />
          </Pane>
          <Pane :size="30" :min-size="15" :max-size="50">
            <SftpSidebar
              ref="sftpRef"
              :connection-id="connectionId"
              @send-command="sendCommandToTerminal"
              @insert-text="handleSftpInsert"
            />
          </Pane>
        </Splitpanes>
        <!-- Single mode -->
        <TerminalPanel
          v-else
          ref="terminalRef"
          :connection-id="connectionId"
          :connection-name="connectionName"
          @status-change="onStatusChange1"
          @cwd-change="handleCwdChange"
        />
      </div>
      <CommandSnippetPanel
        v-if="snippetsVisible"
        class="glass-panel w-64 shrink-0 rounded-xl"
        @send="sendCommandToTerminal"
      />
    </div>
  </div>
</template>
