<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { listen } from '@tauri-apps/api/event'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTransferStore } from '@/stores/transfer'
import { useConnectionStore } from '@/stores/connections'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import FilePane from '@/components/file-manager/FilePane.vue'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Loader2, Terminal as TerminalIcon } from 'lucide-vue-next'
import * as sftpApi from '@/api/sftp'
import { useToast } from '@/composables/useToast'
import type { FileEntry } from '@/types/fileManager'

const props = defineProps<{
  connectionId: string
  connectionName: string
}>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const transferStore = useTransferStore()
const connectionStore = useConnectionStore()

const connectionHost = computed(() => {
  const conn = connectionStore.connections.get(props.connectionId)
  return conn?.record.host ?? ''
})

const remotePaneLabel = computed(() => {
  const base = t('fileManager.remote')
  return connectionHost.value ? `${base} (${connectionHost.value})` : base
})

const status = ref<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
const errorMessage = ref('')
const toast = useToast()

// Delete confirmation state
const showDeleteConfirm = ref(false)
const deleteConfirmTitle = ref('')
const deleteConfirmDesc = ref('')
let pendingDeleteAction: (() => Promise<void>) | null = null

function requestDeleteConfirm(title: string, desc: string, action: () => Promise<void>) {
  deleteConfirmTitle.value = title
  deleteConfirmDesc.value = desc
  pendingDeleteAction = action
  showDeleteConfirm.value = true
}

async function executeDelete() {
  if (pendingDeleteAction) {
    await pendingDeleteAction()
    pendingDeleteAction = null
  }
}

// Local pane state
const localPath = ref('/')
const localEntries = ref<FileEntry[]>([])
const localLoading = ref(false)

// Remote pane state
const remotePath = ref('/')
const remoteEntries = ref<FileEntry[]>([])
const remoteLoading = ref(false)

let unlistenProgress: (() => void) | null = null
let unlistenComplete: (() => void) | null = null
let unlistenTransferComplete: (() => void) | null = null

async function connect() {
  status.value = 'connecting'
  errorMessage.value = ''

  try {
    await sftpApi.sftpConnect(props.connectionId)
    status.value = 'connected'

    // Load initial directories
    await Promise.all([loadLocal(), loadRemote()])
  } catch (e) {
    status.value = 'error'
    errorMessage.value = String(e)
  }
}

async function reconnect() {
  await connect()
}

function openTerminal() {
  workspace.addTab({
    id: `terminal-${props.connectionId}`,
    type: 'terminal',
    title: props.connectionName,
    connectionId: props.connectionId,
    closable: true,
  })
}

async function loadLocal(path?: string) {
  localLoading.value = true
  try {
    const target = path ?? localPath.value
    const entries = await sftpApi.localListDir(target)
    localEntries.value = entries
    localPath.value = target
  } catch (e) {
    toast.error(t('toast.operationFailed'), String(e))
  } finally {
    localLoading.value = false
  }
}

async function loadRemote(path?: string) {
  if (status.value !== 'connected') return
  remoteLoading.value = true
  try {
    const target = path ?? remotePath.value
    const entries = await sftpApi.sftpListDir(props.connectionId, target)
    remoteEntries.value = entries
    remotePath.value = target
  } catch (e) {
    toast.error(t('toast.operationFailed'), String(e))
  } finally {
    remoteLoading.value = false
  }
}

async function handleLocalNavigate(path: string) {
  await loadLocal(path)
}

async function handleRemoteNavigate(path: string) {
  await loadRemote(path)
}

async function handleLocalMkdir(name: string) {
  try {
    const sep = localPath.value.includes('\\') ? '\\' : '/'
    const newPath = localPath.value.endsWith(sep)
      ? `${localPath.value}${name}`
      : `${localPath.value}${sep}${name}`
    await sftpApi.localMkdir(newPath)
    await loadLocal()
  } catch (e) {
    toast.error(t('toast.operationFailed'), String(e))
  }
}

