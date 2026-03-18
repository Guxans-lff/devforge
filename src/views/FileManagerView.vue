<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, onActivated, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { listen } from '@tauri-apps/api/event'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTransferStore } from '@/stores/transfer'
import { useConnectionStore } from '@/stores/connections'
import { useFileEditorStore } from '@/stores/file-editor'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import FilePane from '@/components/file-manager/FilePane.vue'
import FileEditor from '@/components/file-manager/FileEditor.vue'
import FileSearchPanel from '@/components/file-manager/FileSearchPanel.vue'
import PermissionDialog from '@/components/file-manager/PermissionDialog.vue'
import FileDiffView from '@/components/file-manager/FileDiffView.vue'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Loader2, Terminal as TerminalIcon, PanelRightClose, PanelRightOpen } from 'lucide-vue-next'
import * as sftpApi from '@/api/sftp'
import { sftpChmod } from '@/api/file-editor'
import { useToast } from '@/composables/useToast'
import type { FileEntry } from '@/types/fileManager'

const props = defineProps<{
  connectionId: string
  connectionName: string
  initialRemotePath?: string
}>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const transferStore = useTransferStore()
const connectionStore = useConnectionStore()
const fileEditorStore = useFileEditorStore()

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
// 远程面板状态（如果从终端传入了初始路径则使用，否则默认 /）
const remotePath = ref(props.initialRemotePath || '/')
const remoteEntries = ref<FileEntry[]>([])
const remoteLoading = ref(false)

// Editor / Search / Permission panel state
const showEditorPanel = ref(false)
const showSearchPanel = ref(false)
const showPermissionDialog = ref(false)
const permissionTarget = ref<FileEntry | null>(null)

// Diff view state
const showDiffView = ref(false)
const diffLocalPath = ref('')
const diffRemotePath = ref('')

// 当所有文件标签关闭时，自动隐藏编辑面板
watch(
  () => fileEditorStore.openFiles.size,
  (size) => {
    if (size === 0) {
      showEditorPanel.value = false
    }
  },
)

let unlistenTransferComplete: any = null

