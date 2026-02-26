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
} from 'lucide-vue-next'
import type { TabType } from '@/types/workspace'
import type { ConnectionRecord } from '@/api/connection'

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
})

const themeIcon = computed(() => {
  if (themeMode.value === 'dark') return Moon
  if (themeMode.value === 'light') return Sun
  return Monitor
})

const typeIcons: Record<string, typeof Database> = {
  database: Database,
  ssh: Terminal,
  sftp: FolderOpen,
}

function openNewTab(type: TabType) {
  const id = `${type}-${Date.now()}`
  const titleMap: Record<string, string> = {
    database: t('tab.newQuery'),
    terminal: t('tab.terminal'),
    'file-manager': t('tab.files'),
  }
  workspace.addTab({
    id,
    type,
    title: titleMap[type] ?? type,
    closable: true,
  })
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
    class="flex h-full flex-col border-r border-border bg-sidebar transition-[width] duration-[var(--df-duration-normal)] ease-[var(--df-ease-out)]"
    :style="{ width: isCollapsed ? '48px' : `${workspace.panelState.sidebarWidth}px` }"
  >
    <!-- Sidebar Header -->
    <div class="flex h-12 items-center justify-between px-3">
      <span
        v-if="!isCollapsed"
        class="text-sm font-semibold tracking-tight text-sidebar-foreground"
      >
        {{ t('app.name') }}
      </span>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 text-muted-foreground hover:text-foreground"
        @click="workspace.toggleSidebar()"
      >
        <ChevronLeft
          class="h-4 w-4 transition-transform duration-[var(--df-duration-normal)]"
          :class="{ 'rotate-180': isCollapsed }"
        />
      </Button>
    </div>

    <Separator />

    <!-- Quick Actions -->
    <div v-if="!isCollapsed" class="flex gap-1 px-2 py-2">
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground" @click="openNewTab('database')">
              <Database class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>{{ t('tooltip.newDatabase') }}</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground" @click="openNewTab('terminal')">
              <Terminal class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>{{ t('tooltip.newTerminal') }}</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground" @click="openNewTab('file-manager')">
              <FolderOpen class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>{{ t('tooltip.newFileTransfer') }}</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>

    <!-- Collapsed Quick Actions -->
    <div v-else class="flex flex-col items-center gap-1 py-2">
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground" @click="openNewTab('database')">
              <Database class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right"><p>{{ t('tooltip.database') }}</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground" @click="openNewTab('terminal')">
              <Terminal class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right"><p>{{ t('tooltip.terminal') }}</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground" @click="openNewTab('file-manager')">
              <FolderOpen class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right"><p>{{ t('tooltip.files') }}</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>

    <Separator />

    <!-- Search -->
    <div v-if="!isCollapsed" class="px-2 py-2">
      <div class="relative">
        <Search class="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          class="h-8 pl-8 text-xs select-text"
          :placeholder="t('sidebar.searchConnections')"
          :model-value="connectionStore.searchQuery"
          @update:model-value="connectionStore.setSearchQuery($event as string)"
        />
      </div>
    </div>

    <!-- Connection List -->
    <ScrollArea class="flex-1">
      <div v-if="!isCollapsed" class="px-2 py-1">
        <div class="flex items-center justify-between px-1 py-1">
          <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {{ t('sidebar.connections') }}
          </span>
          <Button
            variant="ghost"
            size="icon"
            class="h-5 w-5 text-muted-foreground hover:text-foreground"
            @click="handleNewConnection"
          >
            <Plus class="h-3 w-3" />
          </Button>
        </div>

        <!-- Empty state -->
        <div
          v-if="connectionStore.connectionList.length === 0 && !connectionStore.loading"
          class="flex flex-col items-center justify-center py-8 text-center"
        >
          <Database class="mb-2 h-8 w-8 text-muted-foreground/50" />
          <p class="text-xs text-muted-foreground">{{ t('sidebar.noConnections') }}</p>
          <p class="mt-1 text-xs text-muted-foreground/70">
            {{ t('sidebar.noConnectionsHint') }}
          </p>
        </div>

        <!-- Connection items with context menu -->
        <ContextMenu v-for="conn in connectionStore.filteredConnections" :key="conn.record.id">
          <ContextMenuTrigger>
            <div
              class="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-[var(--df-duration-fast)]"
              @dblclick="handleDoubleClick(conn)"
            >
              <!-- Status indicator -->
              <div
                class="h-2 w-2 shrink-0 rounded-full"
                :class="{
                  'bg-[var(--df-success)]': conn.status === 'connected',
                  'bg-muted-foreground': conn.status === 'disconnected',
                  'bg-[var(--df-warning)] animate-pulse': conn.status === 'connecting',
                  'bg-destructive': conn.status === 'error',
                }"
              />
              <!-- Type icon -->
              <component :is="typeIcons[conn.record.type] ?? Database" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <!-- Name -->
              <span class="truncate">{{ conn.record.name }}</span>
              <!-- Host badge -->
              <span class="ml-auto truncate text-[10px] text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity">
                {{ conn.record.host }}
              </span>
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
    </ScrollArea>

    <!-- Sidebar Footer -->
    <Separator />
    <div class="flex items-center gap-1 p-2" :class="{ 'flex-col': isCollapsed }">
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground" @click="toggleTheme()">
              <component :is="themeIcon" class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent :side="isCollapsed ? 'right' : 'top'"><p>{{ t(`theme.${themeMode}`) }}</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground" @click="toggleLocale()">
              <Languages class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent :side="isCollapsed ? 'right' : 'top'"><p>{{ currentLocale === 'zh-CN' ? 'English' : '中文' }}</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 text-muted-foreground hover:text-foreground"
              @click="workspace.addTab({ id: 'settings', type: 'settings', title: t('tab.settings'), closable: true })"
            >
              <Settings class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent :side="isCollapsed ? 'right' : 'top'"><p>{{ t('tooltip.settings') }}</p></TooltipContent>
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