async function handleRemoteMkdir(name: string) {
  try {
    const newPath = remotePath.value.endsWith('/')
      ? `${remotePath.value}${name}`
      : `${remotePath.value}/${name}`
    await sftpApi.sftpMkdir(props.connectionId, newPath)
    await loadRemote()
  } catch (e) {
    toast.error(t('toast.operationFailed'), String(e))
  }
}

function handleLocalDelete(entry: FileEntry) {
  requestDeleteConfirm(
    t('fileManager.confirmDelete', { name: entry.name }),
    entry.path,
    async () => {
      try {
        await sftpApi.localDelete(entry.path)
        await loadLocal()
      } catch (e) {
        toast.error(t('toast.deleteFailed'), String(e))
      }
    },
  )
}

function handleRemoteDelete(entry: FileEntry) {
  requestDeleteConfirm(
    t('fileManager.confirmDelete', { name: entry.name }),
    entry.path,
    async () => {
      try {
        await sftpApi.sftpDelete(props.connectionId, entry.path, entry.isDir)
        await loadRemote()
      } catch (e) {
        toast.error(t('toast.deleteFailed'), String(e))
      }
    },
  )
}

async function handleLocalRename(entry: FileEntry, newName: string) {
  try {
    const sep = localPath.value.includes('\\') ? '\\' : '/'
    const parentPath = entry.path.substring(0, entry.path.lastIndexOf(sep))
    const newPath = parentPath ? `${parentPath}${sep}${newName}` : `${sep}${newName}`
    await sftpApi.localRename(entry.path, newPath)
    await loadLocal()
  } catch (e) {
    toast.error(t('toast.operationFailed'), String(e))
  }
}

async function handleRemoteRename(entry: FileEntry, newName: string) {
  try {
    const parentPath = entry.path.substring(0, entry.path.lastIndexOf('/'))
    const newPath = `${parentPath}/${newName}`
    await sftpApi.sftpRename(props.connectionId, entry.path, newPath)
    await loadRemote()
  } catch (e) {
    toast.error(t('toast.operationFailed'), String(e))
  }
}

async function handleUpload(entry: FileEntry) {
  // Upload local file to remote current directory
  try {
    const remoteTarget = remotePath.value.endsWith('/')
      ? `${remotePath.value}${entry.name}`
      : `${remotePath.value}/${entry.name}`

    // 生成传输 ID
    const transferId = crypto.randomUUID()

    // 先添加到传输队列
    transferStore.addTask({
      id: transferId,
      type: 'upload',
      fileName: entry.name,
      localPath: entry.path,
      remotePath: remoteTarget,
      connectionId: props.connectionId,
      totalBytes: entry.size ?? 0,
    })

    // 自动展开底部面板显示传输进度
    workspace.setBottomPanelTab('transfer')

    // 调用分块上传命令（后台执行，立即返回）
    await sftpApi.startUploadChunked(transferId, props.connectionId, entry.path, remoteTarget)
  } catch (e) {
    toast.error(t('toast.uploadFailed'), String(e))
  }
}

async function handleDownload(entry: FileEntry) {
  // Download remote file to local current directory
  try {
    const sep = localPath.value.includes('\\') ? '\\' : '/'
    const localTarget = localPath.value.endsWith(sep)
      ? `${localPath.value}${entry.name}`
      : `${localPath.value}${sep}${entry.name}`

    // 生成传输 ID
    const transferId = crypto.randomUUID()

    // 先添加到传输队列
    transferStore.addTask({
      id: transferId,
      type: 'download',
      fileName: entry.name,
      localPath: localTarget,
      remotePath: entry.path,
      connectionId: props.connectionId,
      totalBytes: entry.size ?? 0,
    })

    // 自动展开底部面板显示传输进度
    workspace.setBottomPanelTab('transfer')

    // 调用分块下载命令（后台执行，立即返回）
    await sftpApi.startDownloadChunked(transferId, props.connectionId, entry.path, localTarget)
  } catch (e) {
    toast.error(t('toast.downloadFailed'), String(e))
  }
}

async function handleBatchUpload(entries: FileEntry[]) {
  const CONCURRENCY = 3
  const queue = [...entries]
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const entry = queue.shift()
      if (entry) await handleUpload(entry)
    }
  })
  await Promise.all(workers)
}

