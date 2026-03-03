<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTransferStore } from '@/stores/transfer'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { ArrowUp, ArrowDown, CheckCircle2, XCircle, Trash2, Clock } from 'lucide-vue-next'

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
    <div class="flex items-center justify-between border-b border-border/10 px-3 py-1.5 bg-muted/5">
      <div class="flex items-center gap-2">
        <Clock class="h-3 w-3 text-muted-foreground/60" />
        <span class="text-[11px] font-black uppercase tracking-tight text-muted-foreground/60">
          {{ t('transfer.history') }} ({{ historyItems.length }})
        </span>
      </div>
      <Button
        v-if="historyItems.length > 0"
        variant="ghost"
        size="sm"
        class="h-6 px-2 text-[10px] font-bold hover:bg-destructive/10 hover:text-destructive"
        @click="transferStore.clearHistory()"
      >
        <Trash2 class="mr-1 h-2.5 w-2.5" />
        {{ t('transfer.clearHistory') }}
      </Button>
    </div>

    <!-- Empty State -->
    <div
      v-if="historyItems.length === 0"
      class="flex flex-1 flex-col items-center justify-center p-8 text-center text-xs text-muted-foreground opacity-50"
    >
      <Clock class="mb-2 h-8 w-8 stroke-[1.5]" />
      {{ t('transfer.noHistory') }}
    </div>

    <!-- History List -->
    <ScrollArea v-else class="flex-1 h-full">
      <div class="space-y-1.5 p-2">
        <div
          v-for="item in historyItems"
          :key="item.id"
          class="group flex items-center gap-3 rounded-lg border border-border/20 bg-background/40 px-3 py-2.5 transition-all hover:bg-background/60"
        >
          <!-- Status Icon Indicator -->
          <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/30 group-hover:bg-muted/50 transition-colors">
            <CheckCircle2 v-if="item.status === 'completed'" class="h-4 w-4 text-emerald-500" />
            <XCircle v-else class="h-4 w-4 text-destructive" />
          </div>

          <!-- File Info -->
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="truncate text-[11px] font-bold text-foreground/80 group-hover:text-foreground transition-colors">{{ item.fileName }}</p>
              <ArrowUp v-if="item.type === 'upload'" class="h-2.5 w-2.5 text-primary/60" />
              <ArrowDown v-else class="h-2.5 w-2.5 text-emerald-500/60" />
            </div>
            <p class="truncate text-[9px] font-medium text-muted-foreground/50">
              {{ formatBytes(item.totalBytes) }} <span class="mx-1 opacity-30">•</span> {{ formatDuration(item.startTime, item.endTime) }}
            </p>
          </div>

          <!-- Time -->
          <div class="shrink-0 text-right font-mono text-[9px] font-black tracking-tight text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors">
            <p>{{ formatTime(item.endTime) }}</p>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
