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
  database: 'bg-muted/20 text-muted-foreground group-hover:text-blue-500 group-hover:bg-blue-500/10 group-hover:border-blue-500/30',
  ssh: 'bg-muted/20 text-muted-foreground group-hover:text-emerald-500 group-hover:bg-emerald-500/10 group-hover:border-emerald-500/30',
  sftp: 'bg-muted/20 text-muted-foreground group-hover:text-amber-500 group-hover:bg-amber-500/10 group-hover:border-amber-500/30',
}

const statusColors: Record<string, string> = {
  connected: 'bg-emerald-500 shadow-emerald-500/40 shadow-[0_0_4px]',
  disconnected: 'bg-muted-foreground/30',
  connecting: 'bg-amber-500 animate-pulse',
  error: 'bg-destructive shadow-destructive/40 shadow-[0_0_4px] animate-shake',
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
    <!-- Header: 搜索 + 新建 (Physical Inset Design) -->
    <div v-if="!isCollapsed" class="flex flex-col gap-3 px-4 pt-5 pb-3">
      <div class="flex items-center justify-between mb-1">
        <span class="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/30">{{ t('sidebar.workspace') || 'Workspace' }}</span>
        <TooltipProvider :delay-duration="300">
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex h-5 w-5 items-center justify-center rounded-md border border-black/[0.05] dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] transition-all hover:bg-primary hover:text-white active:scale-90"
                @click="handleNewConnection"
              >
                <Plus class="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" class="text-[10px]">{{ t('welcome.newConnection') }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div class="group relative flex items-center">
        <!-- 物理槽体容器 (Physical Groove Container) -->
        <div class="absolute inset-0 rounded-xl bg-black/[0.04] dark:bg-white/[0.02] shadow-[inset_0_2px_4px_rgba(0,0,0,0.06),inset_0_1px_1px_rgba(0,0,0,0.04),0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4),0_1px_0_rgba(255,255,255,0.05)] transition-all duration-300 group-focus-within:bg-white dark:group-focus-within:bg-black/40 group-focus-within:shadow-[inset_0_1px_2px_rgba(0,0,0,0.1),0_0_0_1px_var(--primary)]" />
        
        <Search class="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/20 transition-colors group-focus-within:text-primary z-10" />
        <Input
          class="h-9 w-full border-none bg-transparent pl-9 pr-10 text-[11px] font-medium placeholder:text-foreground/20 shadow-none focus-visible:ring-0 z-10"
          :placeholder="t('sidebar.searchConnections')"
          :model-value="connectionStore.searchQuery"
          @update:model-value="connectionStore.setSearchQuery($event as string)"
        />
        <div class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-focus-within:opacity-100 transition-opacity z-10">
           <span class="text-[9px] font-bold text-foreground/20 bg-foreground/5 px-1 rounded uppercase">Esc</span>
        </div>
      </div>
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

        <!-- 收藏区域 -->
        <template v-if="connectionStore.filteredFavorites.length > 0">
          <div class="flex items-center gap-1.5 px-2 pt-2 pb-1 opacity-50">
            <Star class="h-3.5 w-3.5 text-amber-500" />
            <span class="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/60">{{ t('connection.favorites') }}</span>
          </div>

          <!-- 收藏连接项 -->
          <ContextMenu v-for="conn in connectionStore.filteredFavorites" :key="'fav-' + conn.record.id">
            <ContextMenuTrigger>
              <div
                class="group relative flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 transition-all duration-300 hover:bg-white dark:hover:bg-white/5 active:bg-accent/80 border border-transparent hover:border-border/50 hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.05)]"
                :class="{
                  'opacity-50': draggedConnectionId === conn.record.id,
                  'border-primary/50 bg-primary/5': dragOverConnectionId === conn.record.id,
                }"
                draggable="true"
                @dragstart="onDragStart($event, conn.record.id)"
                @dragover="onDragOver($event, conn.record.id)"
                @dragleave="onDragLeave"
                @drop="onDrop($event, conn.record.id)"
                @dragend="onDragEnd"
                @dblclick="handleDoubleClick(conn)"
              >
                <!-- 颜色标签指示条 -->
                <div
                  v-if="conn.record.color"
                  class="absolute left-0 top-1 bottom-1 w-[3px] rounded-full"
                  :style="{ backgroundColor: conn.record.color }"
                />

                <!-- 类型图标 + 状态 -->
                <div class="relative flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border/10 transition-all duration-300"
                     :class="[typeBadgeColors[conn.record.type] ?? 'bg-muted text-muted-foreground']"
                     :style="conn.record.color ? { marginLeft: '4px' } : {}">
                  <component :is="typeIcons[conn.record.type] ?? Database" class="h-3.5 w-3.5" :class="iconAnimClass(conn.status)" />
                  <div class="absolute -bottom-0.5 -right-0.5 h-2 w-2.5 rounded-full border border-background flex items-center justify-center overflow-hidden bg-background shadow-xs">
                    <div class="relative h-1.5 w-1.5 rounded-full" :class="statusColors[conn.status] ?? 'bg-muted-foreground/30'" />
                  </div>
                </div>

                <!-- 信息 -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1">
                    <p class="truncate text-[12px] font-semibold text-foreground/90 group-hover:text-primary transition-colors">{{ conn.record.name }}</p>
                    <Star class="h-3 w-3 shrink-0 text-amber-500 fill-amber-500" />
                    <!-- 环境标记 -->
                    <span
                      v-if="getEnvironment(conn.record)"
                      class="shrink-0 rounded px-1 py-px text-[8px] font-bold uppercase leading-none"
                      :style="{
                        color: ENV_PRESETS[getEnvironment(conn.record)!].color,
                        backgroundColor: ENV_PRESETS[getEnvironment(conn.record)!].color + '18',
                      }"
                    >{{ ENV_SHORT_LABELS[getEnvironment(conn.record)!] }}</span>
                  </div>
                  <p class="truncate text-[10px] text-muted-foreground/50 font-mono tracking-tight">{{ conn.record.host }}</p>
                </div>

                <div class="h-1 w-1 rounded-full bg-primary opacity-0 group-hover:opacity-60 transition-opacity" />
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

          <Separator v-if="connectionStore.filteredNonFavorites.length > 0" class="my-1 opacity-30" />
        </template>

        <!-- 分组展示普通连接项 -->
        <template v-for="group in groupedNonFavorites" :key="group.type">
          <div 
            class="flex items-center gap-2 px-2 pt-2.5 pb-1 cursor-pointer group/title select-none transition-colors hover:text-primary"
            @click="toggleGroup(group.type)"
          >
            <ChevronDown 
              class="h-3.5 w-3.5 text-muted-foreground/30 transition-transform duration-300"
              :class="{ '-rotate-90': group.isCollapsed }"
            />
            <component :is="group.icon" class="h-3.5 w-3.5 text-muted-foreground/50" />
            <span class="text-[10px] font-bold uppercase tracking-[0.15em] whitespace-nowrap text-muted-foreground/60 group-hover/title:text-primary/70 transition-colors">{{ group.label }}</span>
            <div class="h-[1px] flex-1 bg-border/5 ml-1"></div>
          </div>
          
          <div v-show="!group.isCollapsed" class="space-y-0.5">
            <ContextMenu v-for="conn in group.items" :key="conn.record.id">
              <ContextMenuTrigger>
              <div
                class="group relative flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 transition-all duration-300 hover:bg-white dark:hover:bg-white/5 active:bg-accent/80 border border-transparent hover:border-border/50 hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.05)]"
                :class="{
                  'opacity-50': draggedConnectionId === conn.record.id,
                  'border-primary/50 bg-primary/5': dragOverConnectionId === conn.record.id,
                }"
                draggable="true"
                @dragstart="onDragStart($event, conn.record.id)"
                @dragover="onDragOver($event, conn.record.id)"
                @dragleave="onDragLeave"
                @drop="onDrop($event, conn.record.id)"
                @dragend="onDragEnd"
                @dblclick="handleDoubleClick(conn)"
              >
                <!-- 颜色标签指示条 -->
                <div
                  v-if="conn.record.color"
                  class="absolute left-0 top-1 bottom-1 w-[3px] rounded-full"
                  :style="{ backgroundColor: conn.record.color }"
                />

                <!-- 类型图标 + 状态 -->
                <div class="relative flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border/10 transition-all duration-300"
                     :class="[typeBadgeColors[conn.record.type] ?? 'bg-muted text-muted-foreground']"
                     :style="conn.record.color ? { marginLeft: '4px' } : {}">
                  <component :is="typeIcons[conn.record.type] ?? Database" class="h-3.5 w-3.5" :class="iconAnimClass(conn.status)" />
                  <div class="absolute -bottom-0.5 -right-0.5 h-2 w-2.5 rounded-full border border-background flex items-center justify-center overflow-hidden bg-background shadow-xs">
                    <div class="relative h-1.5 w-1.5 rounded-full" :class="statusColors[conn.status] ?? 'bg-muted-foreground/30'" />
                  </div>
                </div>

                <!-- 信息 -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1">
                    <p class="truncate text-[12px] font-semibold text-foreground/90 group-hover:text-primary transition-colors">{{ conn.record.name }}</p>
                    <!-- 环境标记 -->
                    <span
                      v-if="getEnvironment(conn.record)"
                      class="shrink-0 rounded px-1 py-px text-[8px] font-bold uppercase leading-none"
                      :style="{
                        color: ENV_PRESETS[getEnvironment(conn.record)!].color,
                        backgroundColor: ENV_PRESETS[getEnvironment(conn.record)!].color + '18',
                      }"
                    >{{ ENV_SHORT_LABELS[getEnvironment(conn.record)!] }}</span>
                  </div>
                  <div class="flex items-center gap-1.5 overflow-hidden">
                    <p class="truncate text-[10px] text-muted-foreground/50 font-mono tracking-tight">{{ conn.record.host }}</p>
                  </div>
                </div>

                <div class="h-1 w-1 rounded-full bg-primary opacity-0 group-hover:opacity-60 transition-opacity" />
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
        </template>
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
