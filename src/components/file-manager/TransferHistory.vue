<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTransferStore } from '@/stores/transfer'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { ArrowUp, ArrowDown, CheckCircle2, XCircle, Trash2 } from 'lucide-vue-next'

const { t } = useI18n()
const transferStore = useTransferStore()

const historyItems = computed(() => transferStore.history)

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

function formatDuration(startTime?: number, endTime?: number): string {
  if (!startTime || !endTime) return '--'
  const seconds = Math.floor((endTime - startTime) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '--'
  const date = new Date(timestamp)
  return date.toLocaleString()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-3 py-2">
      <span class="text-xs font-medium text-muted-foreground">
        {{ t('transfer.history') }} ({{ historyItems.length }})
      </span>
      <Button
        v-if="historyItems.length > 0"
        variant="ghost"
        size="sm"
        class="h-6 text-xs"
        @click="transferStore.clearHistory()"
      >
        <Trash2 class="mr-1 h-3 w-3" />
        {{ t('transfer.clearHistory') }}
      </Button>
    </div>

    <!-- Empty State -->
    <div
      v-if="historyItems.length === 0"
      class="flex flex-1 flex-col items-center justify-center text-center"
    >
      <p class="text-xs text-muted-foreground">{{ t('transfer.noHistory') }}</p>
    </div>

    <!-- History List -->
    <ScrollArea v-else class="flex-1 h-full">
      <div class="space-y-1 p-2">
        <div
          v-for="item in historyItems"
          :key="item.id"
          class="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs"
        >
          <!-- Type Icon -->
          <ArrowUp v-if="item.type === 'upload'" class="h-4 w-4 shrink-0 text-blue-500" />
          <ArrowDown v-else class="h-4 w-4 shrink-0 text-green-500" />

          <!-- Status Icon -->
          <CheckCircle2 v-if="item.status === 'completed'" class="h-4 w-4 shrink-0 text-green-500" />
          <XCircle v-else class="h-4 w-4 shrink-0 text-destructive" />

          <!-- File Info -->
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium">{{ item.fileName }}</p>
            <p class="truncate text-muted-foreground">
              {{ formatBytes(item.totalBytes) }} · {{ formatDuration(item.startTime, item.endTime) }}
            </p>
          </div>

          <!-- Time -->
          <div class="shrink-0 text-right text-muted-foreground">
            <p>{{ formatTime(item.endTime) }}</p>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
