<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { listen } from '@tauri-apps/api/event'
import { useTransferStore } from '@/stores/transfer'
import { useWorkspaceStore } from '@/stores/workspace'
import { useToast } from '@/composables/useToast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Loader2,
  FolderUp,
  Folder,
  File as FileIcon,
  RefreshCw,
  FolderPlus,
  Download,
  Trash2,
  Pencil,
  TerminalSquare,
  FileText,
  FileEdit,
  ClipboardCopy,
  FolderOpen,
  FolderSync,
} from 'lucide-vue-next'
import * as sftpApi from '@/api/sftp'
import type { FileEntry } from '@/types/fileManager'

const props = defineProps<{
  connectionId: string
}>()

const emit = defineEmits<{
  /** 向终端发送命令（自动加换行） */
  'send-command': [command: string]
  /** 向终端插入文本（不加换行） */
  'insert-text': [text: string]
}>()

const { t } = useI18n()
const transferStore = useTransferStore()
const workspace = useWorkspaceStore()
const toast = useToast()

const status = ref<'connecting' | 'connected' | 'error'>('connecting')
const currentPath = ref('/')
const entries = ref<FileEntry[]>([])
const loading = ref(false)
const creatingFolder = ref(false)
const newFolderName = ref('')
const editingPath = ref(false)
const pathInput = ref('')

// 删除确认
const showDeleteConfirm = ref(false)
const deleteConfirmTitle = ref('')
const deleteConfirmDesc = ref('')
let pendingDeleteAction: (() => Promise<void>) | null = null

// 重命名
const renamingEntry = ref<FileEntry | null>(null)
const renameValue = ref('')

let unlistenTransferComplete: (() => void) | null = null

async function connect() {
  status.value = 'connecting'
  try {
    await sftpApi.sftpConnect(props.connectionId)
    status.value = 'connected'
    await loadDir()
  } catch (e) {
    status.value = 'error'
    toast.error(t('toast.operationFailed'), String(e))
  }
}

async function loadDir(path?: string) {
  if (status.value !== 'connected') return
  loading.value = true
  try {
    const target = path ?? currentPath.value
    const result = await sftpApi.sftpListDir(props.connectionId, target)
    entries.value = result
    currentPath.value = target
  } catch (e) {
    toast.error(t('toast.operationFailed'), String(e))
  } finally {
    loading.value = false
  }
}

function navigateUp() {
  const parts = currentPath.value.replace(/\/+$/, '').split('/')
  parts.pop()
  const parent = parts.join('/') || '/'
  loadDir(parent)
}

function handleEntryClick(entry: FileEntry) {
  if (entry.isDir) {
    loadDir(entry.path)
  }
}

/** cd 到目录并同步侧栏 */
function cdToDir(path: string) {
  emit('send-command', `cd ${shellEscape(path)}`)
  loadDir(path)
}

/** 在终端中 cat 查看文件 */
function catFile(entry: FileEntry) {
  emit('send-command', `cat ${shellEscape(entry.path)}`)
}

/** 在终端中 vim 编辑文件 */
function editFile(entry: FileEntry) {
  emit('send-command', `vim ${shellEscape(entry.path)}`)
}

/** 插入文件路径到终端 */
function insertPath(entry: FileEntry) {
  emit('insert-text', shellEscape(entry.path))
}

/** 转义 shell 路径中的特殊字符 */
function shellEscape(path: string): string {
  // 如果路径包含空格或特殊字符，用单引号包裹
  if (/[^a-zA-Z0-9_.\/\-]/.test(path)) {
    return `'${path.replace(/'/g, "'\\''")}'`
  }
  return path
}

/** 外部调用：同步到指定目录 */
function syncToPath(path: string) {
  if (status.value === 'connected' && path !== currentPath.value) {
    loadDir(path)
  }
}

/** 开始编辑路径 */
function startEditPath() {
  pathInput.value = currentPath.value
  editingPath.value = true
}

/** 确认路径跳转 */
function confirmPathEdit() {
  const target = pathInput.value.trim()
  if (target) {
    loadDir(target)
  }
  editingPath.value = false
}

/** 同步终端当前目录：发送 pwd 到终端 + 请求路径检测 */
function syncTerminalDir() {
  emit('send-command', 'pwd')
}