async function connect() {
  status.value = 'connecting'
  connectionStore.updateConnectionStatus(props.connectionId, 'connecting')
  errorMessage.value = ''

  try {
    await sftpApi.sftpConnect(props.connectionId)
    status.value = 'connected'
    connectionStore.updateConnectionStatus(props.connectionId, 'connected')

    // Load initial directories
    await Promise.all([loadLocal(), loadRemote()])
  } catch (e) {
    status.value = 'error'
    connectionStore.updateConnectionStatus(props.connectionId, 'error', String(e))
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
      // Upload folder recursively — 使用 targetPath 作为目标目录
      const dirRemotePath = targetPath.endsWith('/')
        ? `${targetPath}${entry.name}`
        : `${targetPath}/${entry.name}`
      await sftpApi.sftpMkdir(props.connectionId, dirRemotePath).catch(() => {})
      // 递归上传子文件需要以 dirRemotePath 为目标
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
async function handleDropExternalFiles(files: File[], _targetPath: string, isRemote: boolean) {

  if (isRemote) {
    // Upload to remote
    for (const file of files) {
      // Convert File to local path (need to save to temp first)
      // External file upload not yet implemented
      toast.error(t('toast.operationFailed'), `External file upload not supported: ${file.name}`)
    }
  } else {
    // Save to local
    toast.error(t('toast.operationFailed'), 'External file save to local not supported')
  }
}

// ==================== 文件编辑 ====================

async function handleEditFile(entry: FileEntry) {
  try {
    showEditorPanel.value = true
    await fileEditorStore.openFile(props.connectionId, entry.path)
  } catch (e) {
    toast.error(t('toast.operationFailed'), String(e))
  }
}

// ==================== 文件权限 ====================

function handleShowPermissions(entry: FileEntry) {
  permissionTarget.value = entry
  showPermissionDialog.value = true
}

async function handleChmod(mode: number) {
  if (!permissionTarget.value) return
  try {
    await sftpChmod(props.connectionId, permissionTarget.value.path, mode)
    toast.success(t('toast.operationSuccess'))
    showPermissionDialog.value = false
    permissionTarget.value = null
    await loadRemote()
  } catch (e) {
    toast.error(t('toast.operationFailed'), String(e))
  }
}

// ==================== 文件搜索 ====================

function toggleSearchPanel() {
  showSearchPanel.value = !showSearchPanel.value
}

function handleSearchNavigate(path: string) {
  handleRemoteNavigate(path)
  showSearchPanel.value = false
}

// ==================== 文件对比 ====================

function handleCompareFile(entry: FileEntry, side: 'local' | 'remote') {
  if (side === 'remote') {
    // 远程文件对比：用同名本地文件
    const localFile = localPath.value.endsWith('/')
      ? `${localPath.value}${entry.name}`
      : `${localPath.value}/${entry.name}`
    diffLocalPath.value = localFile
    diffRemotePath.value = entry.path
  } else {
    // 本地文件对比：用同名远程文件
    const remoteFile = remotePath.value.endsWith('/')
      ? `${remotePath.value}${entry.name}`
      : `${remotePath.value}/${entry.name}`
    diffLocalPath.value = entry.path
    diffRemotePath.value = remoteFile
  }
  showDiffView.value = true
  showEditorPanel.value = false
}

// 传输完成后刷新防抖（批量传输时避免重复刷新）
let refreshRemoteTimer: ReturnType<typeof setTimeout> | null = null
let refreshLocalTimer: ReturnType<typeof setTimeout> | null = null

function debouncedLoadRemote() {
  if (refreshRemoteTimer) clearTimeout(refreshRemoteTimer)
  refreshRemoteTimer = setTimeout(() => {
    refreshRemoteTimer = null
    loadRemote()
  }, 500)
}

function debouncedLoadLocal() {
  if (refreshLocalTimer) clearTimeout(refreshLocalTimer)
  refreshLocalTimer = setTimeout(() => {
    refreshLocalTimer = null
    loadLocal()
  }, 500)
}

// 监听 tab meta 中的 initialRemotePath 变化（从终端跳转过来时触发）
watch(
  () => {
    const tab = workspace.tabs.find(t => t.id === `file-manager-${props.connectionId}`)
    return tab?.meta?.initialRemotePath
  },
  (newPath, oldPath) => {
    console.log('[FileManagerView] watch initialRemotePath 变化:', JSON.stringify(oldPath), '->', JSON.stringify(newPath), 'status:', status.value, 'remotePath:', remotePath.value)
    if (newPath && newPath !== remotePath.value && status.value === 'connected') {
      console.log('[FileManagerView] 执行 loadRemote:', newPath)
      loadRemote(newPath)
    }
  },
)

onMounted(async () => {
  // 监听传输完成事件，自动刷新文件列表（防抖，批量传输时合并刷新）
  unlistenTransferComplete = await listen<{ id: string }>(
    'transfer://complete',
    (event) => {
      const task = transferStore.tasks.get(event.payload.id)
      if (task) {
        if (task.type === 'upload') {
          debouncedLoadRemote()
        } else {
          debouncedLoadLocal()
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

// KeepAlive 重新激活时同步连接状态
onActivated(() => {
  if (status.value === 'connected') {
    connectionStore.updateConnectionStatus(props.connectionId, 'connected')
  }
})

onBeforeUnmount(async () => {
  if (refreshRemoteTimer) clearTimeout(refreshRemoteTimer)
  if (refreshLocalTimer) clearTimeout(refreshLocalTimer)
  if (unlistenTransferComplete) unlistenTransferComplete()
  try {
    await sftpApi.sftpDisconnect(props.connectionId)
  } catch {
    // ignore
  }
  // 状态更新由 closeTab 统一处理（已检查同连接其他 tab），此处仅清理资源
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-transparent">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 border-b border-border/30 bg-background/50 backdrop-blur-md px-3 py-1.5">
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
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-muted-foreground hover:text-foreground"
              :class="showEditorPanel ? 'bg-accent' : ''"
              @click="showEditorPanel = !showEditorPanel"
            >
              <component :is="showEditorPanel ? PanelRightClose : PanelRightOpen" class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{{ t('fileEditor.toggleEditor') }}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div class="flex-1" />
      <div class="flex items-center gap-2 border-l border-border/10 ml-2 pl-3 text-[10px] font-black tracking-widest text-muted-foreground/30 uppercase italic">
        <div
          class="h-1.5 w-1.5 rounded-full transition-colors duration-300"
          :class="{
            'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]': status === 'connected',
            'bg-yellow-500 animate-pulse': status === 'connecting',
            'bg-red-500': status === 'disconnected' || status === 'error',
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
            @compare-file="(entry) => handleCompareFile(entry, 'local')"
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
            @edit-file="handleEditFile"
            @show-permissions="handleShowPermissions"
            @compare-file="(entry) => handleCompareFile(entry, 'remote')"
            @search="toggleSearchPanel"
          />
        </Pane>
      </Splitpanes>

      <!-- 搜索面板（覆盖在右侧） -->
      <div
        v-if="showSearchPanel && status === 'connected'"
        class="absolute right-0 top-0 z-20 h-full w-72 border-l border-border bg-background shadow-lg"
      >
        <FileSearchPanel
          :connection-id="connectionId"
          :current-path="remotePath"
          @navigate="handleSearchNavigate"
          @close="showSearchPanel = false"
        />
      </div>
    </div>

    <!-- 编辑器面板 -->
    <div v-if="showEditorPanel && !showDiffView" class="border-t border-border" style="height: 45%">
      <FileEditor />
    </div>

    <!-- 文件对比面板 -->
    <div v-if="showDiffView" class="border-t border-border" style="height: 45%">
      <FileDiffView
        v-model:open="showDiffView"
        :connection-id="connectionId"
        :local-path="diffLocalPath"
        :remote-path="diffRemotePath"
      />
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

    <!-- 权限编辑对话框 -->
    <PermissionDialog
      v-model:open="showPermissionDialog"
      :file-name="permissionTarget?.name ?? ''"
      :current-permissions="permissionTarget?.permissions ?? null"
      @confirm="handleChmod"
    />
  </div>
</template>

<style scoped>
:deep(.splitpanes__splitter) {
  background-color: transparent;
  position: relative;
  transition: all 0.2s ease;
  z-index: 10;
}

:deep(.splitpanes__splitter::before) {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 1px;
  background-color: rgba(var(--color-border), 0.3);
  transition: all 0.2s ease;
}

:deep(.splitpanes__splitter:hover::before) {
  width: 2px;
  background-color: rgba(var(--color-primary), 0.8);
  box-shadow: 0 0 8px rgba(var(--color-primary), 0.5);
}

:deep(.splitpanes--vertical > .splitpanes__splitter) {
  width: 9px;
  min-width: 9px;
  margin-left: -4px;
  margin-right: -4px;
  cursor: col-resize;
}

:deep(.splitpanes__pane) {
  overflow: hidden;
}
</style>
