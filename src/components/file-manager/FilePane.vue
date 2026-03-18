<script lang="ts">
// Module-level global variable shared across all FilePane instances
let dragSourcePanel: string | null = null
</script>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import PathBar from './PathBar.vue'
import {
  Folder,
  File,
  FolderPlus,
  Trash2,
  Pencil,
  Download,
  Upload,
  Loader2,
  FileEdit,
  Shield,
  ArrowLeftRight,
} from 'lucide-vue-next'
import type { FileEntry } from '@/types/fileManager'

const props = defineProps<{
  label: string
  panelId: 'local' | 'remote' // Fixed identifier for drag & drop
  entries: FileEntry[]
  currentPath: string
  loading: boolean
  showTransferAction?: 'upload' | 'download'
}>()

const emit = defineEmits<{
  navigate: [path: string]
  refresh: []
  mkdir: [name: string]
  delete: [entry: FileEntry]
  rename: [entry: FileEntry, newName: string]
  transfer: [entry: FileEntry]
  batchTransfer: [entries: FileEntry[]]
  batchDelete: [entries: FileEntry[]]
  pathInput: [path: string]
  dropFiles: [entries: FileEntry[], targetPath: string]
  dropExternal: [files: File[]]
  addBookmark: [path: string]
  editFile: [entry: FileEntry]
  showPermissions: [entry: FileEntry]
  compareFile: [entry: FileEntry]
  search: []
}>()

const { t } = useI18n()
const selectedEntries = ref<Set<string>>(new Set())

const showMkdirDialog = ref(false)
const mkdirName = ref('')
const showRenameDialog = ref(false)
const renameName = ref('')
const renameTarget = ref<FileEntry | null>(null)

// Drag and drop state
const isDragging = ref(false)
const dragOverPath = ref<string | null>(null)
const dragCounter = ref(0)
const draggedEntries = ref<FileEntry[]>([])

// Virtual scroll
const scrollContainerRef = ref<HTMLDivElement | null>(null)
const ROW_HEIGHT = 28

const virtualizer = useVirtualizer({
  get count() { return props.entries.length },
  getScrollElement: () => scrollContainerRef.value,
  estimateSize: () => ROW_HEIGHT,
  overscan: 10,
})
const selectedCount = computed(() => selectedEntries.value.size)
const selectedItems = computed(() =>
  props.entries.filter(e => selectedEntries.value.has(e.path))
)

watch(
  () => props.currentPath,
  () => {
    clearSelection()
  },
)

function handleDoubleClick(entry: FileEntry) {
  if (entry.isDir) {
    emit('navigate', entry.path)
  } else if (props.panelId === 'remote') {
    emit('editFile', entry)
  }
}

function handleClick(entry: FileEntry, event: MouseEvent) {
  if (event.ctrlKey || event.metaKey) {
    // Toggle selection
    if (selectedEntries.value.has(entry.path)) {
      selectedEntries.value.delete(entry.path)
    } else {
      selectedEntries.value.add(entry.path)
    }
    selectedEntries.value = new Set(selectedEntries.value)
  } else if (event.shiftKey && selectedEntries.value.size > 0) {
    // Range selection
    const lastSelected = Array.from(selectedEntries.value).pop()
    const lastIndex = props.entries.findIndex(e => e.path === lastSelected)
    const currentIndex = props.entries.findIndex(e => e.path === entry.path)

    if (lastIndex !== -1 && currentIndex !== -1) {
      const start = Math.min(lastIndex, currentIndex)
      const end = Math.max(lastIndex, currentIndex)

      for (let i = start; i <= end; i++) {
        const item = props.entries[i]
        if (item) {
          selectedEntries.value.add(item.path)
        }
      }
      selectedEntries.value = new Set(selectedEntries.value)
    }
  } else {
    // Single selection
    selectedEntries.value.clear()
    selectedEntries.value.add(entry.path)
    selectedEntries.value = new Set(selectedEntries.value)
  }
}

function handleContextMenu(entry: FileEntry) {
  // If right-clicking on an unselected item, select only that item
  if (!selectedEntries.value.has(entry.path)) {
    selectedEntries.value.clear()
    selectedEntries.value.add(entry.path)
    selectedEntries.value = new Set(selectedEntries.value)
  }
  // If right-clicking on a selected item, keep the current selection
}

function selectAll() {
  selectedEntries.value = new Set(props.entries.map(e => e.path))
}

