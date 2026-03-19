<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useConnectionStore } from '@/stores/connections'
import { useTheme } from '@/composables/useTheme'
import { useLocale } from '@/composables/useLocale'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import ConnectionDialog from '@/components/connection/ConnectionDialog.vue'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/composables/useToast'
import { parseIsFavorite, parseEnvironment, updateConnection } from '@/api/connection'
import { ENV_PRESETS, type EnvironmentType } from '@/types/environment'
import {
  Database,
  Terminal,
  FolderOpen,
  Plus,
  Search,
  Settings,
  ChevronLeft,
  Sun,
  Moon,
  Monitor,
  Languages,
  Pencil,
  Trash2,
  Plug,
  FlaskConical,
  LayoutGrid,
  Star,
  StarOff,
  Copy,
  X,
  ChevronDown,
} from 'lucide-vue-next'
import type { ConnectionRecord } from '@/api/connection'
import type { TabType } from '@/types/workspace'

const { t } = useI18n()
const workspace = useWorkspaceStore()
const connectionStore = useConnectionStore()
const { themeMode, toggleTheme } = useTheme()
const { currentLocale, toggleLocale } = useLocale()

const isCollapsed = computed(() => workspace.panelState.sidebarCollapsed)
const showConnectionDialog = ref(false)
const editingConnection = ref<ConnectionRecord | null>(null)
const toast = useToast()

// 删除确认状态
const showDeleteConfirm = ref(false)
const pendingDeleteId = ref<string | null>(null)
const pendingDeleteName = ref('')

// 拖拽状态
const draggedConnectionId = ref<string | null>(null)
const dragOverConnectionId = ref<string | null>(null)

// 颜色标签选择器状态
const showColorPicker = ref(false)
const colorPickerConnectionId = ref<string | null>(null)
const colorPickerPosition = ref({ x: 0, y: 0 })

// 分组展开/折叠状态
const collapsedGroups = ref<Set<string>>(new Set())

function toggleGroup(type: string) {
  if (collapsedGroups.value.has(type)) {
    collapsedGroups.value.delete(type)
  } else {
    collapsedGroups.value.add(type)
  }
}

// 预定义颜色列表
const colorOptions = [
  '#ef4444', // 红色
  '#f97316', // 橙色
  '#eab308', // 黄色
  '#22c55e', // 绿色
  '#06b6d4', // 青色
  '#3b82f6', // 蓝色
  '#8b5cf6', // 紫色
  '#ec4899', // 粉色
]

onMounted(() => {
  connectionStore.loadConnections()
  // 监听来自命令面板或其他地方的新建连接请求
  window.addEventListener('devforge:new-connection', handleNewConnection)
  // 点击其他区域关闭颜色选择器
  document.addEventListener('click', closeColorPicker)
})

const themeIcon = computed(() => {
  if (themeMode.value === 'dark') return Moon
  if (themeMode.value === 'light') return Sun
  return Monitor
})

// 连接类型标签

const typeBadgeColors: Record<string, string> = {
  database: 'text-blue-500',
  ssh: 'text-emerald-500',
  sftp: 'text-amber-500',
}

const statusColors: Record<string, string> = {
  connected: 'bg-[#10b981] shadow-[0_0_6px_rgba(16,185,129,0.5)]',
  disconnected: 'bg-zinc-400/50 dark:bg-zinc-600/50',
  connecting: 'bg-amber-500 animate-[pulse_1.5s_ease-in-out_infinite]',
  error: 'bg-destructive shadow-[0_0_6px_rgba(239,68,68,0.5)]',
}

/** 根据连接状态返回图标附加动画 class */
function iconAnimClass(status: string): string {
  if (status === 'connecting') return 'animate-spin'
  if (status === 'error') return 'text-destructive'
  return ''
}

const typeIcons: Record<string, typeof Database> = {
  database: Database,
  ssh: Terminal,
  sftp: FolderOpen,
}

function handleNewConnection() {
  editingConnection.value = null
  showConnectionDialog.value = true
}

function handleEditConnection(conn: ConnectionRecord) {
  editingConnection.value = conn
  showConnectionDialog.value = true
}

function handleDeleteConnection(id: string, name: string) {
  pendingDeleteId.value = id
  pendingDeleteName.value = name
  showDeleteConfirm.value = true
}

async function confirmDeleteConnection() {
  if (!pendingDeleteId.value) return
  try {
    await connectionStore.removeConnection(pendingDeleteId.value)
  } catch (e) {
    toast.error(t('connection.deleteFailed'), String(e))
  }
}