async function handleDownload(entry: FileEntry) {
  try {
    const transferId = crypto.randomUUID()
    // 下载到系统临时目录
    const localTarget = `${entry.name}`
    transferStore.addTask({
      id: transferId,
      type: 'download',
      fileName: entry.name,
      localPath: localTarget,
      remotePath: entry.path,
      connectionId: props.connectionId,
      totalBytes: entry.size ?? 0,
    })
    workspace.setBottomPanelTab('transfer')
    await sftpApi.startDownloadChunked(transferId, props.connectionId, entry.path, localTarget)
  } catch (e) {
    toast.error(t('toast.downloadFailed'), String(e))
  }
}

function requestDelete(entry: FileEntry) {
  deleteConfirmTitle.value = t('fileManager.confirmDelete', { name: entry.name })
  deleteConfirmDesc.value = entry.path
  pendingDeleteAction = async () => {
    try {
      await sftpApi.sftpDelete(props.connectionId, entry.path, entry.isDir)
      await loadDir()
    } catch (e) {
      toast.error(t('toast.deleteFailed'), String(e))
    }
  }
  showDeleteConfirm.value = true
}

async function executeDelete() {
  if (pendingDeleteAction) {
    await pendingDeleteAction()
    pendingDeleteAction = null
  }
}

function startRename(entry: FileEntry) {
  renamingEntry.value = entry
  renameValue.value = entry.name
}

async function confirmRename() {
  if (!renamingEntry.value || !renameValue.value.trim()) return
  try {
    const lastSlash = renamingEntry.value.path.lastIndexOf('/')
    const parentPath = lastSlash > 0 ? renamingEntry.value.path.substring(0, lastSlash) : ''
    const newPath = `${parentPath}/${renameValue.value}`
    await sftpApi.sftpRename(props.connectionId, renamingEntry.value.path, newPath)
    renamingEntry.value = null
    await loadDir()
  } catch (e) {
    toast.error(t('toast.operationFailed'), String(e))
  }
}

