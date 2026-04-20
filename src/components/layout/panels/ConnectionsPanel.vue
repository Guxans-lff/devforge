<script setup lang="ts">
/**
 * Connections Panel — 连接管理面板
 *
 * 从 Sidebar.vue 提取的连接列表核心逻辑，作为 SidePanel 的子面板。
 * 包含：搜索框、收藏分组、按类型分组、新建连接、拖拽排序、右键菜单、颜色标签。
 * 上下文感知：自动高亮当前 Tab 对应的连接。
 */
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useConnectionStore, type ConnectionState } from '@/stores/connections'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import ConnectionDialog from '@/components/connection/ConnectionDialog.vue'
import ConnectionItem from '@/components/layout/sidebar/ConnectionItem.vue'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/composables/useToast'
import { updateConnection } from '@/api/connection'
import {
  Database,
  Terminal,
  FolderOpen,
  Plus,
  Search,
  Star,
  X,
  ChevronRight,
  Container,
  GitBranch,
} from 'lucide-vue-next'
import type { ConnectionRecord } from '@/api/connection'
import type { TabType } from '@/types/workspace'

const { t } = useI18n()
const workspace = useWorkspaceStore()
const connectionStore = useConnectionStore()
const toast = useToast()

// 连接对话框状态
const showConnectionDialog = ref(false)
const editingConnection = ref<ConnectionRecord | null>(null)

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
const openGroups = ref<Record<string, boolean>>({ favorites: true })

function toggleGroup(type: string) {
  const next = new Set(collapsedGroups.value)
  if (next.has(type)) {
    next.delete(type)
  } else {
    next.add(type)
  }
  collapsedGroups.value = next
}

// 预定义颜色列表
const colorOptions = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
]

const colorNameKeys: Record<string, string> = {
  '#ef4444': 'connection.colorRed',
  '#f97316': 'connection.colorOrange',
  '#eab308': 'connection.colorYellow',
  '#22c55e': 'connection.colorGreen',
  '#06b6d4': 'connection.colorCyan',
  '#3b82f6': 'connection.colorBlue',
  '#8b5cf6': 'connection.colorPurple',
  '#ec4899': 'connection.colorPink',
}

onMounted(() => {
  connectionStore.loadConnections()
  window.addEventListener('devforge:new-connection', handleNewConnection)
  document.addEventListener('click', closeColorPicker)
})

onBeforeUnmount(() => {
  window.removeEventListener('devforge:new-connection', handleNewConnection)
  document.removeEventListener('click', closeColorPicker)
})

// ─────────── 连接操作 ───────────

function handleNewConnection() {
  editingConnection.value = null
  showConnectionDialog.value = true
}

