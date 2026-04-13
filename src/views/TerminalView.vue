<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, onActivated, onDeactivated } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useConnectionStore } from '@/stores/connections'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import TerminalPanel from '@/components/terminal/TerminalPanelLazy.vue'
import SftpSidebar from '@/components/terminal/SftpSidebar.vue'
import CommandSnippetPanel from '@/components/terminal/CommandSnippetPanel.vue'
import RecordingIndicator from '@/components/terminal/RecordingIndicator.vue'
import ServerDashboard from '@/components/terminal/ServerDashboard.vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { FolderOpen, PanelRightClose, PanelRightOpen, Bookmark, Columns2, Rows2, Search, X, ChevronUp, ChevronDown, Activity } from 'lucide-vue-next'
import type { TerminalPanelExposed } from '@/types/component-exposed'

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
const searchVisible = ref(false)
const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement>()
const searchHasMatch = ref<boolean | null>(null) // null=未搜索, true=有匹配, false=无匹配

/** 视图模式：终端 / 监控仪表盘 */
const viewMode = ref<'terminal' | 'dashboard'>('terminal')

/** 获取当前活跃面板的类型安全引用 */
function getActivePanel(): TerminalPanelExposed | undefined {
  const target = activePanel.value === 2 ? terminalRef2.value : terminalRef.value
  return target as unknown as TerminalPanelExposed | undefined
}

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
  // 兜底：组件真正销毁时确保清理
  window.removeEventListener('keydown', handleGlobalKeydown)
})

// KeepAlive 重新激活时同步连接状态 + 恢复全局快捷键
onActivated(() => {
  syncConnectionStatus()
  window.addEventListener('keydown', handleGlobalKeydown)
})

// KeepAlive 切走时移除全局快捷键
onDeactivated(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
})

async function openFileTransfer() {
  // 通过后端 exec channel 获取终端当前目录，然后打开文件管理器
  const panel = getActivePanel()

  let cwd = ''
  try {
    cwd = await panel?.requestCwd?.() || ''
  } catch (err) {
    // requestCwd 失败时静默降级
  }

  if (!cwd) {
    cwd = currentCwd.value || ''
  }

  workspace.addTab({
    id: `file-manager-${props.connectionId}`,
    type: 'file-manager',
    title: props.connectionName,
    connectionId: props.connectionId,
    closable: true,
    meta: cwd ? { initialRemotePath: cwd } : undefined,
  })
}

async function toggleSftp() {
  sftpVisible.value = !sftpVisible.value
  // 打开 SFTP 时，主动获取终端当前目录并同步
  if (sftpVisible.value) {
    const panel = getActivePanel()
    const cwd = await panel?.requestCwd?.()
    if (cwd) {
      currentCwd.value = cwd
      // 等 SftpSidebar 挂载后再同步路径
      setTimeout(() => {
        sftpRef.value?.syncToPath(cwd)
      }, 500)
    }
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

// === 终端搜索功能 ===
function toggleSearch() {
  searchVisible.value = !searchVisible.value
  if (searchVisible.value) {
    setTimeout(() => searchInputRef.value?.focus(), 50)
  } else {
    getActivePanel()?.searchClear()
    searchQuery.value = ''
    searchHasMatch.value = null
  }
}

function doSearch() {
  if (!searchQuery.value) {
    searchHasMatch.value = null
    return
  }
  const found = getActivePanel()?.searchFind(searchQuery.value)
  searchHasMatch.value = found ?? null
}

function doSearchNext() {
  if (!searchQuery.value) return
  const found = getActivePanel()?.searchFindNext(searchQuery.value)
  searchHasMatch.value = found ?? null
}

function doSearchPrev() {
  if (!searchQuery.value) return
  const found = getActivePanel()?.searchFindPrevious(searchQuery.value)
  searchHasMatch.value = found ?? null
}

function handleSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    if (e.shiftKey) {
      doSearchPrev()
    } else {
      doSearchNext()
    }
  } else if (e.key === 'Escape') {
    toggleSearch()
  }
}

// Ctrl+F 快捷键绑定
function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    // 仅在终端视图中拦截
    e.preventDefault()
    e.stopPropagation()
    toggleSearch()
  }
}

/** 向当前活跃终端发送命令（自动加换行） */
function sendCommandToTerminal(command: string) {
  getActivePanel()?.sendData(command + '\n')
}

/** SFTP 侧栏插入文本到终端（不加换行） */
function handleSftpInsert(text: string) {
  getActivePanel()?.sendData(text)
}

// 持久化终端当前工作目录，用于打开文件管理器时传递初始路径
const currentCwd = ref('')

/** 终端检测到 pwd 输出，同步 SFTP 侧栏目录并持久化 cwd */
function handleCwdChange(path: string) {
  currentCwd.value = path
  if (sftpVisible.value) {
    sftpRef.value?.syncToPath(path)
  }
}

const activeSessionInfo = computed(() => {
  const panel = getActivePanel()
  if (!panel || typeof panel.getSessionInfo !== 'function') {
    return { sessionId: '', cols: 120, rows: 40 }
  }
  return panel.getSessionInfo() ?? { sessionId: '', cols: 120, rows: 40 }
})
</script>

