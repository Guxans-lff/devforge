<script setup lang="ts">
import { computed, watch, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTransferStore, type TransferTask } from '@/stores/transfer'
import { pauseTransfer, resumeTransfer, cancelTransfer, startUploadChunked, startDownloadChunked } from '@/api/sftp'
import { useToast } from '@/composables/useToast'
import { useNotification } from '@/composables/useNotification'
import { formatSftpError } from '@/composables/sftp/sftpErrors'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Pause,
  Play,
  X,
  RotateCcw,
  Trash2,
  Zap,
} from 'lucide-vue-next'

const { t } = useI18n()
const transferStore = useTransferStore()
const toast = useToast()
const notification = useNotification()

// 跟踪每个传输任务的通知 ID
const taskNotifications = ref<Map<string, string>>(new Map())

const activeTasks = computed(() => Array.from(transferStore.tasks.values()))
const hasActiveTasks = computed(() => activeTasks.value.length > 0)

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function getProgress(task: TransferTask): number {
  if (task.totalBytes === 0) return 0
  return Math.round((task.transferredBytes / task.totalBytes) * 100)
}

function getETA(task: TransferTask): string {
  if (task.speed === 0 || task.status !== 'transferring') return '--'
  const remaining = task.totalBytes - task.transferredBytes
  const seconds = remaining / task.speed
  return formatTime(seconds)
}

function getElapsedTime(task: TransferTask): string {
  if (!task.startTime) return '--'
  const end = task.endTime || Date.now()
  const seconds = (end - task.startTime) / 1000
  return formatTime(seconds)
}

async function handlePause(id: string) {
  try {
    await pauseTransfer(id)
    const task = transferStore.tasks.get(id)
    if (task) {
      transferStore.tasks.set(id, { ...task, status: 'paused' })
      transferStore.tasks = new Map(transferStore.tasks)
    }
  } catch (error) {
    toast.error(t('transfer.pauseFailed'), formatSftpError(error))
  }
}

async function handleResume(id: string) {
  try {
    const task = transferStore.tasks.get(id)
    if (!task) return

    // 立即更新 UI 状态，不等后端返回，避免用户感觉卡顿
    transferStore.tasks.set(id, { ...task, status: 'transferring' })
    transferStore.tasks = new Map(transferStore.tasks)

    await resumeTransfer(id, task.connectionId)
  } catch (error) {
    // 后端恢复失败，回滚 UI 状态为 paused
    const current = transferStore.tasks.get(id)
    if (current) {
      transferStore.tasks.set(id, { ...current, status: 'paused' })
      transferStore.tasks = new Map(transferStore.tasks)
    }
    toast.error(t('transfer.resumeFailed'), formatSftpError(error))
  }
}

// 清理任务关联的通知
function dismissTaskNotification(id: string) {
  const notificationId = taskNotifications.value.get(id)
  if (notificationId) {
    notification.dismiss(notificationId)
    taskNotifications.value.delete(id)
  }
}

// 移除任务并同步清理通知
function handleRemove(id: string) {
  dismissTaskNotification(id)
  transferStore.removeTask(id)
}

async function handleCancel(id: string) {
  try {
    await cancelTransfer(id)
    dismissTaskNotification(id)
    transferStore.removeTask(id)
  } catch (error) {
    toast.error(t('transfer.cancelFailed'), formatSftpError(error))
  }
}

function handleClearCompleted() {
  transferStore.clearCompleted()
}

async function handlePauseAll() {
  await Promise.allSettled(
    activeTasks.value
      .filter(task => task.status === 'transferring')
      .map(task => handlePause(task.id)),
  )
}

async function handleResumeAll() {
  await Promise.allSettled(
    activeTasks.value
      .filter(task => task.status === 'paused')
      .map(task => handleResume(task.id)),
  )
}

async function handleRetryAll() {
  await Promise.allSettled(
    activeTasks.value
      .filter(task => task.status === 'error' && task.retryable !== false)
      .map(task => handleRetry(task.id)),
  )
}