function clearSelection() {
  selectedEntries.value.clear()
  selectedEntries.value = new Set(selectedEntries.value)
}

function isSelected(entry: FileEntry): boolean {
  return selectedEntries.value.has(entry.path)
}

function navigateUp() {
  const parts = props.currentPath.replace(/\\/g, '/').replace(/\/$/, '').split('/')
  if (parts.length <= 1) return
  parts.pop()
  const parent = parts.join('/') || '/'
  emit('navigate', parent)
}

function handleMkdir() {
  if (mkdirName.value.trim()) {
    emit('mkdir', mkdirName.value.trim())
    mkdirName.value = ''
    showMkdirDialog.value = false
  }
}

function handleRename() {
  if (renameTarget.value && renameName.value.trim()) {
    emit('rename', renameTarget.value, renameName.value.trim())
    renameName.value = ''
    renameTarget.value = null
    showRenameDialog.value = false
  }
}

function openRenameDialog(entry: FileEntry) {
  renameTarget.value = entry
  renameName.value = entry.name
  showRenameDialog.value = true
}

function handleTransferSelected() {
  if (selectedItems.value.length === 1) {
    const item = selectedItems.value[0]
    if (item) {
      emit('transfer', item)
    }
  }
}

function handleBatchTransfer() {
  emit('batchTransfer', selectedItems.value)
}

function handleDeleteSelected() {
  if (selectedItems.value.length === 1) {
    const item = selectedItems.value[0]
    if (item) {
      emit('delete', item)
    }
  }
}

function handleBatchDelete() {
  emit('batchDelete', selectedItems.value)
}

function handlePathNavigate(path: string) {
  emit('pathInput', path)
}


function handleKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    e.preventDefault()
    selectAll()
  } else if (e.key === 'Escape') {
    clearSelection()
  }
}

// ==================== Drag and Drop Handlers ====================

function handleDragStart(entry: FileEntry, event: DragEvent) {
  if (!event.dataTransfer) return

  // If dragging a selected item, drag all selected items
  if (selectedEntries.value.has(entry.path)) {
    draggedEntries.value = selectedItems.value
  } else {
    draggedEntries.value = [entry]
  }

  // Set drag source panel globally using panelId
  dragSourcePanel = props.panelId

  // Set drag data with panel identifier
  event.dataTransfer.effectAllowed = 'copyMove'
  const dragData = {
    entries: draggedEntries.value,
    sourcePanel: props.panelId, // Use panelId instead of label
  }
  event.dataTransfer.setData('application/devforge-entries', JSON.stringify(dragData))

  // Create drag image
  const dragImage = document.createElement('div')
  dragImage.className = 'px-3 py-2 bg-primary text-primary-foreground rounded-md text-xs font-medium shadow-lg'
  const firstEntry = draggedEntries.value[0]
  dragImage.textContent = draggedEntries.value.length === 1 && firstEntry
    ? firstEntry.name
    : t('fileManager.items', { count: draggedEntries.value.length })
  dragImage.style.position = 'absolute'
  dragImage.style.top = '-1000px'
  document.body.appendChild(dragImage)
  event.dataTransfer.setDragImage(dragImage, 0, 0)
  setTimeout(() => document.body.removeChild(dragImage), 0)

  isDragging.value = true
}

function handleDragEnd() {
  isDragging.value = false
  draggedEntries.value = []
  dragOverPath.value = null
  dragCounter.value = 0
  dragSourcePanel = null // Clear drag source
}

function handleDragEnter(event: DragEvent) {
  event.preventDefault()
  dragCounter.value++
}

function handleDragOver(event: DragEvent, entry?: FileEntry) {
  event.preventDefault()
  if (!event.dataTransfer) return

  // Only allow drop on directories or empty space
  if (entry && !entry.isDir) {
    event.dataTransfer.dropEffect = 'none'
    dragOverPath.value = null
    return
  }

  // Check if dragging from external source or internal
  const hasFiles = event.dataTransfer.types.includes('Files')
  const hasEntries = event.dataTransfer.types.includes('application/devforge-entries')

  if (hasFiles) {
    // External files - always allow
    event.dataTransfer.dropEffect = 'copy'
    dragOverPath.value = entry?.path || props.currentPath
  } else if (hasEntries) {
    // Internal entries - check if from same panel using global variable
    if (dragSourcePanel === props.panelId) {
      event.dataTransfer.dropEffect = 'none'
      dragOverPath.value = null
      return
    }
    event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move'
    dragOverPath.value = entry?.path || props.currentPath
  } else {
    event.dataTransfer.dropEffect = 'none'
    dragOverPath.value = null
  }
}