async function handleBatchDownload(entries: FileEntry[]) {
  const CONCURRENCY = 3
  const queue = [...entries]
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const entry = queue.shift()
      if (entry) await handleDownload(entry)
    }
  })
  await Promise.all(workers)
}

function handleLocalBatchDelete(entries: FileEntry[]) {
  const names = entries.map((e) => e.name).join(', ')
  requestDeleteConfirm(
    t('fileManager.deleteSelected', { count: entries.length }),
    names,
    async () => {
      try {
        for (const entry of entries) {
          await sftpApi.localDelete(entry.path)
        }
        await loadLocal()
      } catch (e) {
        toast.error(t('toast.deleteFailed'), String(e))
      }
    },
  )
}

function handleRemoteBatchDelete(entries: FileEntry[]) {
  const names = entries.map((e) => e.name).join(', ')
  requestDeleteConfirm(
    t('fileManager.deleteSelected', { count: entries.length }),
    names,
    async () => {
      try {
        for (const entry of entries) {
          await sftpApi.sftpDelete(props.connectionId, entry.path, entry.isDir)
        }
        await loadRemote()
      } catch (e) {
        toast.error(t('toast.deleteFailed'), String(e))
      }
    },
  )
}

// Handle drag & drop from local to remote
async function handleDropToRemote(entries: FileEntry[], targetPath: string) {
  for (const entry of entries) {
    if (entry.isDir) {
      // Upload folder recursively
      await handleBatchUpload([entry])
    } else {
      // Upload single file
      const remoteTarget = targetPath.endsWith('/')
        ? `${targetPath}${entry.name}`
        : `${targetPath}/${entry.name}`

      const transferId = crypto.randomUUID()
      transferStore.addTask({
        id: transferId,
        type: 'upload',
        fileName: entry.name,
        localPath: entry.path,
        remotePath: remoteTarget,
        connectionId: props.connectionId,
        totalBytes: entry.size ?? 0,
      })
      workspace.setBottomPanelTab('transfer')
      await sftpApi.startUploadChunked(transferId, props.connectionId, entry.path, remoteTarget)
    }
  }
}

// Handle drag & drop from remote to local
async function handleDropToLocal(entries: FileEntry[], targetPath: string) {
  for (const entry of entries) {
    if (entry.isDir) {
      // Download folder recursively
      await handleBatchDownload([entry])
    } else {
      // Download single file
      const sep = targetPath.includes('\\') ? '\\' : '/'
      const localTarget = targetPath.endsWith(sep)
        ? `${targetPath}${entry.name}`
        : `${targetPath}${sep}${entry.name}`

      const transferId = crypto.randomUUID()
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
    }
  }
}

// Handle external files dropped from OS
async function handleDropExternalFiles(files: File[], targetPath: string, isRemote: boolean) {

  if (isRemote) {
    // Upload to remote
    for (const file of files) {
      const remoteTarget = targetPath.endsWith('/')
        ? `${targetPath}${file.name}`
        : `${targetPath}/${file.name}`

      // Convert File to local path (need to save to temp first)
      // External file upload not yet implemented
      toast.error(t('toast.operationFailed'), `External file upload not supported: ${file.name}`)
    }
  } else {
    // Save to local
    toast.error(t('toast.operationFailed'), 'External file save to local not supported')
  }
}

onMounted(async () => {
  // 监听传输完成事件，自动刷新文件列表
  unlistenTransferComplete = await listen<{ id: string }>(
    'transfer://complete',
    (event) => {
      const task = transferStore.tasks.get(event.payload.id)
      if (task) {
        if (task.type === 'upload') {
          loadRemote()
        } else {
          loadLocal()
        }
      }
    },
  )

  // Try to detect user's home directory for local (cross-platform)
  const homeCandidates = ['C:/Users', '/home', '/Users']
  for (const candidate of homeCandidates) {
    try {
      const entries = await sftpApi.localListDir(candidate)
      if (entries.length > 0) {
        localPath.value = candidate
        break
      }
    } catch {
      // try next candidate
    }
  }

  await connect()
})