async function handleRetry(id: string) {
  const task = transferStore.tasks.get(id)
  if (!task) return

  // 移除失败的任务及其通知
  dismissTaskNotification(id)
  transferStore.removeTask(id)

  // 创建新任务重新传输
  const newId = crypto.randomUUID()
  transferStore.addTask({
    id: newId,
    type: task.type,
    fileName: task.fileName,
    localPath: task.localPath,
    remotePath: task.remotePath,
    connectionId: task.connectionId,
    totalBytes: task.totalBytes,
  })

  try {
    if (task.type === 'upload') {
      await startUploadChunked(newId, task.connectionId, task.localPath, task.remotePath)
    } else {
      await startDownloadChunked(newId, task.connectionId, task.remotePath, task.localPath)
    }
  } catch (error) {
    toast.error(t('transfer.retryFailed'), formatSftpError(error))
  }
}

// 统计
const transferringTasks = computed(() =>
  activeTasks.value.filter(t => t.status === 'transferring'),
)
const totalSpeed = computed(() =>
  transferringTasks.value.reduce((sum, t) => sum + t.speed, 0),
)
const totalRemaining = computed(() => {
  const remaining = transferringTasks.value.reduce(
    (sum, t) => sum + (t.totalBytes - t.transferredBytes),
    0,
  )
  if (totalSpeed.value === 0) return '--'
  return formatTime(remaining / totalSpeed.value)
})
const errorCount = computed(() =>
  activeTasks.value.filter(t => t.status === 'error').length,
)
const pausedCount = computed(() =>
  activeTasks.value.filter(t => t.status === 'paused').length,
)
const retryableErrorCount = computed(() =>
  activeTasks.value.filter(t => t.status === 'error' && t.retryable !== false).length,
)
const totalElapsed = computed(() => {
  // 取所有传输中任务中最早的开始时间
  const earliest = transferringTasks.value.reduce(
    (min, t) => t.startTime && t.startTime < min ? t.startTime : min,
    Date.now(),
  )
  if (transferringTasks.value.length === 0) return '--'
  const seconds = (Date.now() - earliest) / 1000
  return formatTime(seconds)
})

