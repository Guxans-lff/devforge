<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConnectionStore } from '@/stores/connections'
import { useToast } from '@/composables/useToast'
import TerminalPanel from '@/components/terminal/TerminalPanelLazy.vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Send, Eraser, LayoutGrid, Rows2, Columns2, Check, Monitor, ChevronsUpDown, TerminalSquare, Search } from 'lucide-vue-next'
import type { TerminalPanelExposed } from '@/types/component-exposed'

const { t } = useI18n()
const connectionStore = useConnectionStore()
const toast = useToast()

const commandInput = ref('')
const selectedIds = ref<Set<string>>(new Set())
const terminalRefs = ref<Map<string, InstanceType<typeof TerminalPanel>>>(new Map())
const sessionStatuses = ref<Map<string, string>>(new Map())
const layout = ref<'grid' | 'vertical' | 'horizontal'>('grid')
const focusedId = ref<string | null>(null)
const openPopover = ref(false)

const searchTarget = ref('')

// 命令历史（内存级，最近 20 条）
const commandHistory = ref<string[]>([])
const historyIndex = ref(-1)
const MAX_HISTORY = 20

// 只显示 SSH 类型连接
const sshConnections = computed(() =>
  connectionStore.connectionList.filter((c) => c.record.type === 'ssh')
)

const filteredSshConnections = computed(() => {
  if (!searchTarget.value) return sshConnections.value
  const q = searchTarget.value.toLowerCase()
  return sshConnections.value.filter((c) =>
    c.record.name.toLowerCase().includes(q) || c.record.host.toLowerCase().includes(q)
  )
})

const selectedConnections = computed(() =>
  sshConnections.value.filter((c) => selectedIds.value.has(c.record.id))
)

const gridCols = computed(() => {
  const count = selectedConnections.value.length
  if (count <= 1) return 1
  if (count <= 4) return 2
  return 3
})

function toggleConnection(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedIds.value = next
}

function selectAll() {
  selectedIds.value = new Set(sshConnections.value.map((c) => c.record.id))
}

function deselectAll() {
  selectedIds.value = new Set()
}

function sendCommand() {
  const cmd = commandInput.value.trim()
  if (!cmd || selectedConnections.value.length === 0) return
  for (const conn of selectedConnections.value) {
    const panel = terminalRefs.value.get(conn.record.id) as unknown as TerminalPanelExposed | undefined
    panel?.sendData(cmd + '\n')
  }
  // 追加到历史（去重，最新在前）
  commandHistory.value = [cmd, ...commandHistory.value.filter(h => h !== cmd)].slice(0, MAX_HISTORY)
  historyIndex.value = -1
  commandInput.value = ''
  toast.success(t('multiExec.commandSent', { count: selectedConnections.value.length }))
}

function clearInput() {
  commandInput.value = ''
  historyIndex.value = -1
}

function onStatusChange(connId: string, status: string) {
  sessionStatuses.value = new Map(sessionStatuses.value).set(connId, status)
}

function setTerminalRef(connId: string, el: unknown) {
  if (el) {
    terminalRefs.value.set(connId, el as InstanceType<typeof TerminalPanel>)
  } else {
    terminalRefs.value.delete(connId)
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    sendCommand()
    return
  }
  // 上下箭头切换命令历史
  if (e.key === 'ArrowUp' && commandHistory.value.length > 0) {
    e.preventDefault()
    const next = Math.min(historyIndex.value + 1, commandHistory.value.length - 1)
    historyIndex.value = next
    commandInput.value = commandHistory.value[next]!
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (historyIndex.value <= 0) {
      historyIndex.value = -1
      commandInput.value = ''
    } else {
      historyIndex.value--
      commandInput.value = commandHistory.value[historyIndex.value]!
    }
  }
}

onMounted(() => {
  connectionStore.loadConnections()
})