onBeforeUnmount(async () => {
  if (unlistenProgress) unlistenProgress()
  if (unlistenComplete) unlistenComplete()
  if (unlistenTransferComplete) unlistenTransferComplete()
  try {
    await sftpApi.sftpDisconnect(props.connectionId)
  } catch {
    // ignore
  }
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 border-b border-border px-3 py-1.5">
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-muted-foreground hover:text-foreground"
              @click="openTerminal"
            >
              <TerminalIcon class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{{ t('fileManager.openTerminal') }}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div class="flex-1" />
      <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <div
          class="h-2 w-2 rounded-full"
          :class="{
            'bg-[var(--df-success)]': status === 'connected',
            'bg-[var(--df-warning)] animate-pulse': status === 'connecting',
            'bg-destructive': status === 'disconnected' || status === 'error',
          }"
        />
        <span>{{ connectionName }}</span>
      </div>
    </div>

    <!-- Content -->
    <div class="relative flex-1 overflow-hidden">
      <!-- Connecting overlay -->
      <div
        v-if="status === 'connecting'"
        class="absolute inset-0 z-10 flex items-center justify-center bg-background/80"
      >
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin" />
          {{ t('fileManager.connecting') }}
        </div>
      </div>

      <!-- Error overlay -->
      <div
        v-if="status === 'error'"
        class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80"
      >
        <span class="text-xs text-muted-foreground">{{ errorMessage }}</span>
        <Button
          variant="default"
          size="sm"
          @click="reconnect"
        >
          {{ t('fileManager.reconnect') }}
        </Button>
      </div>

      <!-- Dual-pane layout -->
      <Splitpanes
        v-if="status === 'connected' || status === 'connecting'"
        class="h-full"
      >
        <Pane :size="50" :min-size="25">
          <FilePane
            :label="t('fileManager.local')"
            panel-id="local"
            :entries="localEntries"
            :current-path="localPath"
            :loading="localLoading"
            show-transfer-action="upload"
            @navigate="handleLocalNavigate"
            @refresh="loadLocal()"
            @mkdir="handleLocalMkdir"
            @delete="handleLocalDelete"
            @rename="handleLocalRename"
            @transfer="handleUpload"
            @batch-transfer="handleBatchUpload"
            @batch-delete="handleLocalBatchDelete"
            @path-input="handleLocalNavigate"
            @drop-files="handleDropToLocal"
            @drop-external="(files) => handleDropExternalFiles(files, localPath, false)"
          />
        </Pane>
        <Pane :size="50" :min-size="25">
          <FilePane
            :label="remotePaneLabel"
            panel-id="remote"
            :entries="remoteEntries"
            :current-path="remotePath"
            :loading="remoteLoading"
            show-transfer-action="download"
            @navigate="handleRemoteNavigate"
            @refresh="loadRemote()"
            @mkdir="handleRemoteMkdir"
            @delete="handleRemoteDelete"
            @rename="handleRemoteRename"
            @transfer="handleDownload"
            @batch-transfer="handleBatchDownload"
            @batch-delete="handleRemoteBatchDelete"
            @path-input="handleRemoteNavigate"
            @drop-files="handleDropToRemote"
            @drop-external="(files) => handleDropExternalFiles(files, remotePath, true)"
          />
        </Pane>
      </Splitpanes>
    </div>

    <!-- Delete Confirmation -->
    <ConfirmDialog
      v-model:open="showDeleteConfirm"
      :title="deleteConfirmTitle"
      :description="deleteConfirmDesc"
      :confirm-label="t('common.delete')"
      :cancel-label="t('common.cancel')"
      variant="destructive"
      @confirm="executeDelete"
    />
  </div>
</template>

<style scoped>
:deep(.splitpanes__splitter) {
  background-color: hsl(var(--border));
  position: relative;
  transition: background-color 0.15s ease;
}

:deep(.splitpanes__splitter:hover) {
  background-color: hsl(var(--primary));
}

:deep(.splitpanes--vertical > .splitpanes__splitter) {
  width: 3px;
  min-width: 3px;
  cursor: col-resize;
}

:deep(.splitpanes__pane) {
  overflow: hidden;
}
</style>
