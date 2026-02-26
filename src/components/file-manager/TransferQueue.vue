<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTransferStore } from '@/stores/transfer'
import { pauseTransfer, resumeTransfer, cancelTransfer } from '@/api/sftp'
import { useToast } from '@/composables/useToast'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import Progress from '@/components/ui/progress.vue'
import {
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  XCircle,
  Pause,
  Play,
  X,
} from 'lucide-vue-next'

const { t } = useI18n()
const transferStore = useTransferStore()
const toast = useToast()

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

function getProgress(task: any): number {
  if (task.totalBytes === 0) return 0
  return Math.round((task.transferredBytes / task.totalBytes) * 100)
}

function getETA(task: any): string {
  if (task.speed === 0 || task.status !== 'transferring') return '--'
  const remaining = task.totalBytes - task.transferredBytes
  const seconds = remaining / task.speed
  return formatTime(seconds)
}

async function handlePause(id: string) {
  try {
    await pauseTransfer(id)
    const task = transferStore.tasks.get(id)
    if (task) {
      task.status = 'paused'
      transferStore.tasks = new Map(transferStore.tasks)
    }
  } catch (error) {
    toast.error(t('transfer.pauseFailed'), String(error))
  }
}

async function handleResume(id: string) {
  try {
    const task = transferStore.tasks.get(id)
    if (!task) return

    await resumeTransfer(id, task.connectionId)
    task.status = 'transferring'
    transferStore.tasks = new Map(transferStore.tasks)
  } catch (error) {
    toast.error(t('transfer.resumeFailed'), String(error))
  }
}

async function handleCancel(id: string) {
  try {
    await cancelTransfer(id)
    transferStore.removeTask(id)
  } catch (error) {
    toast.error(t('transfer.cancelFailed'), String(error))
  }
}

function handleClearCompleted() {
  transferStore.clearCompleted()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-3 py-2">
      <span class="text-xs font-medium text-muted-foreground">
        {{ t('transfer.activeTransfers') }} ({{ activeTasks.length }})
      </span>
      <Button
        v-if="hasActiveTasks"
        variant="ghost"
        size="sm"
        class="h-6 text-xs"
        @click="handleClearCompleted"
      >
        <Trash2 class="mr-1 h-3 w-3" />
        {{ t('transfer.clearCompleted') }}
      </Button>
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
      <div class="space-y-2 p-2">
        <div
          v-for="task in activeTasks"
          :key="task.id"
          class="rounded-md border border-border bg-card p-3"
        >
          <!-- Task Header -->
          <div class="mb-2 flex items-start justify-between gap-2">
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <!-- Type Icon -->
              <ArrowUp
                v-if="task.type === 'upload'"
                class="h-4 w-4 shrink-0 text-blue-500"
              />
              <ArrowDown v-else class="h-4 w-4 shrink-0 text-green-500" />

              <!-- File Info -->
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ task.fileName }}</p>
                <p class="truncate text-xs text-muted-foreground">
                  {{ task.type === 'upload' ? task.localPath : task.remotePath }}
                </p>
              </div>
            </div>

            <!-- Action Buttons -->
            <div class="flex shrink-0 items-center gap-1">
              <CheckCircle2
                v-if="task.status === 'completed'"
                class="h-4 w-4 text-green-500"
              />
              <XCircle
                v-else-if="task.status === 'error'"
                class="h-4 w-4 text-destructive"
              />
              <template v-else>
                <!-- Pause Button -->
                <Button
                  v-if="task.status === 'transferring'"
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6"
                  @click="handlePause(task.id)"
                >
                  <Pause class="h-3 w-3" />
                </Button>
                <!-- Resume Button -->
                <Button
                  v-if="task.status === 'paused'"
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6"
                  @click="handleResume(task.id)"
                >
                  <Play class="h-3 w-3" />
                </Button>
                <!-- Cancel Button -->
                <Button
                  v-if="task.status === 'transferring' || task.status === 'paused'"
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6"
                  @click="handleCancel(task.id)"
                >
                  <X class="h-3 w-3" />
                </Button>
              </template>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="mb-2">
            <Progress
              :model-value="getProgress(task)"
              class="h-1.5"
              :class="{
                '[&>div]:bg-green-500': task.status === 'completed',
                '[&>div]:bg-destructive': task.status === 'error',
              }"
            />
          </div>

          <!-- Transfer Stats -->
          <div class="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {{ formatBytes(task.transferredBytes) }} / {{ formatBytes(task.totalBytes) }}
              ({{ getProgress(task) }}%)
            </span>
            <span v-if="task.status === 'transferring'">
              {{ formatSpeed(task.speed) }} · ETA {{ getETA(task) }}
            </span>
            <span v-else-if="task.status === 'paused'" class="text-yellow-500">
              {{ t('transfer.paused') }}
            </span>
            <span v-else-if="task.status === 'completed'" class="text-green-500">
              {{ t('transfer.completed') }}
            </span>
            <span v-else-if="task.status === 'error'" class="text-destructive">
              {{ task.error || t('transfer.failed') }}
            </span>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