function handleEditConnection(record: ConnectionRecord) {
  editingConnection.value = record
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

async function handleConnectionConnect(connectionId: string, connectionName: string) {
  await connectionStore.loadConnections()
  const conn = connectionStore.connections.get(connectionId)
  const connType = conn?.record.type ?? 'database'
  const typeToTab: Record<string, TabType> = {
    database: 'database',
    ssh: 'terminal',
    sftp: 'file-manager',
    redis: 'redis',
    git: 'git',
  }
  const tabType = typeToTab[connType] ?? 'database'
  workspace.addTab({
    id: `${tabType}-${connectionId}`,
    type: tabType,
    title: connectionName,
    connectionId,
    closable: true,
  })
}

function handleOpenConnection(conn: ConnectionState) {
  const typeToTab: Record<string, TabType> = {
    database: 'database',
    ssh: 'terminal',
    sftp: 'file-manager',
    redis: 'redis',
    git: 'git',
  }
  const tabType = typeToTab[conn.record.type] ?? 'database'
  if (conn.record.type === 'git') {
    const repoPath = conn.record.host
    const tabId = `git-${repoPath.replace(/[\\/:]/g, '_')}`
    workspace.addTab({
      id: tabId,
      type: 'git',
      title: conn.record.name,
      closable: true,
      meta: { repositoryPath: repoPath },
    })
    return
  }
  workspace.addTab({
    id: `${tabType}-${conn.record.id}`,
    type: tabType,
    title: conn.record.name,
    connectionId: conn.record.id,
    closable: true,
  })
}

// ─────────── 收藏 / 复制 / 颜色 ───────────

async function handleToggleFavorite(connectionId: string) {
  try {
    await connectionStore.toggleConnectionFavorite(connectionId)
  } catch (e) {
    toast.error(t('connection.favoriteFailed'), String(e))
  }
}

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

// ─────────── 拖拽排序 ───────────

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

  const currentList = connectionStore.filteredConnections
  const orderedIds = currentList.map((c) => c.record.id)
  const sourceIndex = orderedIds.indexOf(sourceId)
  const targetIndex = orderedIds.indexOf(targetConnectionId)

  if (sourceIndex === -1 || targetIndex === -1) {
    draggedConnectionId.value = null
    return
  }

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

/** 将非收藏连接按类型分组 */
const groupedNonFavorites = computed(() => {
  const categories = [
    { type: 'database', label: t('welcome.database'), icon: Database },
    { type: 'ssh', label: t('welcome.terminal'), icon: Terminal },
    { type: 'sftp', label: t('welcome.files'), icon: FolderOpen },
    { type: 'redis', label: 'Redis', icon: Container },
    { type: 'git', label: t('connection.typeGit'), icon: GitBranch },
  ]

  return categories.map(cat => ({
    ...cat,
    isCollapsed: collapsedGroups.value.has(cat.type),
    items: connectionStore.filteredNonFavorites.filter(c => c.record.type === cat.type)
  })).filter(cat => cat.items.length > 0)
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 搜索框 + 新建按钮 -->
    <div class="flex items-center gap-2 px-3 pt-3 pb-2">
      <div class="group relative flex-1 flex items-center">
        <div class="absolute inset-0 rounded-full bg-muted/60 dark:bg-black/20 shadow-[inset_0_2px_4px_rgba(0,0,0,0.03),inset_0_0_0_1px_rgba(0,0,0,0.04),0_1px_0_rgba(255,255,255,0.7)] dark:shadow-[inset_0_2px_6px_rgba(0,0,0,0.4),inset_0_0_0_1px_rgba(255,255,255,0.06),0_1px_0_rgba(255,255,255,0.03)] transform-gpu transition-[background-color,box-shadow] duration-300 group-focus-within:bg-background group-focus-within:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05),0_4px_12px_rgba(0,0,0,0.05),0_0_0_2px_rgba(var(--primary-rgb),0.15)] dark:group-focus-within:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15),0_6px_20px_rgba(0,0,0,0.6),0_0_0_2px_rgba(var(--primary-rgb),0.2)]" />

        <Search class="absolute left-3.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary z-10" />
        <Input
          class="h-[34px] w-full border-none bg-transparent pl-10 pr-3 text-[13px] font-medium text-foreground placeholder:text-muted-foreground shadow-none focus-visible:ring-0 z-10"
          role="searchbox"
          :aria-label="t('sidebar.searchConnections')"
          :placeholder="t('sidebar.searchConnections')"
          :model-value="connectionStore.searchQuery"
          @update:model-value="connectionStore.setSearchQuery($event as string)"
          @keydown.escape="connectionStore.setSearchQuery('')"
        />
      </div>

      <!-- 新建连接按钮 -->
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              :aria-label="t('welcome.newConnection')"
              class="group/btn relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full transform-gpu will-change-transform transition-[scale,box-shadow] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] active:scale-90"
              @click="handleNewConnection"
            >
              <div class="absolute inset-0 rounded-full bg-gradient-to-b from-white to-zinc-50 shadow-[0_2px_5px_rgba(0,0,0,0.06),inset_0_0_0_0.5px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] dark:hidden group-hover/btn:shadow-[0_4px_10px_rgba(0,0,0,0.1),inset_0_0_0_0.5px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] group-active/btn:shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] transition-shadow" />
              <div class="absolute inset-0 rounded-full bg-gradient-to-b from-zinc-700/80 to-zinc-800/80 shadow-[0_2px_5px_rgba(0,0,0,0.3),inset_0_0_0_1px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.15)] hidden dark:block group-hover/btn:shadow-[0_4px_12px_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.15),inset_0_1px_0_rgba(255,255,255,0.25)] group-active/btn:shadow-[inset_0_2px_6px_rgba(0,0,0,0.4)] transition-shadow" />
              <Plus class="relative h-[18px] w-[18px] text-muted-foreground group-hover/btn:text-foreground stroke-[2.5] transition-colors" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="text-[10px]">{{ t('welcome.newConnection') }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>

    <Separator class="opacity-50" />

    <!-- 连接列表 -->
    <ScrollArea class="flex-1 min-h-0">
      <div class="p-1" role="listbox" :aria-label="t('sidebar.connections')">
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

        <!-- 收藏栏 -->
        <div v-if="connectionStore.filteredFavorites.length > 0" class="group/section relative mb-2">
          <Collapsible v-model:open="openGroups['favorites']">
            <div class="sticky top-0 z-10 backdrop-blur-md bg-background/70 dark:bg-background/80 py-1.5 mb-1 shadow-[0_4px_6px_-4px_rgba(0,0,0,0.05),inset_0_-1px_0_0_rgba(150,150,150,0.05)] pointer-events-none">
              <CollapsibleTrigger class="flex w-full items-center gap-2 px-4 text-foreground/50 hover:text-foreground/90 transition-colors pointer-events-auto">
                <ChevronRight class="h-[14px] w-[14px] shrink-0 transition-transform duration-200" :class="{ 'rotate-90': openGroups['favorites'] }" />
                <Star class="h-[14px] w-[14px] text-df-warning/70" />
                <span class="text-[11px] font-bold tracking-widest flex-1 text-left truncate">{{ t('sidebar.favorites') }}</span>
                <span class="text-[9px] font-mono tracking-widest opacity-0 group-hover/section:opacity-100 transition-opacity pr-1">{{ connectionStore.filteredFavorites.length }}</span>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent>
              <div class="flex flex-col mb-2">
                <ConnectionItem
                  v-for="conn in connectionStore.filteredFavorites"
                  :key="'fav-' + conn.record.id"
                  :conn="conn"
                  :is-active="workspace.activeTab?.connectionId === conn.record.id"
                  :is-favorite="true"
                  :is-dragging="draggedConnectionId === conn.record.id"
                  :is-drag-over="dragOverConnectionId === conn.record.id"
                  @open="handleOpenConnection"
                  @edit="handleEditConnection"
                  @duplicate="handleDuplicateConnection"
                  @delete="handleDeleteConnection"
                  @test="handleTestConnection"
                  @toggle-favorite="handleToggleFavorite"
                  @drag-start="onDragStart"
                  @drag-over="onDragOver"
                  @drag-leave="onDragLeave"
                  @drop="onDrop"
                  @drag-end="onDragEnd"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <Separator v-if="connectionStore.filteredNonFavorites.length > 0" class="my-1 opacity-30" />

        <!-- 按类型分组 -->
        <div v-for="group in groupedNonFavorites" :key="group.type" class="group/section relative mb-1">
          <div
            role="button"
            :tabindex="0"
            :aria-expanded="!group.isCollapsed"
            :aria-label="group.label"
            class="sticky top-0 z-10 backdrop-blur-md bg-background/70 dark:bg-background/80 py-1.5 my-1 shadow-[0_4px_6px_-4px_rgba(0,0,0,0.05),inset_0_-1px_0_0_rgba(150,150,150,0.05)] cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
            @click="toggleGroup(group.type)"
            @keydown.enter.prevent="toggleGroup(group.type)"
            @keydown.space.prevent="toggleGroup(group.type)"
          >
            <div class="flex w-full items-center gap-2 px-4 text-foreground/50 hover:text-foreground/90 transition-colors pointer-events-auto">
              <ChevronRight class="h-[14px] w-[14px] shrink-0 transition-transform duration-200" :class="{ 'rotate-90': !group.isCollapsed }" />
              <component :is="group.icon" class="h-[14px] w-[14px]" />
              <span class="text-[11px] font-bold tracking-widest flex-1 text-left truncate">{{ group.label }}</span>
              <span class="text-[9px] font-mono tracking-widest opacity-0 group-hover/section:opacity-100 transition-opacity pr-1">{{ group.items.length }}</span>
            </div>
          </div>

          <div v-show="!group.isCollapsed">
            <div class="flex flex-col mt-0.5">
              <ConnectionItem
                v-for="conn in group.items"
                :key="conn.record.id"
                :conn="conn"
                :is-active="workspace.activeTab?.connectionId === conn.record.id"
                :is-favorite="false"
                :is-dragging="draggedConnectionId === conn.record.id"
                :is-drag-over="dragOverConnectionId === conn.record.id"
                @open="handleOpenConnection"
                @edit="handleEditConnection"
                @duplicate="handleDuplicateConnection"
                @delete="handleDeleteConnection"
                @test="handleTestConnection"
                @toggle-favorite="handleToggleFavorite"
                @drag-start="onDragStart"
                @drag-over="onDragOver"
                @drag-leave="onDragLeave"
                @drop="onDrop"
                @drag-end="onDragEnd"
              />
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>

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
          :aria-label="t(colorNameKeys[color] ?? 'connection.colorLabel')"
          class="h-5 w-5 rounded-full border border-border/50 transition-[scale,box-shadow] hover:scale-110 hover:shadow-md"
          :style="{ backgroundColor: color }"
          @click="handleSetColor(colorPickerConnectionId!, color)"
        />
        <button
          :aria-label="t('connection.clearColor')"
          class="h-5 w-5 rounded-full border border-border/50 flex items-center justify-center transition-[scale,background-color] hover:scale-110 hover:bg-muted"
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
