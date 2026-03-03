<script setup lang="ts">
import { computed } from 'vue'
import { useMessageCenterStore } from '@/stores/message-center'
import { useI18n } from 'vue-i18n'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CheckCircle2, XCircle, AlertTriangle, Info, Loader2, Trash2, X, TrendingUp } from 'lucide-vue-next'
import type { Message } from '@/stores/message-center'
import { Button } from '@/components/ui/button'

const { t } = useI18n()
const messageCenter = useMessageCenterStore()

const iconMap = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  loading: Loader2,
  progress: TrendingUp,
}

const colorMap = {
  success: 'text-green-500',
  error: 'text-destructive',
  warning: 'text-yellow-500',
  info: 'text-blue-500',
  loading: 'text-muted-foreground',
  progress: 'text-blue-500',
}

function formatTime(timestamp: number) {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}${t('messageCenter.daysAgo')}`
  if (hours > 0) return `${hours}${t('messageCenter.hoursAgo')}`
  if (minutes > 0) return `${minutes}${t('messageCenter.minutesAgo')}`
  return t('messageCenter.justNow')
}

const hasMessages = computed(() => messageCenter.messages.length > 0)
</script>

<template>
  <!-- Backdrop (click to close) -->
  <div
    v-if="messageCenter.isOpen"
    class="fixed inset-0 z-[99]"
    @click="messageCenter.togglePanel()"
  />
  <!-- Panel -->
  <div
    v-if="messageCenter.isOpen"
    class="absolute right-0 top-full z-[100] flex h-[400px] w-[360px] flex-col border border-border bg-background shadow-lg rounded-b-lg"
  >
    <!-- Header -->
    <div class="flex h-10 items-center justify-between border-b border-border px-3">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium">{{ t('messageCenter.title') }}</span>
        <span class="text-xs text-muted-foreground">
          ({{ messageCenter.messages.length }})
        </span>
      </div>
      <div class="flex items-center gap-1">
        <button
          v-if="hasMessages"
          class="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          :title="t('messageCenter.clearAll')"
          @click="messageCenter.clearAll()"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </button>
        <button
          class="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          :title="t('messageCenter.close')"
          @click="messageCenter.togglePanel()"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <!-- Message List -->
    <ScrollArea class="flex-1">
      <div v-if="!hasMessages" class="flex h-full items-center justify-center">
        <p class="text-sm text-muted-foreground">{{ t('messageCenter.noMessages') }}</p>
      </div>
      <div v-else class="divide-y divide-border">
        <div
          v-for="msg in messageCenter.messages"
          :key="msg.id"
          class="group relative flex gap-3 p-3 transition-colors hover:bg-muted/30"
        >
          <!-- Icon -->
          <component
            :is="iconMap[msg.type]"
            class="h-4 w-4 shrink-0 mt-0.5"
            :class="[colorMap[msg.type], msg.type === 'loading' ? 'animate-spin' : '']"
          />

          <!-- Content -->
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <p class="text-sm font-medium leading-tight">{{ msg.title }}</p>
              <button
                class="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                @click="messageCenter.deleteMessage(msg.id)"
              >
                <X class="h-3 w-3" />
              </button>
            </div>
            <p v-if="msg.description" class="mt-1 text-xs text-muted-foreground leading-tight">
              {{ msg.description }}
            </p>

            <!-- Progress Bar -->
            <div v-if="msg.type === 'progress' && msg.progress !== undefined" class="mt-2">
              <div class="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>{{ t('messageCenter.progress') }}</span>
                <span>{{ msg.progress }}%</span>
              </div>
              <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full bg-blue-500 transition-all duration-300"
                  :style="{ width: `${msg.progress}%` }"
                />
              </div>
            </div>

            <!-- Action Buttons -->
            <div v-if="msg.actions && msg.actions.length > 0" class="mt-2 flex gap-2">
              <Button
                v-for="(action, index) in msg.actions"
                :key="index"
                :variant="action.variant || 'default'"
                size="sm"
                class="h-7 text-xs"
                @click="action.action()"
              >
                {{ action.label }}
              </Button>
            </div>

            <p class="mt-1 text-xs text-muted-foreground">
              {{ formatTime(msg.timestamp) }}
            </p>
          </div>
        </div>
      </div>
    </ScrollArea>
    </div>
</template>