// 监听传输任务状态变化，显示通知
watch(
  () => transferStore.tasks,
  (newTasks) => {
    newTasks.forEach((task) => {
      const notificationId = taskNotifications.value.get(task.id)

      if (task.status === 'transferring') {
        // 创建或更新进度通知
        if (!notificationId) {
          const id = notification.progress(
            task.type === 'upload' ? t('transfer.uploading') : t('transfer.downloading'),
            getProgress(task),
            task.fileName
          )
          taskNotifications.value.set(task.id, id)
        } else {
          notification.updateProgress(notificationId, getProgress(task))
        }
      } else if (task.status === 'completed' && notificationId) {
        // 完成时显示成功通知
        notification.dismiss(notificationId)
        taskNotifications.value.delete(task.id)
        notification.success(
          task.type === 'upload' ? t('transfer.uploadComplete') : t('transfer.downloadComplete'),
          `${task.fileName} (${formatBytes(task.totalBytes)})`,
          3000
        )
      } else if (task.status === 'error' && notificationId) {
        // 失败时显示错误通知
        notification.dismiss(notificationId)
        taskNotifications.value.delete(task.id)
        notification.error(
          task.type === 'upload' ? t('transfer.uploadFailed') : t('transfer.downloadFailed'),
          task.fileName,
          true
        )
      }
    })
  },
)
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border/10 px-3 py-1.5 bg-muted/5">
      <div class="flex items-center gap-2">
        <Zap class="h-3 w-3 text-primary animate-pulse" />
        <span class="text-[11px] font-bold uppercase tracking-tight text-muted-foreground/60">
          {{ t('transfer.activeTransfers') }} ({{ activeTasks.length }})
        </span>
      </div>
      <div v-if="hasActiveTasks" class="flex items-center gap-1">
        <Button
          v-if="transferringTasks.length > 0"
          variant="ghost"
          size="sm"
          class="h-6 px-2 text-[10px] font-bold"
          @click="handlePauseAll"
        >
          <Pause class="mr-1 h-2.5 w-2.5" />
          暂停全部
        </Button>
        <Button
          v-if="pausedCount > 0"
          variant="ghost"
          size="sm"
          class="h-6 px-2 text-[10px] font-bold"
          @click="handleResumeAll"
        >
          <Play class="mr-1 h-2.5 w-2.5" />
          恢复全部
        </Button>
        <Button
          v-if="retryableErrorCount > 0"
          variant="ghost"
          size="sm"
          class="h-6 px-2 text-[10px] font-bold"
          @click="handleRetryAll"
        >
          <RotateCcw class="mr-1 h-2.5 w-2.5" />
          重试失败
        </Button>
        <Button
          v-if="errorCount > 0"
          variant="ghost"
          size="sm"
          class="h-6 px-2 text-[10px] font-bold hover:bg-destructive/10 hover:text-destructive"
          @click="transferStore.clearErrors()"
        >
          <X class="mr-1 h-2.5 w-2.5" />
          清理失败
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-6 px-2 text-[10px] font-bold hover:bg-destructive/10 hover:text-destructive"
          @click="handleClearCompleted"
        >
          <Trash2 class="mr-1 h-2.5 w-2.5" />
          {{ t('transfer.clearCompleted') }}
        </Button>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-if="!hasActiveTasks"
      class="flex flex-1 flex-col items-center justify-center text-center"
    >
      <ArrowUp class="mb-2 h-8 w-8 text-muted-foreground/50" />
      <p class="text-xs text-muted-foreground">{{ t('transfer.noActiveTransfers') }}</p>
      <p class="mt-1 text-xs text-muted-foreground/70">
        {{ t('transfer.noActiveTransfersHint') }}
      </p>
    </div>

    <!-- Transfer List -->
    <ScrollArea v-else class="flex-1 h-full">
      <div class="space-y-1.5 p-2">
        <div
          v-for="task in activeTasks"
          :key="task.id"
          class="relative group rounded-lg border border-border/20 bg-background/40 p-2.5 transition-[background-color,border-color] hover:bg-background/60 hover:border-border/40"
        >
          <!-- Task Header -->
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 flex-1 items-center gap-3">
              <!-- Type Icon Container -->
              <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/30 ring-1 ring-border/5 group-hover:bg-muted/50 transition-colors">
                <ArrowUp
                  v-if="task.type === 'upload'"
                  class="h-4 w-4 text-primary"
                />
                <ArrowDown v-else class="h-4 w-4 text-df-success" />
              </div>
 
              <!-- File Info -->
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                   <p class="truncate text-[12px] font-bold text-foreground/80 group-hover:text-foreground transition-colors">{{ task.fileName }}</p>
                   <span v-if="task.status === 'transferring'" class="text-[9px] font-black text-primary/60 bg-primary/5 px-1 rounded uppercase">LIVE</span>
                </div>
                <p class="truncate text-[10px] text-muted-foreground/60 font-medium">
                  {{ task.type === 'upload' ? task.localPath : task.remotePath }}
                </p>
              </div>
            </div>
 
            <!-- Action Buttons -->
            <div class="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <CheckCircle2
                v-if="task.status === 'completed'"
                class="h-4 w-4 text-df-success"
              />
              <template v-else-if="task.status === 'error'">
                <Button variant="ghost" size="icon" class="h-6 w-6 rounded-md hover:bg-primary/10" @click="handleRetry(task.id)">
                  <RotateCcw class="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" class="h-6 w-6 rounded-md hover:bg-destructive/10 hover:text-destructive" @click="handleRemove(task.id)">
                  <X class="h-3 w-3" />
                </Button>
              </template>
              <template v-else>
                <Button
                  v-if="task.status === 'transferring'"
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7 rounded-full bg-muted/20 hover:bg-primary/10 hover:text-primary active:scale-90"
                  @click="handlePause(task.id)"
                >
                  <Pause class="h-3.5 w-3.5 fill-current" />
                </Button>
                <Button
                  v-if="task.status === 'paused'"
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7 rounded-full bg-primary/10 text-primary hover:bg-primary/20 active:scale-90"
                  @click="handleResume(task.id)"
                >
                  <Play class="h-3.5 w-3.5 fill-current" />
                </Button>
                <Button
                  v-if="task.status === 'transferring' || task.status === 'paused'"
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7 rounded-full bg-muted/20 hover:bg-destructive/10 hover:text-destructive active:scale-90"
                  @click="handleCancel(task.id)"
                >
                  <X class="h-3.5 w-3.5" />
                </Button>
              </template>
            </div>
          </div>
 
          <!-- Progress Section -->
          <div class="mt-3 space-y-1.5">
            <!-- Progress Bar with Animation -->
            <div class="relative h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
               <div 
                 class="h-full transition-[width] duration-500 ease-out"
                 :class="[
                   task.status === 'completed' ? 'bg-df-success' :
                   task.status === 'error' ? 'bg-destructive' :
                   task.status === 'paused' ? 'bg-df-warning' : 'bg-primary shadow-[0_0_8px_rgba(var(--color-primary),0.4)]'
                 ]"
                 :style="{ width: `${getProgress(task)}%` }"
               >
                 <!-- Flow Animation Overlay -->
                 <div v-if="task.status === 'transferring'" class="absolute inset-0 w-full animate-progress-flow bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.2)_50%,transparent_100%)] bg-[length:200%_100%]"></div>
               </div>
            </div>
 
            <!-- Stats Grid -->
            <div class="flex items-center justify-between text-[10px] font-bold tracking-tight">
              <div class="flex items-center gap-2">
                <!-- 打包传输阶段显示 -->
                <template v-if="task.archivePhase">
                  <span v-if="task.archivePhase === 'packing'" class="text-df-warning">{{ t('transfer.packing') }}</span>
                  <span v-else-if="task.archivePhase === 'uploading'" class="text-primary">{{ t('transfer.archiveUploading') }}</span>
                  <span v-else-if="task.archivePhase === 'extracting'" class="text-primary">{{ t('transfer.extracting') }}</span>
                  <span v-else-if="task.archivePhase === 'completed'" class="text-df-success">{{ t('transfer.archiveCompleted') }}</span>
                  <span v-if="task.archiveFileCount" class="text-foreground/40">{{ task.archiveFileCount }} {{ t('transfer.files') }}</span>
                  <span v-if="task.archiveSize" class="text-foreground/40">{{ formatBytes(task.archiveSize) }}</span>
                </template>
                <!-- 普通传输进度 -->
                <template v-else>
                  <span class="text-foreground/60">{{ formatBytes(task.transferredBytes) }}</span>
                  <span class="text-muted-foreground/30 text-[8px]">OF</span>
                  <span class="text-foreground/40">{{ formatBytes(task.totalBytes) }}</span>
                  <span class="ml-1 rounded bg-muted/40 px-1 py-0.5 text-foreground/70">{{ getProgress(task) }}%</span>
                </template>
              </div>
              
              <div class="flex items-center gap-2">
                <span v-if="task.status === 'transferring'" class="flex items-center gap-1.5 text-primary">
                   <Zap class="h-2.5 w-2.5 animate-pulse" />
                   {{ formatSpeed(task.speed) }}
                   <span class="text-muted-foreground/40">•</span>
                   <span class="text-foreground/70">{{ t('transfer.remaining') }} {{ getETA(task) }}</span>
                   <span class="text-muted-foreground/40">•</span>
                   <span class="text-foreground/50">{{ t('transfer.elapsed') }} {{ getElapsedTime(task) }}</span>
                </span>
                <span v-else-if="task.status === 'paused'" class="text-df-warning uppercase tracking-widest text-[9px]">{{ t('transfer.paused') }}</span>
                <span v-else-if="task.status === 'completed'" class="text-df-success uppercase tracking-widest text-[9px]">{{ t('transfer.completed') }} · {{ getElapsedTime(task) }}</span>
                <span v-else-if="task.status === 'error'" class="text-destructive uppercase tracking-widest text-[9px]">
                  {{ task.errorKind ? `[${task.errorKind}] ` : '' }}{{ task.error || t('transfer.failed') }}
                  <span v-if="task.resumeHint === 'reconnect'" class="ml-1 text-muted-foreground/60">建议重连</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>

    <!-- 统计栏 -->
    <div
      v-if="hasActiveTasks"
      class="flex h-6 items-center justify-between border-t border-border/10 px-3 bg-muted/5 text-[9px] font-black uppercase tracking-tighter text-muted-foreground/40"
    >
      <div class="flex items-center gap-3">
        <span>{{ activeTasks.length }} {{ t('transfer.tasks') }}</span>
        <span v-if="transferringTasks.length > 0" class="flex items-center gap-1 text-primary/70">
           <Zap class="h-2 w-2" />
           {{ formatSpeed(totalSpeed) }}
        </span>
      </div>
      <div class="flex items-center gap-3">
        <span v-if="transferringTasks.length > 0">{{ t('transfer.remaining') }} {{ totalRemaining }}</span>
        <span v-if="transferringTasks.length > 0" class="text-muted-foreground/50">{{ t('transfer.elapsed') }} {{ totalElapsed }}</span>
        <span v-if="errorCount > 0" class="text-destructive font-black">
          {{ errorCount }} {{ t('transfer.failed') }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes progress-flow {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
.animate-progress-flow {
  animation: progress-flow 3s linear infinite;
}
</style>