async function handleTestConnection(id: string) {
  try {
    await connectionStore.testConnectionById(id)
  } catch {
    // 错误已存储在 state 中
  }
}

function handleConnectionSaved() {
  connectionStore.loadConnections()
}

function handleConnectionConnect(connectionId: string, connectionName: string) {
  connectionStore.loadConnections()
  workspace.addTab({
    id: `database-${connectionId}`,
    type: 'database',
    title: connectionName,
    connectionId,
    closable: true,
  })
}

function handleDoubleClick(conn: { record: ConnectionRecord }) {
  const typeToTab: Record<string, TabType> = {
    database: 'database',
    ssh: 'terminal',
    sftp: 'file-manager',
  }
  const tabType = typeToTab[conn.record.type] ?? 'database'
  workspace.addTab({
    id: `${tabType}-${conn.record.id}`,
    type: tabType,
    title: conn.record.name,
    connectionId: conn.record.id,
    closable: true,
  })
}

// --- 收藏功能 ---
async function handleToggleFavorite(connectionId: string) {
  try {
    await connectionStore.toggleConnectionFavorite(connectionId)
  } catch (e) {
    toast.error(t('connection.favoriteFailed'), String(e))
  }
}

// --- 复制连接 ---
async function handleDuplicateConnection(conn: ConnectionRecord) {
  try {
    await connectionStore.addConnection({
      name: `${conn.name} (copy)`,
      type: conn.type,
      groupId: conn.groupId,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      configJson: conn.configJson,
      color: conn.color,
    })
    await connectionStore.loadConnections()
  } catch (e) {
    toast.error(t('connection.saveFailed'), String(e))
  }
}

// --- 颜色标签 ---
function closeColorPicker() {
  showColorPicker.value = false
  colorPickerConnectionId.value = null
}

async function handleSetColor(connectionId: string, color: string | null) {
  try {
    await updateConnection(connectionId, { color: color ?? undefined })
    await connectionStore.loadConnections()
  } catch (e) {
    toast.error(t('connection.saveFailed'), String(e))
  }
  closeColorPicker()
}

// --- 拖拽排序 ---
function onDragStart(event: DragEvent, connectionId: string) {
  draggedConnectionId.value = connectionId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', connectionId)
  }
}

function onDragOver(event: DragEvent, connectionId: string) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  dragOverConnectionId.value = connectionId
}

function onDragLeave() {
  dragOverConnectionId.value = null
}

async function onDrop(event: DragEvent, targetConnectionId: string) {
  event.preventDefault()
  dragOverConnectionId.value = null

  const sourceId = draggedConnectionId.value
  if (!sourceId || sourceId === targetConnectionId) {
    draggedConnectionId.value = null
    return
  }

  // 计算新的排序顺序
  const currentList = connectionStore.filteredConnections
  const orderedIds = currentList.map((c) => c.record.id)
  const sourceIndex = orderedIds.indexOf(sourceId)
  const targetIndex = orderedIds.indexOf(targetConnectionId)

  if (sourceIndex === -1 || targetIndex === -1) {
    draggedConnectionId.value = null
    return
  }

  // 从原位置移除，插入到目标位置
  orderedIds.splice(sourceIndex, 1)
  orderedIds.splice(targetIndex, 0, sourceId)

  try {
    await connectionStore.reorderConnectionList(orderedIds)
  } catch (e) {
    toast.error(t('connection.reorderFailed'), String(e))
  }

  draggedConnectionId.value = null
}

function onDragEnd() {
  draggedConnectionId.value = null
  dragOverConnectionId.value = null
}

/** 判断连接是否为收藏 */
function isFavorite(conn: ConnectionRecord): boolean {
  return parseIsFavorite(conn.configJson)
}

/** 环境类型缩写映射 */
const ENV_SHORT_LABELS: Record<EnvironmentType, string> = {
  production: 'PROD',
  staging: 'STG',
  development: 'DEV',
  testing: 'TEST',
  local: 'LOCAL',
}

/** 获取连接的环境类型（仅数据库类型连接） */
function getEnvironment(conn: ConnectionRecord): EnvironmentType | null {
  if (conn.type !== 'database') return null
  return parseEnvironment(conn.configJson) || null
}