onBeforeUnmount(() => {
  terminalRefs.value.clear()
})
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <!-- 穹顶天际线：灵动指令岛 (Command Island) -->
    <div class="relative z-20 px-4 xl:px-8 pt-6 pb-2">
      <!-- 物理级悬浮外壳 -->
      <div class="mx-auto flex items-center bg-card/70 backdrop-blur-[40px] border border-border/60 shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.1)] rounded-[1.25rem] p-1.5 ring-1 ring-black/5 dark:ring-white/10 transition-all duration-500 hover:shadow-[0_8px_40px_rgba(0,0,0,0.08)] focus-within:shadow-[0_12px_50px_rgba(var(--primary),0.12)] focus-within:border-primary/30 focus-within:ring-primary/20 max-w-[1200px]">
        
        <!-- 左侧：动态服务器胶囊舱 (Popover Selector) -->
        <Popover v-model:open="openPopover">
          <PopoverTrigger as-child>
            <Button
              variant="ghost"
              role="combobox"
              :aria-expanded="openPopover"
              class="h-11 rounded-[14px] bg-muted/40 hover:bg-muted/80 px-4 font-medium flex items-center gap-2.5 shrink-0 border border-transparent hover:border-border/60 transition-all text-[13.5px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)] dark:shadow-none"
            >
              <div class="relative flex items-center justify-center">
                <Monitor class="h-4 w-4 text-primary drop-shadow-sm" />
                <span v-if="selectedIds.size > 0" class="absolute -top-1 -right-1.5 flex h-2 w-2">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary left-0.5 top-0.5"></span>
                </span>
              </div>
              <span v-if="selectedIds.size === 0" class="text-muted-foreground tracking-wide">{{ t('multiExec.emptyGuide', '选择目标主机') }}</span>
              <span v-else class="text-foreground font-bold tracking-tight">{{ selectedIds.size }} 台终端已就绪</span>
              <ChevronsUpDown class="h-3.5 w-3.5 text-muted-foreground/50 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-[320px] p-0 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] border-border/50 rounded-[18px] overflow-hidden bg-background/95 backdrop-blur-2xl translate-y-3 flex flex-col" align="start">
            <!-- 精致搜索框 -->
            <div class="flex items-center px-4 border-b border-border/40 h-12 shrink-0">
              <Search class="h-4 w-4 text-muted-foreground/60 shrink-0 mr-2" />
              <input v-model="searchTarget" placeholder="搜索目标服务器..." class="flex-1 min-w-0 bg-transparent border-none outline-none focus:ring-0 text-[12.5px] placeholder:text-muted-foreground/50 text-foreground font-medium" />
            </div>
            
            <div v-if="filteredSshConnections.length === 0" class="py-10 text-center text-[12.5px] text-muted-foreground">未找到匹配的终端机</div>
            
            <div v-else class="max-h-[300px] overflow-y-auto p-1.5 custom-scrollbar flex flex-col gap-0.5">
              <div
                v-for="conn in filteredSshConnections"
                :key="conn.record.id"
                class="group flex items-center gap-3.5 rounded-[12px] px-3.5 py-3 cursor-pointer text-[13px] transition-all duration-300 hover:bg-primary/10 select-none"
                :class="selectedIds.has(conn.record.id) ? 'bg-primary/5 text-primary' : ''"
                @click="toggleConnection(conn.record.id)"
              >
                <!-- 精致的复选框 -->
                <div class="h-4 w-4 shrink-0 rounded-[6px] border flex items-center justify-center transition-all duration-300 shadow-sm"
                     :class="selectedIds.has(conn.record.id) ? 'bg-primary border-primary text-primary-foreground shadow-[0_2px_10px_rgba(var(--primary),0.5)]' : 'bg-card border-border/80 text-transparent group-hover:border-primary/50'">
                  <Check class="h-[10px] w-[10px]" :class="selectedIds.has(conn.record.id) ? 'scale-100 opacity-100' : 'scale-50 opacity-0'" />
                </div>
                
                <!-- 图标与文本组 -->
                <div class="flex items-center gap-3 min-w-0 flex-1 pl-0.5">
                  <div class="h-8 w-8 rounded-[10px] bg-background border border-border/50 flex items-center justify-center shadow-sm shrink-0 transition-all duration-300 group-hover:border-primary/30 group-hover:bg-primary/5 group-hover:scale-105" :class="selectedIds.has(conn.record.id) ? 'border-primary/40 bg-primary/10' : ''">
                    <TerminalSquare class="h-4 w-4 transition-colors duration-300" :class="selectedIds.has(conn.record.id) ? 'text-primary' : 'text-muted-foreground/60 group-hover:text-primary/70'" />
                  </div>
                  <div class="flex flex-col min-w-0 overflow-hidden justify-center space-y-0.5">
                    <span class="font-semibold text-foreground truncate leading-tight transition-colors duration-300" :class="selectedIds.has(conn.record.id) ? 'text-primary' : ''">{{ conn.record.name }}</span>
                    <span class="text-[11px] text-muted-foreground/60 font-mono truncate transition-colors duration-300 tracking-tight" :class="selectedIds.has(conn.record.id) ? 'text-primary/70' : ''">{{ conn.record.host }}</span>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- 底部操作区 -->
            <div class="p-2 border-t border-border/40 bg-card/40 backdrop-blur-xl flex gap-2 items-center justify-between shrink-0">
              <span class="text-[11px] font-medium text-muted-foreground pl-2 flex items-center gap-1.5 opacity-80">
                <div class="w-1.5 h-1.5 rounded-full" :class="selectedIds.size > 0 ? 'bg-primary animate-pulse' : 'bg-muted-foreground/30'"></div>
                已选 {{ selectedIds.size }} / {{ sshConnections.length }}
              </span>
              <div class="flex items-center gap-1 pr-1">
                <Button variant="ghost" size="sm" class="h-7 px-3 text-[11.5px] font-semibold rounded-[8px] hover:bg-background hover:shadow-sm transition-all" @click="selectAll" :disabled="selectedIds.size === sshConnections.length" :class="selectedIds.size === sshConnections.length ? 'opacity-40' : 'text-foreground'">
                  全接管
                </Button>
                <Button variant="ghost" size="sm" class="h-7 px-3 text-[11.5px] font-medium rounded-[8px] hover:bg-background hover:text-destructive hover:shadow-sm transition-all" @click="deselectAll" :disabled="selectedIds.size === 0" :class="selectedIds.size === 0 ? 'opacity-40' : 'text-muted-foreground'">
                  清空
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <!-- 极简分割线 -->
        <div class="w-px h-6 bg-border/60 mx-3 shrink-0"></div>

        <!-- 中枢：无界指令输入场 (Infinity Input) -->
        <div class="flex-1 relative flex items-center group">
          <input 
            v-model="commandInput"
            class="w-full h-11 bg-transparent border-none outline-none focus:ring-0 px-2 text-[14.5px] font-mono text-foreground placeholder:text-muted-foreground/40 transition-all font-medium"
            placeholder="输入群控终端指令... (↑/↓ 翻页历史, Ctrl+Enter 闪击)"
            @keydown="handleKeydown"
          />
          <!-- 擦除按钮 -->
          <div class="absolute right-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded-xl transition-colors" @click="clearInput" v-show="commandInput.length > 0">
                    <Eraser class="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>{{ t('multiExec.clear', '清空') }}</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <!-- 右侧：火力发射与布局矩阵 -->
        <div class="flex items-center gap-2 pl-3 pr-1 shrink-0 relative before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-px before:h-6 before:bg-border/60">
          
          <!-- 发射按钮 (Glow Effect) -->
          <Button class="h-10 px-5 rounded-[12px] bg-primary hover:bg-primary/90 shadow-[0_4px_14px_rgba(var(--primary),0.3)] hover:shadow-[0_6px_20px_rgba(var(--primary),0.4)] hover:-translate-y-0.5 gap-2.5 transition-all duration-300 font-bold tracking-wider disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-[0_4px_14px_rgba(var(--primary),0.3)]" :disabled="!commandInput.trim() || selectedIds.size === 0" @click="sendCommand">
            <Send class="h-4 w-4" />发送
          </Button>

          <!-- 极客布局控件 -->
          <div class="flex items-center gap-0.5 bg-muted/40 p-1 rounded-[12px] border border-border/50 ml-1">
            <Button
              variant="ghost" size="icon" class="h-8 w-8 rounded-[10px] transition-all"
              :class="layout === 'grid' ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'"
              @click="layout = 'grid'"
            >
              <LayoutGrid class="h-4 w-4" />
            </Button>
            <Button
              variant="ghost" size="icon" class="h-8 w-8 rounded-[10px] transition-all"
              :class="layout === 'vertical' ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'"
              @click="layout = 'vertical'"
            >
              <Columns2 class="h-4 w-4" />
            </Button>
            <Button
              variant="ghost" size="icon" class="h-8 w-8 rounded-[10px] transition-all"
              :class="layout === 'horizontal' ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'"
              @click="layout = 'horizontal'"
            >
              <Rows2 class="h-4 w-4" />
            </Button>
          </div>
        </div>

      </div>
    </div>

    <!-- 终端网格区域 -->
    <div
      v-if="selectedConnections.length > 0"
      class="flex-1 overflow-hidden p-3 bg-muted/10 relative"
      :class="{
        'grid gap-3': layout === 'grid',
        'flex flex-row gap-3': layout === 'vertical',
        'flex flex-col gap-3': layout === 'horizontal',
      }"
      :style="layout === 'grid' ? { gridTemplateColumns: `repeat(${gridCols}, 1fr)` } : {}"
    >
      <div
        v-for="conn in selectedConnections"
        :key="conn.record.id"
        class="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow duration-300 hover:shadow-md"
        :class="focusedId === conn.record.id ? 'border-primary/50 ring-2 ring-primary/10' : 'border-border/60'"
        :style="layout !== 'grid' ? { flex: '1 1 0' } : {}"
        @click="focusedId = conn.record.id"
      >
        <!-- 终端标题栏 -->
        <TooltipProvider :delay-duration="300">
          <Tooltip>
            <TooltipTrigger as-child>
              <div class="flex items-center gap-2.5 px-3 py-2 bg-muted/30 border-b border-border/50 cursor-default select-none group/term transition-colors hover:bg-muted/50">
                <div class="relative flex h-2 w-2 items-center justify-center shrink-0">
                  <div class="absolute inline-flex h-full w-full rounded-full opacity-30"
                       :class="{
                         'bg-emerald-500 animate-ping': sessionStatuses.get(conn.record.id) === 'connected',
                         'bg-amber-500 animate-pulse': sessionStatuses.get(conn.record.id) === 'connecting',
                         'bg-destructive': sessionStatuses.get(conn.record.id) === 'error',
                         'hidden': !sessionStatuses.get(conn.record.id) || sessionStatuses.get(conn.record.id) === 'disconnected',
                       }"></div>
                  <div
                    class="relative inline-flex h-2 w-2 rounded-full"
                    :class="{
                      'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]': sessionStatuses.get(conn.record.id) === 'connected',
                      'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]': sessionStatuses.get(conn.record.id) === 'connecting',
                      'bg-destructive shadow-[0_0_6px_rgba(239,68,68,0.6)]': sessionStatuses.get(conn.record.id) === 'error',
                      'bg-muted-foreground/40': !sessionStatuses.get(conn.record.id) || sessionStatuses.get(conn.record.id) === 'disconnected',
                    }"
                  />
                </div>
                <span class="text-[13px] font-semibold text-foreground/80 truncate">{{ conn.record.name }}</span>
                <span class="ml-auto text-[11px] font-mono text-muted-foreground/40 truncate max-w-[150px] opacity-0 group-hover/term:opacity-100 transition-opacity">{{ conn.record.host }}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{{ conn.record.host }}:{{ conn.record.port }}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <!-- 终端面板 -->
        <div class="flex-1 overflow-hidden">
          <TerminalPanel
            :ref="(el: unknown) => setTerminalRef(conn.record.id, el)"
            :connection-id="conn.record.id"
            :connection-name="conn.record.name"
            @status-change="(s: string) => onStatusChange(conn.record.id, s)"
          />
        </div>
      </div>
    </div>

    <!-- 纯粹修身的高阶留白空状态 -->
    <div v-else class="flex-1 overflow-y-auto p-4 sm:p-6 bg-muted/10 flex items-center justify-center relative select-none">
      <div class="flex flex-col items-center justify-center text-center animate-in fade-in zoom-in-[0.98] duration-700 max-w-md mx-auto p-12 rounded-[2.5rem] bg-transparent relative z-10 transition-all">
        
        <!-- 中心光晕与拟物圆盘 -->
        <div class="relative h-32 w-32 mb-10 flex items-center justify-center group">
          <!-- 呼吸氛围灯 (背光) -->
          <div class="absolute inset-0 bg-primary/20 rounded-full blur-[40px] animate-pulse opacity-60 transition-opacity duration-1000 group-hover:opacity-100"></div>
          
          <!-- 立体玻璃材质底座 -->
          <div class="h-24 w-24 rounded-[1.75rem] bg-gradient-to-tr from-card to-background border border-border/60 shadow-[0_16px_50px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.4)] flex items-center justify-center ring-1 ring-black/5 dark:ring-white/10 relative overflow-hidden transition-all duration-700 group-hover:scale-110">
            <!-- 表面光泽映射 -->
            <div class="absolute inset-0 bg-gradient-to-br from-white/30 via-transparent to-transparent dark:from-white/10 opacity-60"></div>
            <!-- 主荧幕 Icon -->
            <Monitor class="h-10 w-10 text-muted-foreground/60 drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)] dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] transition-all duration-500 group-hover:text-primary/80" />
          </div>
        </div>

        <!-- 极简排版文本 -->
        <div class="space-y-3">
          <h3 class="text-2xl font-bold tracking-tight text-foreground/85">{{ t('multiExec.emptyGuide', '选择连接的服务器') }}</h3>
          <p class="text-[14.5px] text-muted-foreground/70 max-w-[280px] leading-relaxed mx-auto font-medium">
            {{ sshConnections.length > 0 ? '点击顶部的选择器，勾选要同步执行指令的目标终端机。' : '当前资产库暂无 SSH 类型连接，请先去侧边栏添加。' }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