async function handleCreateFolder() {
  if (!newFolderName.value.trim()) return
  try {
    const newPath = currentPath.value.endsWith('/')
      ? `${currentPath.value}${newFolderName.value}`
      : `${currentPath.value}/${newFolderName.value}`
    await sftpApi.sftpMkdir(props.connectionId, newPath)
    creatingFolder.value = false
    newFolderName.value = ''
    await loadDir()
  } catch (e) {
    toast.error(t('toast.operationFailed'), String(e))
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

onMounted(async () => {
  unlistenTransferComplete = await listen<{ id: string }>(
    'transfer://complete',
    (event) => {
      const task = transferStore.tasks.get(event.payload.id)
      if (task && task.type === 'upload' && task.connectionId === props.connectionId) {
        loadDir()
      }
    },
  )
  await connect()
})

onBeforeUnmount(async () => {
  if (unlistenTransferComplete) unlistenTransferComplete()
  try {
    await sftpApi.sftpDisconnect(props.connectionId)
  } catch {
    // ignore
  }
})

defineExpose({ syncToPath })
</script>

<!-- TEMPLATE_PLACEHOLDER -->

<template>
  <div class="flex h-full flex-col border-l border-border bg-background">
    <!-- Header -->
    <div class="flex items-center gap-1 border-b border-border px-2 py-1.5">
      <span class="flex-1 truncate text-xs font-medium text-muted-foreground">{{ t('terminal.sftpFiles') }}</span>
      <Button variant="ghost" size="icon" class="h-6 w-6" :title="t('sftp.syncDir')" @click="syncTerminalDir">
        <FolderSync class="h-3 w-3" />
      </Button>
      <Button variant="ghost" size="icon" class="h-6 w-6" @click="() => { creatingFolder = true; newFolderName = '' }">
        <FolderPlus class="h-3 w-3" />
      </Button>
      <Button variant="ghost" size="icon" class="h-6 w-6" :disabled="loading" @click="loadDir()">
        <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': loading }" />
      </Button>
    </div>

    <!-- Path bar -->
    <div class="flex items-center gap-1 border-b border-border px-2 py-1">
      <Button variant="ghost" size="icon" class="h-5 w-5 shrink-0" @click="navigateUp">
        <FolderUp class="h-3 w-3" />
      </Button>
      <template v-if="editingPath">
        <Input
          v-model="pathInput"
          class="h-5 text-xs flex-1"
          @keydown.enter="confirmPathEdit"
          @keydown.escape="editingPath = false"
          @blur="confirmPathEdit"
        />
      </template>
      <span
        v-else
        class="flex-1 truncate text-xs text-muted-foreground cursor-pointer hover:text-foreground"
        :title="currentPath"
        @click="startEditPath"
      >{{ currentPath }}</span>
    </div>

    <!-- New folder input -->
    <div v-if="creatingFolder" class="flex items-center gap-1 border-b border-border px-2 py-1">
      <Input
        v-model="newFolderName"
        class="h-6 text-xs"
        :placeholder="t('fileManager.newFolderName')"
        @keydown.enter="handleCreateFolder"
        @keydown.escape="creatingFolder = false"
      />
    </div>

    <!-- Loading -->
    <div v-if="status === 'connecting'" class="flex flex-1 items-center justify-center">
      <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
    </div>

    <!-- Error -->
    <div v-else-if="status === 'error'" class="flex flex-1 flex-col items-center justify-center gap-2 p-4">
      <span class="text-xs text-destructive">{{ t('terminal.sftpConnectFailed') }}</span>
      <Button variant="outline" size="sm" @click="connect">{{ t('common.retry') }}</Button>
    </div>

    <!-- File list -->
    <div v-else class="flex-1 overflow-y-auto">
      <div
        v-for="entry in entries"
        :key="entry.path"
        class="group flex items-center gap-1.5 px-2 py-0.5 text-xs hover:bg-accent cursor-pointer"
        draggable="true"
        @dblclick="entry.isDir ? cdToDir(entry.path) : catFile(entry)"
        @dragstart="(e: DragEvent) => { e.dataTransfer?.setData('text/plain', shellEscape(entry.path)); e.dataTransfer!.effectAllowed = 'copy' }"
      >
        <ContextMenu>
          <ContextMenuTrigger class="flex flex-1 items-center gap-1.5 min-w-0">
            <Folder v-if="entry.isDir" class="h-3.5 w-3.5 shrink-0 text-[var(--df-warning)]" />
            <FileIcon v-else class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <template v-if="renamingEntry?.path === entry.path">
              <Input
                v-model="renameValue"
                class="h-5 text-xs flex-1"
                @keydown.enter="confirmRename"
                @keydown.escape="renamingEntry = null"
                @click.stop
                @dblclick.stop
              />
            </template>
            <template v-else>
              <span class="flex-1 truncate">{{ entry.name }}</span>
              <span v-if="!entry.isDir" class="shrink-0 text-muted-foreground">{{ formatSize(entry.size) }}</span>
            </template>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <!-- 目录操作 -->
            <template v-if="entry.isDir">
              <ContextMenuItem @select="cdToDir(entry.path)">
                <TerminalSquare class="mr-2 h-3.5 w-3.5" /> cd {{ entry.name }}
              </ContextMenuItem>
              <ContextMenuItem @select="handleEntryClick(entry)">
                <FolderOpen class="mr-2 h-3.5 w-3.5" /> {{ t('fileManager.open') }}
              </ContextMenuItem>
            </template>
            <!-- 文件操作 -->
            <template v-else>
              <ContextMenuItem @select="catFile(entry)">
                <FileText class="mr-2 h-3.5 w-3.5" /> {{ t('sftp.viewFile') }}
              </ContextMenuItem>
              <ContextMenuItem @select="editFile(entry)">
                <FileEdit class="mr-2 h-3.5 w-3.5" /> {{ t('sftp.editFile') }}
              </ContextMenuItem>
              <ContextMenuItem @select="handleDownload(entry)">
                <Download class="mr-2 h-3.5 w-3.5" /> {{ t('fileManager.download') }}
              </ContextMenuItem>
            </template>
            <ContextMenuSeparator />
            <ContextMenuItem @select="insertPath(entry)">
              <ClipboardCopy class="mr-2 h-3.5 w-3.5" /> {{ t('sftp.insertPath') }}
            </ContextMenuItem>
            <ContextMenuItem @select="startRename(entry)">
              <Pencil class="mr-2 h-3.5 w-3.5" /> {{ t('fileManager.rename') }}
            </ContextMenuItem>
            <ContextMenuItem class="text-destructive" @select="requestDelete(entry)">
              <Trash2 class="mr-2 h-3.5 w-3.5" /> {{ t('fileManager.delete') }}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
      <div v-if="entries.length === 0 && !loading" class="flex items-center justify-center p-4">
        <span class="text-xs text-muted-foreground">{{ t('fileManager.emptyDir') }}</span>
      </div>
    </div>
  </div>

  <ConfirmDialog
    v-model:open="showDeleteConfirm"
    :title="deleteConfirmTitle"
    :description="deleteConfirmDesc"
    @confirm="executeDelete"
  />
</template>