function handleDragLeave(event: DragEvent) {
  event.preventDefault()
  dragCounter.value--
  if (dragCounter.value === 0) {
    dragOverPath.value = null
  }
}

function handleDrop(event: DragEvent, entry?: FileEntry) {
  event.preventDefault()
  dragCounter.value = 0
  dragOverPath.value = null

  if (!event.dataTransfer) return

  const targetPath = entry?.isDir ? entry.path : props.currentPath

  // Handle external files (from OS file manager)
  if (event.dataTransfer.files.length > 0) {
    const files = Array.from(event.dataTransfer.files)
    emit('dropExternal', files)
    return
  }

  // Handle internal entries (from other pane)
  const entriesData = event.dataTransfer.getData('application/devforge-entries')
  if (entriesData) {
    try {
      const dragData = JSON.parse(entriesData)
      const entries = dragData.entries || dragData // Support both old and new format

      // Prevent dropping onto same panel
      if (dragData.sourcePanel === props.panelId) {
        return
      }

      // Don't allow dropping onto itself
      if (entries.some((e: FileEntry) => e.path === targetPath)) {
        return
      }

      emit('dropFiles', entries, targetPath)
    } catch {
      // ignore invalid drag data
    }
  }

  isDragging.value = false
  draggedEntries.value = []
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return '-'
  const date = new Date(timestamp * 1000)
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden outline-none" tabindex="0" @keydown="handleKeyDown">
    <!-- Header -->
    <div class="flex items-center gap-1 border-b border-border px-2 py-1.5">
      <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {{ label }}
      </span>
      <span v-if="selectedCount > 0" class="text-xs text-primary">
        ({{ t('fileManager.selectedCount', { count: selectedCount }) }})
      </span>
    </div>

    <!-- Path bar (includes navigation, refresh, mkdir buttons) -->
    <PathBar
      :current-path="currentPath"
      :is-remote="panelId === 'remote'"
      :loading="loading"
      :show-search-button="panelId === 'remote'"
      @navigate="handlePathNavigate"
      @go-up="navigateUp"
      @refresh="emit('refresh')"
      @mkdir="showMkdirDialog = true"
      @search="emit('search')"
    />

    <!-- File list -->
    <div
      ref="scrollContainerRef"
      class="min-h-0 flex-1 overflow-auto relative"
      @dragenter="handleDragEnter"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <!-- Drag overlay -->
      <div
        v-if="dragCounter > 0 && dragOverPath === currentPath"
        class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-primary bg-primary/5"
      >
        <div class="rounded-lg bg-background/90 px-4 py-3 text-sm font-medium shadow-lg">
          {{ t('fileManager.dropHere') }}
        </div>
      </div>

      <!-- Loading -->
      <div
        v-if="loading && entries.length === 0"
        class="flex items-center justify-center py-12"
      >
        <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
      </div>

      <!-- Empty -->
      <div
        v-else-if="entries.length === 0"
        class="flex items-center justify-center py-12 text-xs text-muted-foreground"
      >
        {{ t('fileManager.emptyDir') }}
      </div>

      <!-- Virtualized Entries -->
      <div
        v-else
        :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }"
      >
        <template v-for="vRow in virtualizer.getVirtualItems()" :key="vRow.key">
          <ContextMenu v-if="entries[vRow.index]">
            <ContextMenuTrigger>
              <div
                class="group flex cursor-pointer items-center gap-3 px-3 text-[13px] transition-all duration-200 hover:bg-muted/40 absolute left-1 right-1 rounded-md"
                :style="{ height: `${ROW_HEIGHT}px`, transform: `translateY(${vRow.start}px)` }"
                :class="{
                  'bg-primary/10 text-primary': isSelected(entries[vRow.index]!),
                  'ring-2 ring-primary/60 shadow-[0_0_15px_rgba(var(--color-primary)/0.2)]': dragOverPath === entries[vRow.index]!.path && entries[vRow.index]!.isDir,
                }"
                draggable="true"
                @click="handleClick(entries[vRow.index]!, $event)"
                @dblclick="handleDoubleClick(entries[vRow.index]!)"
                @contextmenu="handleContextMenu(entries[vRow.index]!)"
                @dragstart="handleDragStart(entries[vRow.index]!, $event)"
                @dragend="handleDragEnd"
                @dragenter.stop="entries[vRow.index]!.isDir && handleDragEnter($event)"
                @dragover.stop="handleDragOver($event, entries[vRow.index]!)"
                @dragleave.stop="entries[vRow.index]!.isDir && handleDragLeave($event)"
                @drop.stop="entries[vRow.index]!.isDir && handleDrop($event, entries[vRow.index]!)"
              >
                <component
                  :is="entries[vRow.index]!.isDir ? Folder : File"
                  class="h-4 w-4 shrink-0 transition-transform group-hover:scale-110"
                  :class="entries[vRow.index]!.isDir ? 'text-[var(--df-warning)]' : 'text-muted-foreground'"
                />
                <span class="flex-1 truncate group-hover:text-foreground transition-colors">{{ entries[vRow.index]!.name }}</span>
                <span class="w-16 shrink-0 text-right text-muted-foreground">
                  {{ entries[vRow.index]!.isDir ? '' : formatSize(entries[vRow.index]!.size) }}
                </span>
                <span class="w-28 shrink-0 text-right text-muted-foreground">
                  {{ formatDate(entries[vRow.index]!.modified) }}
                </span>
              </div>
            </ContextMenuTrigger>
            <!-- __CONTINUE_HERE__ -->
            <ContextMenuContent class="w-48">
              <template v-if="selectedCount === 0">
                <ContextMenuItem @click="showMkdirDialog = true">
                  <FolderPlus class="mr-2 h-4 w-4" />
                  {{ t('fileManager.newFolder') }}
                </ContextMenuItem>
              </template>

              <template v-else-if="selectedCount === 1">
                <ContextMenuItem
                  v-if="panelId === 'remote' && selectedItems[0] && !selectedItems[0].isDir"
                  @click="selectedItems[0] && emit('editFile', selectedItems[0])"
                >
                  <FileEdit class="mr-2 h-4 w-4" />
                  {{ t('sftp.editFile') }}
                </ContextMenuItem>
                <ContextMenuItem
                  v-if="showTransferAction === 'download' && selectedItems[0]"
                  @click="handleTransferSelected"
                >
                  <Download class="mr-2 h-4 w-4" />
                  {{ t('fileManager.download') }}
                </ContextMenuItem>
                <ContextMenuItem
                  v-if="showTransferAction === 'upload' && selectedItems[0]"
                  @click="handleTransferSelected"
                >
                  <Upload class="mr-2 h-4 w-4" />
                  {{ t('fileManager.upload') }}
                </ContextMenuItem>
                <ContextMenuSeparator v-if="showTransferAction && selectedItems[0] && !selectedItems[0].isDir" />
                <ContextMenuItem v-if="selectedItems[0]" @click="openRenameDialog(selectedItems[0])">
                  <Pencil class="mr-2 h-4 w-4" />
                  {{ t('fileManager.rename') }}
                </ContextMenuItem>
                <ContextMenuItem
                  v-if="panelId === 'remote' && selectedItems[0]"
                  @click="emit('showPermissions', selectedItems[0])"
                >
                  <Shield class="mr-2 h-4 w-4" />
                  {{ t('fileEditor.permissions') }}
                </ContextMenuItem>
                <ContextMenuItem
                  v-if="selectedItems[0] && !selectedItems[0].isDir"
                  @click="selectedItems[0] && emit('compareFile', selectedItems[0])"
                >
                  <ArrowLeftRight class="mr-2 h-4 w-4" />
                  {{ t('fileEditor.compare') }}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  class="text-destructive focus:text-destructive"
                  @click="handleDeleteSelected"
                >
                  <Trash2 class="mr-2 h-4 w-4" />
                  {{ t('fileManager.delete') }}
                </ContextMenuItem>
              </template>

              <template v-else>
                <ContextMenuItem @click="handleBatchTransfer">
                  <Upload v-if="showTransferAction === 'upload'" class="mr-2 h-4 w-4" />
                  <Download v-else class="mr-2 h-4 w-4" />
                  {{
                    showTransferAction === 'upload'
                      ? t('fileManager.uploadSelected', { count: selectedCount })
                      : t('fileManager.downloadSelected', { count: selectedCount })
                  }}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  class="text-destructive focus:text-destructive"
                  @click="handleBatchDelete"
                >
                  <Trash2 class="mr-2 h-4 w-4" />
                  {{ t('fileManager.deleteSelected', { count: selectedCount }) }}
                </ContextMenuItem>
              </template>
            </ContextMenuContent>
          </ContextMenu>
        </template>
      </div>
    </div>

    <!-- Status bar -->
    <div class="flex items-center border-t border-border px-2 py-1 text-[10px] text-muted-foreground">
      <span>{{ t('fileManager.items', { count: entries.length }) }}</span>
    </div>

    <!-- New Folder Dialog -->
    <Dialog v-model:open="showMkdirDialog">
      <DialogContent class="max-w-[350px] p-0 overflow-hidden border border-border/40 shadow-2xl rounded-2xl bg-background/98 backdrop-blur-3xl">
        <!-- Masterpiece Header -->
        <div class="px-6 py-4 border-b border-white/[0.02] bg-muted/20 flex items-center gap-3">
          <div class="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary shadow-sm border border-primary/20">
            <FolderPlus class="h-4 w-4" />
          </div>
          <div class="flex flex-col">
            <DialogTitle class="text-[14px] font-bold tracking-tight text-foreground/90">
              {{ t('fileManager.newFolder') }}
            </DialogTitle>
            <span class="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-[0.1em]">
              Create New Directory
            </span>
          </div>
        </div>

        <div class="p-6">
          <form @submit.prevent="handleMkdir">
            <div class="mb-6">
              <div class="flex items-center justify-between px-1 mb-2">
                <label class="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                  {{ t('fileManager.newFolderName') }}
                </label>
              </div>
              <div class="relative group">
                <Input
                  v-model="mkdirName"
                  class="h-11 rounded-xl border-border/80 bg-background/50 px-4 text-[13px] tracking-wide transition-all focus:border-primary focus:ring-4 focus:ring-primary/5 shadow-sm"
                  :placeholder="t('fileManager.newFolderName')"
                  autofocus
                />
                <div class="absolute inset-0 rounded-xl bg-primary/5 opacity-0 group-focus-within:opacity-100 pointer-events-none transition-opacity duration-300"></div>
              </div>
            </div>
            <DialogFooter class="gap-3 p-0">
              <Button 
                variant="outline" 
                type="button" 
                class="flex-1 h-11 rounded-xl text-[12px] font-bold text-foreground/60 hover:text-foreground hover:bg-muted transition-all" 
                @click="showMkdirDialog = false"
              >
                {{ t('common.cancel') }}
              </Button>
              <Button 
                type="submit" 
                class="flex-1 h-11 rounded-xl text-[12px] font-extrabold shadow-lg shadow-primary/20 transition-all active:scale-[0.96]" 
                :disabled="!mkdirName.trim()"
              >
                {{ t('common.confirm') }}
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Rename Dialog -->
    <Dialog v-model:open="showRenameDialog">
      <DialogContent class="max-w-[300px] p-0 overflow-hidden border border-border/60 shadow-2xl rounded-2xl bg-background/98 backdrop-blur-3xl">
        <div class="px-5 py-3 border-b border-muted/30 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Pencil class="h-3.5 w-3.5 text-primary" />
            <DialogTitle class="text-[12px] font-black uppercase tracking-widest text-foreground/70">
              {{ t('fileManager.rename') }}
            </DialogTitle>
          </div>
        </div>

        <div class="p-5">
          <form @submit.prevent="handleRename">
            <div class="mb-5">
              <div class="relative group">
                <Input
                  v-model="renameName"
                  class="h-10 rounded-xl border-border/80 bg-muted/20 px-3 text-[13px] tracking-wide transition-all focus:border-primary focus:bg-background focus:ring-4 focus:ring-primary/5 shadow-sm"
                  :placeholder="t('fileManager.renameTo')"
                  autofocus
                />
              </div>
            </div>

            <div class="flex gap-2.5">
              <Button 
                variant="outline" 
                type="button"
                class="flex-1 h-9 rounded-xl text-[11px] font-bold text-foreground/60 border-border/40 hover:bg-muted transition-all" 
                @click="showRenameDialog = false"
              >
                {{ t('common.cancel') }}
              </Button>
              <Button
                type="submit"
                class="flex-1 h-9 rounded-xl text-[11px] font-black shadow-lg shadow-primary/10 transition-all active:scale-[0.96]"
                :disabled="!renameName.trim()"
              >
                {{ t('common.confirm') }}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