<template>
  <div class="relative flex h-full w-full flex-col overflow-hidden bg-background">
    <!-- Toolbar -->
    <div class="flex h-10 shrink-0 items-center border-b border-border/10 bg-background/95 px-3 backdrop-blur-md">
      <div class="flex items-center gap-1" role="toolbar" :aria-label="t('terminal.toolbar')">
        <TooltipProvider :delay-duration="300">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                :aria-label="t('terminal.toggleSftp')"
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
                :aria-label="t('terminal.commandSnippets')"
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
                :aria-label="t('terminal.splitVertical')"
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
                :aria-label="t('terminal.splitHorizontal')"
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
                :aria-label="t('terminal.openFileTransfer')"
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
      </div>
      <div class="flex-1" />

      <!-- 视图模式切换：终端 / 仪表盘 -->
      <div v-if="terminalStatus === 'connected'" class="flex items-center mr-2">
        <div class="flex items-center rounded-md border border-border/30 bg-muted/30 p-0.5">
          <Button
            variant="ghost"
            size="sm"
            class="h-6 px-2 text-[11px] rounded-sm"
            :class="viewMode === 'terminal' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            @click="viewMode = 'terminal'"
          >
            Terminal
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 px-2 text-[11px] rounded-sm gap-1"
            :class="viewMode === 'dashboard' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            @click="viewMode = 'dashboard'"
          >
            <Activity class="h-3 w-3" />
            {{ t('terminal.dashboard') }}
          </Button>
        </div>
      </div>

      <!-- 搜索按钮 -->
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              :aria-label="t('terminal.search') + ' (Ctrl+F)'"
              class="h-7 w-7"
              :class="searchVisible ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground'"
              @click="toggleSearch"
            >
              <Search class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{{ t('terminal.search') }} (Ctrl+F)</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <div class="flex items-center gap-2 border-l border-border/10 ml-2 pl-3 text-[10px] font-black tracking-widest text-muted-foreground/30 uppercase italic">
        <div
          class="h-1.5 w-1.5 rounded-full transition-colors duration-300"
          :class="{
            'bg-df-success shadow-[0_0_4px_var(--df-success)]': terminalStatus === 'connected',
            'bg-df-warning animate-pulse': terminalStatus === 'connecting',
            'bg-destructive': terminalStatus === 'error',
            'bg-muted-foreground/30': terminalStatus === 'disconnected',
          }"
        ></div>
        <span>{{ connectionName }}</span>
      </div>
    </div>

    <!-- 搜索栏 Overlay -->
    <div
      v-if="searchVisible"
      class="absolute right-6 top-12 z-50 flex h-10 items-center gap-2 rounded-lg border border-border bg-background/95 p-2 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-200"
      role="search"
      :aria-label="t('terminal.search')"
    >
      <div class="flex items-center gap-1.5 px-1">
        <Search class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          class="w-48 h-7 bg-transparent border-none text-xs text-foreground placeholder:text-muted-foreground/50 outline-none"
          :placeholder="t('terminal.searchPlaceholder')"
          @keydown="handleSearchKeydown"
          @input="doSearch"
        />
        <span
          v-if="searchQuery && searchHasMatch !== null"
          class="text-[10px] shrink-0 tabular-nums"
          :class="searchHasMatch ? 'text-df-success' : 'text-destructive'"
        >
          {{ searchHasMatch ? t('terminal.searchFound') : t('terminal.searchNotFound') }}
        </span>
      </div>
      <div class="flex items-center border-l border-border pl-1 gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          :aria-label="t('terminal.searchPrevious')"
          class="h-7 w-7 text-muted-foreground hover:text-foreground"
          :disabled="!searchQuery"
          @click="doSearchPrev"
        >
          <ChevronUp class="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          :aria-label="t('terminal.searchNext')"
          class="h-7 w-7 text-muted-foreground hover:text-foreground"
          :disabled="!searchQuery"
          @click="doSearchNext"
        >
          <ChevronDown class="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          :aria-label="t('common.close')"
          class="h-7 w-7 text-muted-foreground hover:text-foreground ml-1"
          @click="toggleSearch"
        >
          <X class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    <!-- 主展示区 -->
    <div class="min-h-0 flex-1 flex overflow-hidden bg-background relative">
      <!-- 服务器监控仪表盘 -->
      <ServerDashboard
        v-if="viewMode === 'dashboard'"
        :connection-id="connectionId"
        :active="viewMode === 'dashboard'"
      />

      <div v-show="viewMode === 'terminal'" class="flex-1 flex overflow-hidden">
        <!-- 核心：通过控制外层 flex 属性实现布局切换，避免 v-if 销毁组件 -->
        <Splitpanes class="h-full" :horizontal="splitMode === 'horizontal'">
          <!-- 第一分栏：始终包含主终端 -->
          <Pane :size="splitMode !== 'none' ? 50 : (sftpVisible ? 70 : 100)">
            <div 
              class="h-full relative transition-shadow duration-300"
              :class="{ 'ring-2 ring-inset ring-primary/60 shadow-[0_0_20px_rgba(var(--color-primary)/0.15)] z-10': splitMode !== 'none' && activePanel === 1 }"
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
          
          <!-- 第二分栏：可能是第二个终端，也可能是 SFTP，由 logic 控制 -->
          <Pane v-if="splitMode !== 'none' || sftpVisible" :size="splitMode !== 'none' ? 50 : 30" :min-size="15">
             <!-- 如果是分屏模式，显示第二个终端 -->
             <div 
               v-if="splitMode !== 'none'"
               class="h-full relative transition-shadow duration-300"
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
             
             <!-- 如果是 SFTP 模式且非分屏，显示 SFTP 侧边栏 -->
             <SftpSidebar
               v-else-if="sftpVisible"
               ref="sftpRef"
               :connection-id="connectionId"
               @send-command="sendCommandToTerminal"
               @insert-text="handleSftpInsert"
             />
          </Pane>
        </Splitpanes>
      </div>

      <!-- 命令片段面板 -->
      <CommandSnippetPanel
        v-if="snippetsVisible && viewMode === 'terminal'"
        class="glass-panel w-64 shrink-0 rounded-xl"
        @send="sendCommandToTerminal"
      />
    </div>
  </div>
</template>
