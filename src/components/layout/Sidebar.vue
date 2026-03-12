<script setup lang="ts">
import { computed, ref, onMounted, nextTick } from 'vue'
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
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import ConnectionDialog from '@/components/connection/ConnectionDialog.vue'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/composables/useToast'
import { parseIsFavorite, updateConnection } from '@/api/connection'
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
  FolderInput,
  Palette,
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
const typeLabels: Record<string, string> = {
  database: 'DB',
  ssh: 'SSH',
  sftp: 'SFTP',
}

const typeBadgeColors: Record<string, string> = {
  database: 'bg-muted/20 text-muted-foreground group-hover:text-blue-500 group-hover:bg-blue-500/10 group-hover:border-blue-500/30',
  ssh: 'bg-muted/20 text-muted-foreground group-hover:text-emerald-500 group-hover:bg-emerald-500/10 group-hover:border-emerald-500/30',
  sftp: 'bg-muted/20 text-muted-foreground group-hover:text-amber-500 group-hover:bg-amber-500/10 group-hover:border-amber-500/30',
}

const statusColors: Record<string, string> = {
  connected: 'bg-emerald-500 shadow-emerald-500/40 shadow-[0_0_4px]',
  disconnected: 'bg-muted-foreground/30',
  connecting: 'bg-amber-500 animate-pulse',
  error: 'bg-destructive shadow-destructive/40 shadow-[0_0_4px]',
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

// --- 移动到分组 ---
async function handleMoveToGroup(connectionId: string, groupId: string | null) {
  try {
    await connectionStore.moveConnectionToGroup(connectionId, groupId)
  } catch (e) {
    toast.error(t('connection.moveFailed'), String(e))
  }
}

// --- 颜色标签 ---
function openColorPicker(connectionId: string, event: MouseEvent) {
  colorPickerConnectionId.value = connectionId
  colorPickerPosition.value = { x: event.clientX, y: event.clientY }
  // 延迟显示，避免被 document click 立即关闭
  nextTick(() => {
    showColorPicker.value = true
  })
}

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
    class="flex h-full flex-col glass-sidebar transition-[width] duration-[var(--df-duration-normal)] ease-[var(--df-ease-out)] relative z-20"
    :style="{ width: isCollapsed ? '48px' : `${workspace.panelState.sidebarWidth}px` }"
  >
    <!-- Header: 搜索 + 新建 -->
    <div v-if="!isCollapsed" class="flex items-center gap-1.5 px-3 pt-3 pb-2">
      <div class="group relative flex-1">
        <Search class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50 transition-colors group-focus-within:text-primary" />
        <Input
          class="h-7 border-border bg-background pl-8 pr-10 text-[11px] select-text shadow-none focus-visible:ring-1 focus-visible:ring-primary/40 transition-all hover:bg-background/80"
          :placeholder="t('sidebar.searchConnections')"
          :model-value="connectionStore.searchQuery"
          @update:model-value="connectionStore.setSearchQuery($event as string)"
        />
      </div>
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="icon"
              class="h-7 w-7 shrink-0 border-border bg-background/50 shadow-none transition-all hover:bg-primary hover:text-primary-foreground hover:border-primary"
              @click="handleNewConnection"
            >
              <Plus class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="text-[10px] font-medium">{{ t('welcome.newConnection') }}</TooltipContent>
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
                class="group relative flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-all duration-200 hover:bg-accent active:bg-accent/80 border border-transparent hover:border-border/50"
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
                  <component :is="typeIcons[conn.record.type] ?? Database" class="h-3.5 w-3.5" />
                  <div class="absolute -bottom-0.5 -right-0.5 h-2 w-2.5 rounded-full border border-background flex items-center justify-center overflow-hidden bg-background shadow-xs">
                    <div class="relative h-1.5 w-1.5 rounded-full" :class="statusColors[conn.status] ?? 'bg-muted-foreground/30'" />
                  </div>
                </div>

                <!-- 信息 -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1">
                    <p class="truncate text-[12px] font-semibold text-foreground/90 group-hover:text-primary transition-colors">{{ conn.record.name }}</p>
                    <Star class="h-3 w-3 shrink-0 text-amber-500 fill-amber-500" />
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
                class="group relative flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-all duration-200 hover:bg-accent active:bg-accent/80 border border-transparent hover:border-border/50"
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
                  <component :is="typeIcons[conn.record.type] ?? Database" class="h-3.5 w-3.5" />
                  <div class="absolute -bottom-0.5 -right-0.5 h-2 w-2.5 rounded-full border border-background flex items-center justify-center overflow-hidden bg-background shadow-xs">
                    <div class="relative h-1.5 w-1.5 rounded-full" :class="statusColors[conn.status] ?? 'bg-muted-foreground/30'" />
                  </div>
                </div>

                <!-- 信息 -->
                <div class="min-w-0 flex-1">
                  <p class="truncate text-[12px] font-semibold text-foreground/90 group-hover:text-primary transition-colors">{{ conn.record.name }}</p>
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
                  <component :is="typeIcons[conn.record.type] ?? Database" class="h-3.5 w-3.5" />
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

    <!-- Footer -->
    <Separator />
    <div class="flex items-center px-2 py-2" :class="isCollapsed ? 'flex-col gap-1' : 'justify-between'">
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
