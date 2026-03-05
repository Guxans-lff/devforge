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
  ArrowRight,
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

// Delete confirmation state
const showDeleteConfirm = ref(false)
const pendingDeleteId = ref<string | null>(null)
const pendingDeleteName = ref('')

onMounted(() => {
  connectionStore.loadConnections()

  // 监听来自命令面板或其他地方的新建连接请求
  window.addEventListener('devforge:new-connection', handleNewConnection)
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
  database: 'bg-blue-500/15 text-blue-500',
  ssh: 'bg-emerald-500/15 text-emerald-500',
  sftp: 'bg-amber-500/15 text-amber-500',
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
    // error is already stored in state
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
          class="h-7 border-border bg-background/50 pl-8 pr-10 text-[11px] select-text shadow-none focus-visible:ring-1 focus-visible:ring-primary/40 transition-all hover:bg-background/80"
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

        <!-- 连接项 -->
        <ContextMenu v-for="conn in connectionStore.filteredConnections" :key="conn.record.id">
          <ContextMenuTrigger>
            <div
              class="group relative flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-all duration-200 hover:bg-accent active:bg-accent/80 border border-transparent hover:border-border/50"
              @dblclick="handleDoubleClick(conn)"
            >
              <!-- 类型图标 + 状态 -->
              <div class="relative flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border/20 transition-all duration-200" 
                   :class="[typeBadgeColors[conn.record.type] ?? 'bg-muted text-muted-foreground']">
                <component :is="typeIcons[conn.record.type] ?? Database" class="h-3.5 w-3.5" />
                <!-- 状态指示灯 -->
                <div class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-background flex items-center justify-center overflow-hidden bg-background">
                  <div class="relative h-1.5 w-1.5 rounded-full" :class="statusColors[conn.status] ?? 'bg-muted-foreground/30'" />
                </div>
              </div>

              <!-- 信息 -->
              <div class="min-w-0 flex-1">
                <p class="truncate text-[12px] font-semibold text-foreground/90 group-hover:text-primary transition-colors">{{ conn.record.name }}</p>
                <div class="flex items-center gap-1.5 overflow-hidden">
                   <span class="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/50 shrink-0">{{ typeLabels[conn.record.type] ?? 'DB' }}</span>
                   <p class="truncate text-[10px] text-muted-foreground/60 font-mono tracking-tight">{{ conn.record.host }}</p>
                </div>
              </div>

              <!-- 悬挂指示器 -->
              <div class="h-1 w-1 rounded-full bg-primary opacity-0 group-hover:opacity-60 transition-opacity" />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent class="w-48">
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