/** 将非收藏连接按类型分组 */
const groupedNonFavorites = computed(() => {
  const categories = [
    { type: 'database', label: t('welcome.database'), icon: Database },
    { type: 'ssh', label: t('welcome.terminal'), icon: Terminal },
    { type: 'sftp', label: t('welcome.files'), icon: FolderOpen },
  ]
  
  return categories.map(cat => ({
    ...cat,
    isCollapsed: collapsedGroups.value.has(cat.type),
    items: connectionStore.filteredNonFavorites.filter(c => c.record.type === cat.type)
  })).filter(cat => cat.items.length > 0)
})
</script>

<template>
  <aside
    class="flex h-full flex-col glass-sidebar transition-[width] duration-[var(--df-duration-normal)] ease-[var(--df-ease-out)] relative z-20 shadow-[1px_0_0_rgba(0,0,0,0.02)]"
    :class="[
      themeMode === 'light' 
        ? 'bg-gradient-to-b from-[#fcfcfd] via-[#f8f9fb] to-[#f2f4f7]' 
        : 'bg-[#0c0c0e]'
    ]"
    :style="{ width: isCollapsed ? '48px' : `${workspace.panelState.sidebarWidth}px` }"
  >
    <!-- Header: Masterclass Floating Anchor (No Redundant Titles) -->
    <div v-if="!isCollapsed" class="flex items-center gap-2 px-3 pt-5 pb-2 relative z-20 bg-background/95 backdrop-blur-xl">
      <!-- 琉璃质感拟物搜索框 (Neu/Glass Search Pill) -->
      <div class="group relative flex-1 flex items-center">
        <!-- Pill Background Container -->
        <div class="absolute inset-0 rounded-full bg-zinc-100/60 dark:bg-black/20 shadow-[inset_0_2px_4px_rgba(0,0,0,0.03),inset_0_0_0_1px_rgba(0,0,0,0.04),0_1px_0_rgba(255,255,255,0.7)] dark:shadow-[inset_0_2px_6px_rgba(0,0,0,0.4),inset_0_0_0_1px_rgba(255,255,255,0.06),0_1px_0_rgba(255,255,255,0.03)] transform-gpu transition-all duration-300 group-focus-within:bg-white dark:group-focus-within:bg-[#1C1C1E] group-focus-within:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05),0_4px_12px_rgba(0,0,0,0.05),0_0_0_2px_rgba(var(--primary-rgb),0.15)] dark:group-focus-within:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15),0_6px_20px_rgba(0,0,0,0.6),0_0_0_2px_rgba(var(--primary-rgb),0.2)]" />
        
        <Search class="absolute left-3.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-zinc-400 dark:text-zinc-500 transition-colors group-focus-within:text-primary z-10" />
        <Input
          class="h-[34px] w-full border-none bg-transparent pl-10 pr-3 text-[13px] font-medium text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 shadow-none focus-visible:ring-0 z-10"
          :placeholder="t('sidebar.searchConnections')"
          :model-value="connectionStore.searchQuery"
          @update:model-value="connectionStore.setSearchQuery($event as string)"
        />
      </div>

      <!-- 琉璃质感浮雕按钮 (Embossed Glass Button) -->
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="group relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full transform-gpu will-change-transform transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] active:scale-90"
              @click="handleNewConnection"
            >
              <!-- Light Mode Emboss -->
              <div class="absolute inset-0 rounded-full bg-gradient-to-b from-white to-zinc-50 shadow-[0_2px_5px_rgba(0,0,0,0.06),inset_0_0_0_0.5px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] dark:hidden group-hover:shadow-[0_4px_10px_rgba(0,0,0,0.1),inset_0_0_0_0.5px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] group-active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] transition-all"></div>
              <!-- Dark Mode Emboss -->
              <div class="absolute inset-0 rounded-full bg-gradient-to-b from-zinc-700/80 to-zinc-800/80 shadow-[0_2px_5px_rgba(0,0,0,0.3),inset_0_0_0_1px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.15)] hidden dark:block group-hover:shadow-[0_4px_12px_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.15),inset_0_1px_0_rgba(255,255,255,0.25)] group-active:shadow-[inset_0_2px_6px_rgba(0,0,0,0.4)] transition-all"></div>
              
              <Plus class="relative h-[18px] w-[18px] text-zinc-500 group-hover:text-zinc-800 dark:text-zinc-400 dark:group-hover:text-white stroke-[2.5] transition-colors" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="text-[10px]">{{ t('welcome.newConnection') }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>

    <!-- Collapsed: 新建按钮 -->
    <div v-else class="flex flex-col items-center gap-1 pt-2 pb-1">
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground" @click="handleNewConnection">
              <Plus class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right"><p>{{ t('welcome.newConnection') }}</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>

    <Separator class="opacity-50" />

    <!-- 连接列表 -->
    <ScrollArea class="flex-1">
      <div v-if="!isCollapsed" class="p-1">
        <!-- 空状态 -->
        <div
          v-if="connectionStore.connectionList.length === 0 && !connectionStore.loading"
          class="flex flex-col items-center justify-center py-10 text-center"
        >
          <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted/30">
            <Database class="h-5 w-5 text-muted-foreground/30" />
          </div>
          <p class="text-xs font-semibold text-muted-foreground/80">{{ t('sidebar.noConnections') }}</p>
          <Button
            variant="outline"
            size="sm"
            class="mt-4 h-7 px-3 text-[11px]"
            @click="handleNewConnection"
          >
            <Plus class="mr-1.5 h-3 w-3" />
            {{ t('welcome.newConnection') }}
          </Button>
        </div>

        <!-- 收藏栏 (Sticky Glass Header Integration) -->
          <div v-if="connectionStore.filteredFavorites.length > 0" class="group/section relative mb-2">
            <Collapsible v-model:open="openGroups['favorites']">
              <div class="sticky top-0 z-10 backdrop-blur-md bg-background/70 dark:bg-background/80 py-1.5 mb-1 shadow-[0_4px_6px_-4px_rgba(0,0,0,0.05),inset_0_-1px_0_0_rgba(150,150,150,0.05)] pointer-events-none">
                <CollapsibleTrigger class="flex w-full items-center gap-2 px-4 text-foreground/50 hover:text-foreground/90 transition-colors pointer-events-auto">
                  <ChevronRight class="h-[14px] w-[14px] shrink-0 transition-transform duration-200" :class="{ 'rotate-90': openGroups['favorites'] }" />
                  <Star class="h-[14px] w-[14px] text-amber-500/70" />
                  <span class="text-[11px] font-bold tracking-widest flex-1 text-left truncate">{{ t('sidebar.favorites') }}</span>
                  <span class="text-[9px] font-mono tracking-widest opacity-0 group-hover/section:opacity-100 transition-opacity pr-1">{{ connectionStore.filteredFavorites.length }}</span>
                </CollapsibleTrigger>
              </div>

              <CollapsibleContent>
                <div class="flex flex-col mb-2">
          <ContextMenu v-for="conn in connectionStore.filteredFavorites" :key="'fav-' + conn.record.id">
            <ContextMenuTrigger>
              <div
                class="group relative flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 mx-1.5 mb-[3px] transform-gpu will-change-transform transition-all duration-300 hover:bg-zinc-200/60 dark:hover:bg-white/[0.08] active:scale-[0.98]"
                :class="[
                  workspace.activeTab?.connectionId === conn.record.id
                    ? 'bg-zinc-200/80 dark:bg-white/[0.12] shadow-[inset_0_0_0_1px_rgba(var(--primary-rgb),0.2)]'
                    : '',
                  draggedConnectionId === conn.record.id ? 'opacity-40 grayscale' : '',
                  dragOverConnectionId === conn.record.id ? 'bg-zinc-200/80 dark:bg-white/[0.12]' : '',
                ]"
                draggable="true"
                @dragstart="onDragStart($event, conn.record.id)"
                @dragover="onDragOver($event, conn.record.id)"
                @dragleave="onDragLeave"
                @drop="onDrop($event, conn.record.id)"
                @dragend="onDragEnd"
                @dblclick="handleDoubleClick(conn)"
              >
                <!-- 左侧激活指示条 (Apple Style Indicator) -->
                <div 
                  class="absolute left-[-2px] top-2 bottom-2 w-[3px] rounded-full bg-primary transition-all duration-500 transform-gpu origin-center"
                  :class="workspace.activeTab?.connectionId === conn.record.id ? 'scale-y-100 opacity-100' : 'scale-y-0 opacity-0'"
                />

                <!-- 颜色标签指示条 -->
                <div
                  v-if="conn.record.color"
                  class="absolute right-1 top-1.5 bottom-1.5 w-[3px] rounded-full opacity-60"
                  :style="{ backgroundColor: conn.record.color }"
                />

                <!-- 类型图标 + 状态 (Micro-Card Icon with Ambient Depth) -->
                <div class="relative flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-b from-white to-zinc-100/80 dark:from-zinc-700/50 dark:to-zinc-800/50 shadow-[0_2px_5px_rgba(0,0,0,0.04),inset_0_0_0_1px_rgba(255,255,255,0.7),inset_0_-1px_0_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_2px_8px_rgba(0,0,0,0.3)] transition-all duration-300 group-hover:scale-[1.02] group-hover:shadow-[0_4px_8px_rgba(0,0,0,0.08),inset_0_0_0_1px_rgba(255,255,255,1),inset_0_-1px_0_rgba(0,0,0,0.05)] dark:group-hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_4px_12px_rgba(0,0,0,0.5)]"
                     :class="[typeBadgeColors[conn.record.type] ?? 'text-muted-foreground']">
                  <component :is="typeIcons[conn.record.type] ?? Database" class="h-[15px] w-[15px]" :class="iconAnimClass(conn.status)" />
                  <!-- 镶嵌式 LED 状态灯 -->
                  <div class="absolute -bottom-1 -right-1 flex h-[14px] w-[14px] items-center justify-center rounded-full border-[1.5px] border-white/90 dark:border-[#2C2C2E] bg-white/50 dark:bg-black/50 backdrop-blur-sm shadow-[0_1px_2px_rgba(0,0,0,0.1)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
                    <div class="relative h-[8px] w-[8px] rounded-full overflow-hidden" :class="statusColors[conn.status] ?? statusColors.disconnected">
                      <div v-if="conn.status === 'connected'" class="absolute inset-0 rounded-full bg-emerald-400 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] opacity-75"></div>
                    </div>
                  </div>
                </div>
 
                <!-- 信息 (Typography Refinement) -->
                <div class="min-w-0 flex-1 flex flex-col justify-center h-8 relative top-[-0.5px]">
                  <div class="flex items-center gap-1.5 mb-[2px]">
                    <p class="truncate text-[13px] font-semibold tracking-tight text-zinc-800/90 dark:text-zinc-100/90 group-hover:text-primary transition-colors leading-none">{{ conn.record.name }}</p>
                    <Star class="h-[10px] w-[10px] shrink-0 text-amber-500 fill-amber-500" />
                    <!-- 环境标记 (Apple Capsule Style) -->
                    <span
                      v-if="getEnvironment(conn.record)"
                      class="shrink-0 rounded-full px-1.5 h-3.5 text-[8px] font-extrabold uppercase tracking-widest inline-flex items-center justify-center ring-1 ring-inset ring-current/20 backdrop-blur-sm leading-none -translate-y-px"
                      :style="{
                        color: ENV_PRESETS[getEnvironment(conn.record)!].color,
                        backgroundColor: ENV_PRESETS[getEnvironment(conn.record)!].color + '18',
                      }"
                    >{{ ENV_SHORT_LABELS[getEnvironment(conn.record)!] }}</span>
                  </div>
                  <p class="truncate text-[10px] font-medium text-zinc-400 dark:text-zinc-500 font-mono tracking-[0.02em] leading-none">{{ conn.record.host }}</p>
                </div>
              </div>
            </ContextMenuTrigger>
            <!-- 右键菜单 -->
            <ContextMenuContent class="w-52">
              <ContextMenuItem @click="handleDoubleClick(conn)">
                <Plug class="mr-2 h-4 w-4" />
                {{ t('connection.connect') }}
              </ContextMenuItem>
              <ContextMenuItem @click="handleTestConnection(conn.record.id)">
                <FlaskConical class="mr-2 h-4 w-4" />
                {{ t('connection.testConnection') }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem @click="handleEditConnection(conn.record)">
                <Pencil class="mr-2 h-4 w-4" />
                {{ t('connection.edit') }}
              </ContextMenuItem>
              <ContextMenuItem @click="handleDuplicateConnection(conn.record)">
                <Copy class="mr-2 h-4 w-4" />
                {{ t('connection.copyConnection') }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem @click="handleToggleFavorite(conn.record.id)">
                <StarOff class="mr-2 h-4 w-4" />
                {{ t('connection.unfavorite') }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                class="text-destructive focus:text-destructive"
                @click="handleDeleteConnection(conn.record.id, conn.record.name)"
              >
                <Trash2 class="mr-2 h-4 w-4" />
                {{ t('connection.delete') }}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <Separator v-if="connectionStore.filteredNonFavorites.length > 0" class="my-1 opacity-30" />

          <!-- 分组 (Sticky Header + Micro-Cards Transition) -->
          <div v-for="group in groupedNonFavorites" :key="group.type" class="group/section relative mb-1">
              <!-- 组标题 (Sticky Glass Header) -->
              <div class="sticky top-0 z-10 backdrop-blur-md bg-background/70 dark:bg-background/80 py-1.5 my-1 shadow-[0_4px_6px_-4px_rgba(0,0,0,0.05),inset_0_-1px_0_0_rgba(150,150,150,0.05)] cursor-pointer" @click="toggleGroup(group.type)">
                <div class="flex w-full items-center gap-2 px-4 text-foreground/50 hover:text-foreground/90 transition-colors pointer-events-auto">
                  <ChevronRight class="h-[14px] w-[14px] shrink-0 transition-transform duration-200" :class="{ 'rotate-90': !group.isCollapsed }" />
                  <component :is="group.icon" class="h-[14px] w-[14px]" />
                  <span class="text-[11px] font-bold tracking-widest flex-1 text-left truncate">{{ group.label }}</span>
                  <span class="text-[9px] font-mono tracking-widest opacity-0 group-hover/section:opacity-100 transition-opacity pr-1">{{ group.items.length }}</span>
                </div>
              </div>

              <div v-show="!group.isCollapsed">
                <div class="flex flex-col mt-0.5">
            <ContextMenu v-for="conn in group.items" :key="conn.record.id">
              <ContextMenuTrigger>
              <div
                class="group relative flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 mx-1.5 mb-[3px] transform-gpu will-change-transform transition-all duration-300 hover:bg-zinc-200/60 dark:hover:bg-white/[0.08] active:scale-[0.98]"
                :class="[
                  workspace.activeTab?.connectionId === conn.record.id
                    ? 'bg-zinc-200/80 dark:bg-white/[0.12] shadow-[inset_0_0_0_1px_rgba(var(--primary-rgb),0.2)]'
                    : '',
                  draggedConnectionId === conn.record.id ? 'opacity-40 grayscale' : '',
                  dragOverConnectionId === conn.record.id ? 'bg-zinc-200/80 dark:bg-white/[0.12]' : '',
                ]"
                draggable="true"
                @dragstart="onDragStart($event, conn.record.id)"
                @dragover="onDragOver($event, conn.record.id)"
                @dragleave="onDragLeave"
                @drop="onDrop($event, conn.record.id)"
                @dragend="onDragEnd"
                @dblclick="handleDoubleClick(conn)"
              >
                <!-- 左侧激活指示条 (Apple Style Indicator) -->
                <div 
                  class="absolute left-[-2px] top-2 bottom-2 w-[3px] rounded-full bg-primary transition-all duration-500 transform-gpu origin-center"
                  :class="workspace.activeTab?.connectionId === conn.record.id ? 'scale-y-100 opacity-100' : 'scale-y-0 opacity-0'"
                />

                <!-- 颜色标签指示条 -->
                <div
                  v-if="conn.record.color"
                  class="absolute right-1 top-1.5 bottom-1.5 w-[3px] rounded-full opacity-60"
                  :style="{ backgroundColor: conn.record.color }"
                />

                <!-- 类型图标 + 状态 (Micro-Card Icon with Ambient Depth) -->
                <div class="relative flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-b from-white to-zinc-100/80 dark:from-zinc-700/50 dark:to-zinc-800/50 shadow-[0_2px_5px_rgba(0,0,0,0.04),inset_0_0_0_1px_rgba(255,255,255,0.7),inset_0_-1px_0_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_2px_8px_rgba(0,0,0,0.3)] transition-all duration-300 group-hover:scale-[1.02] group-hover:shadow-[0_4px_8px_rgba(0,0,0,0.08),inset_0_0_0_1px_rgba(255,255,255,1),inset_0_-1px_0_rgba(0,0,0,0.05)] dark:group-hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_4px_12px_rgba(0,0,0,0.5)]"
                     :class="[typeBadgeColors[conn.record.type] ?? 'text-muted-foreground']">
                  <component :is="typeIcons[conn.record.type] ?? Database" class="h-[15px] w-[15px]" :class="iconAnimClass(conn.status)" />
                  <!-- 镶嵌式 LED 状态灯 -->
                  <div class="absolute -bottom-1 -right-1 flex h-[14px] w-[14px] items-center justify-center rounded-full border-[1.5px] border-white/90 dark:border-[#2C2C2E] bg-white/50 dark:bg-black/50 backdrop-blur-sm shadow-[0_1px_2px_rgba(0,0,0,0.1)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
                    <div class="relative h-[8px] w-[8px] rounded-full overflow-hidden" :class="statusColors[conn.status] ?? statusColors.disconnected">
                      <div v-if="conn.status === 'connected'" class="absolute inset-0 rounded-full bg-emerald-400 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] opacity-75"></div>
                    </div>
                  </div>
                </div>

                <!-- 信息 (Typography Refinement) -->
                <div class="min-w-0 flex-1 flex flex-col justify-center h-8 relative top-[-0.5px]">
                  <div class="flex items-center gap-1.5 mb-[2px]">
                    <p class="truncate text-[13px] font-semibold tracking-tight text-zinc-800/90 dark:text-zinc-100/90 group-hover:text-primary transition-colors leading-none">{{ conn.record.name }}</p>
                    <!-- 环境标记 (Apple Capsule Style) -->
                    <span
                      v-if="getEnvironment(conn.record)"
                      class="shrink-0 rounded-full px-1.5 h-3.5 text-[8px] font-extrabold uppercase tracking-widest inline-flex items-center justify-center ring-1 ring-inset ring-current/20 backdrop-blur-sm leading-none -translate-y-px"
                      :style="{
                        color: ENV_PRESETS[getEnvironment(conn.record)!].color,
                        backgroundColor: ENV_PRESETS[getEnvironment(conn.record)!].color + '18',
                      }"
                    >{{ ENV_SHORT_LABELS[getEnvironment(conn.record)!] }}</span>
                  </div>
                  <div class="flex items-center gap-1.5 overflow-hidden">
                    <p class="truncate text-[10px] font-medium text-zinc-400 dark:text-zinc-500 font-mono tracking-[0.02em] leading-none">{{ conn.record.host }}</p>
                  </div>
                </div>
              </div>
            </ContextMenuTrigger>
            <!-- 右键菜单 (省略部分重复逻辑，保持结构) -->
            <ContextMenuContent class="w-52">
              <ContextMenuItem @click="handleDoubleClick(conn)">
                <Plug class="mr-2 h-4 w-4" />
                {{ t('connection.connect') }}
              </ContextMenuItem>
              <ContextMenuItem @click="handleTestConnection(conn.record.id)">
                <FlaskConical class="mr-2 h-4 w-4" />
                {{ t('connection.testConnection') }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem @click="handleEditConnection(conn.record)">
                <Pencil class="mr-2 h-4 w-4" />
                {{ t('connection.edit') }}
              </ContextMenuItem>
              <ContextMenuItem @click="handleDuplicateConnection(conn.record)">
                <Copy class="mr-2 h-4 w-4" />
                {{ t('connection.copyConnection') }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem @click="handleToggleFavorite(conn.record.id)">
                <Star class="mr-2 h-4 w-4" />
                {{ t('connection.favorite') }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                class="text-destructive focus:text-destructive"
                @click="handleDeleteConnection(conn.record.id, conn.record.name)"
              >
                <Trash2 class="mr-2 h-4 w-4" />
                {{ t('connection.delete') }}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
                </div>
              </div>
          </div>
      </div>

      <!-- Collapsed: 连接图标列表 -->
      <div v-else class="flex flex-col items-center gap-0.5 p-1">
        <TooltipProvider :delay-duration="200">
          <Tooltip v-for="conn in connectionStore.filteredConnections" :key="conn.record.id">
            <TooltipTrigger as-child>
              <button
                class="relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent"
                @dblclick="handleDoubleClick(conn)"
              >
                <div class="flex h-7 w-7 items-center justify-center rounded-md" :class="typeBadgeColors[conn.record.type] ?? 'bg-muted text-muted-foreground'">
                  <component :is="typeIcons[conn.record.type] ?? Database" class="h-3.5 w-3.5" :class="iconAnimClass(conn.status)" />
                </div>
                <div
                  class="absolute bottom-1 right-1 h-2 w-2 rounded-full border border-sidebar"
                  :class="statusColors[conn.status] ?? 'bg-muted-foreground/30'"
                />
                <!-- 收藏标记 -->
                <Star
                  v-if="isFavorite(conn.record)"
                  class="absolute top-0.5 right-0.5 h-2 w-2 text-amber-500 fill-amber-500"
                />
                <!-- 颜色标签 -->
                <div
                  v-if="conn.record.color"
                  class="absolute left-0.5 top-1 bottom-1 w-[2px] rounded-full"
                  :style="{ backgroundColor: conn.record.color }"
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p class="font-medium">{{ conn.record.name }}</p>
              <p class="text-muted-foreground">{{ conn.record.host }}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </ScrollArea>

    <!-- Footer (Industrial Toolset) -->
    <div class="flex items-center px-3 py-3 bg-black/[0.01] dark:bg-white/[0.01] border-t border-black/[0.02] dark:border-white/5" :class="isCollapsed ? 'flex-col gap-1' : 'justify-between'">
      <TooltipProvider :delay-duration="300">
        <div class="flex items-center" :class="isCollapsed ? 'flex-col gap-1' : 'gap-1'">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-primary/10" @click="toggleTheme()">
                <component :is="themeIcon" class="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent :side="isCollapsed ? 'right' : 'top'" class="text-[11px] font-medium"><p>{{ t(`theme.${themeMode}`) }}</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-primary/10" @click="toggleLocale()">
                <Languages class="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent :side="isCollapsed ? 'right' : 'top'" class="text-[11px] font-medium"><p>{{ currentLocale === 'zh-CN' ? 'English' : '中文' }}</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-primary/10"
                @click="workspace.addTab({ id: 'multi-exec', type: 'multi-exec', title: t('tab.multiExec'), closable: true })"
              >
                <LayoutGrid class="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent :side="isCollapsed ? 'right' : 'top'" class="text-[11px] font-medium"><p>{{ t('tooltip.multiExec') }}</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-primary/10"
                @click="() => {
                  const existing = workspace.tabs.find(t => t.type === 'terminal' && t.meta?.isLocal)
                  if (existing) { workspace.activeTabId = existing.id; return }
                  workspace.addTab({ id: `local-terminal-${Date.now()}`, type: 'terminal', title: '本地终端', closable: true, meta: { isLocal: 'true' } })
                }"
              >
                <Terminal class="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent :side="isCollapsed ? 'right' : 'top'" class="text-[11px] font-medium"><p>本地终端</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-primary/10"
                @click="workspace.addTab({ id: 'settings', type: 'settings', title: t('tab.settings'), closable: true })"
              >
                <Settings class="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent :side="isCollapsed ? 'right' : 'top'" class="text-[11px] font-medium"><p>{{ t('tooltip.settings') }}</p></TooltipContent>
          </Tooltip>
        </div>
        <!-- 折叠按钮 -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-all active:scale-95"
              @click="workspace.toggleSidebar()"
            >
              <ChevronLeft
                class="h-4 w-4 transition-transform duration-[var(--df-duration-normal)]"
                :class="{ 'rotate-180': isCollapsed }"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent :side="isCollapsed ? 'right' : 'top'" class="text-[11px] font-medium"><p>{{ isCollapsed ? t('sidebar.expand') : t('sidebar.collapse') }}</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </aside>

  <!-- 颜色标签选择器浮层 -->
  <Teleport to="body">
    <div
      v-if="showColorPicker && colorPickerConnectionId"
      class="fixed z-[100] rounded-lg border border-border bg-popover p-2 shadow-lg"
      :style="{ left: colorPickerPosition.x + 'px', top: colorPickerPosition.y + 'px' }"
      @click.stop
    >
      <div class="flex items-center gap-1.5 mb-1.5">
        <span class="text-[10px] font-medium text-muted-foreground">{{ t('connection.colorLabel') }}</span>
      </div>
      <div class="flex gap-1.5 flex-wrap max-w-[160px]">
        <button
          v-for="color in colorOptions"
          :key="color"
          class="h-5 w-5 rounded-full border border-border/50 transition-all hover:scale-110 hover:shadow-md"
          :style="{ backgroundColor: color }"
          @click="handleSetColor(colorPickerConnectionId!, color)"
        />
        <!-- 清除颜色按钮 -->
        <button
          class="h-5 w-5 rounded-full border border-border/50 flex items-center justify-center transition-all hover:scale-110 hover:bg-muted"
          @click="handleSetColor(colorPickerConnectionId!, null)"
        >
          <X class="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    </div>
  </Teleport>

  <!-- Connection Dialog -->
  <ConnectionDialog
    v-model:open="showConnectionDialog"
    :editing-connection="editingConnection"
    @saved="handleConnectionSaved"
    @connect="handleConnectionConnect"
  />

  <!-- Delete Confirmation -->
  <ConfirmDialog
    v-model:open="showDeleteConfirm"
    :title="t('connection.confirmDelete')"
    :description="pendingDeleteName"
    :confirm-label="t('common.delete')"
    :cancel-label="t('common.cancel')"
    variant="destructive"
    @confirm="confirmDeleteConnection"
  />
</template>
