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

const glowMap = {
  success: 'bg-green-500',
  error: 'bg-destructive',
  warning: 'bg-yellow-500',
  info: 'bg-blue-500',
  loading: 'bg-muted-foreground',
  progress: 'bg-blue-500',
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

// 消息按日期分组
const groupedMessages = computed(() => {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = today - 86400000

  const groups: { title: string; items: Message[] }[] = [
    { title: t('messageCenter.today'), items: [] },
    { title: t('messageCenter.yesterday'), items: [] },
    { title: t('messageCenter.older'), items: [] },
  ]

  messageCenter.messages.forEach((msg) => {
    if (msg.timestamp >= today) {
      groups[0]!.items.push(msg)
    } else if (msg.timestamp >= yesterday) {
      groups[1]!.items.push(msg)
    } else {
      groups[2]!.items.push(msg)
    }
  })

  return groups.filter((g) => g.items.length > 0)
})
</script>

<template>
  <!-- Backdrop (click to close) -->
  <div
    v-if="messageCenter.isOpen"
    class="fixed inset-0 z-[99]"
    @click="messageCenter.togglePanel()"
  />
  <!-- Panel: Glassmorphism effect with responsive height -->
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="translate-y-1 opacity-0 scale-95"
    enter-to-class="translate-y-0 opacity-100 scale-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="translate-y-0 opacity-100 scale-100"
    leave-to-class="translate-y-1 opacity-0 scale-95"
  >
    <div
      v-if="messageCenter.isOpen"
      class="absolute right-0 top-full z-[100] flex max-h-[min(600px,calc(100vh-120px))] w-[400px] flex-col border border-border/50 bg-background/80 shadow-2xl backdrop-blur-xl rounded-b-xl overflow-hidden"
    >
      <!-- Header -->
      <div class="flex h-12 items-center justify-between border-b border-border/30 px-4 bg-muted/20">
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold uppercase tracking-widest text-muted-foreground">{{ t('messageCenter.title') }}</span>
          <Transition name="fade" mode="out-in">
            <span :key="messageCenter.messages.length" class="flex h-5 items-center rounded-full bg-primary/10 px-2 text-[10px] font-bold text-primary">
              {{ messageCenter.messages.length }}
            </span>
          </Transition>
        </div>
        <div class="flex items-center gap-1.5">
          <button
            v-if="hasMessages"
            class="rounded-md p-1.5 text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive active:scale-95"
            :title="t('messageCenter.clearAll')"
            @click="messageCenter.clearAll()"
          >
            <Trash2 class="h-4 w-4" />
          </button>
          <button
            class="rounded-md p-1.5 text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-95"
            :title="t('messageCenter.close')"
            @click="messageCenter.togglePanel()"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>

      <!-- Message List Wrapper: Using native scroll with proven styles for maximum stability -->
      <div class="flex-1 min-h-0 overflow-y-auto qr-scroll-area px-3 pb-4">
        <div v-if="!hasMessages" class="flex min-h-[200px] flex-col items-center justify-center p-8 text-center">
          <div class="mb-4 rounded-full bg-muted/30 p-4">
            <Info class="h-8 w-8 text-muted-foreground/40" />
          </div>
          <p class="text-sm font-medium text-muted-foreground">{{ t('messageCenter.noMessages') }}</p>
        </div>
        
        <div v-else>
          <div v-for="group in groupedMessages" :key="group.title" class="pt-4 first:pt-2">
            <!-- Group Sticky Label: More pronounced blur for clarity -->
            <div class="sticky top-0 z-20 -mx-3 -mt-4 mb-2 bg-background/60 px-4 py-2 backdrop-blur-md border-b border-border/10 transition-all">
              <span class="text-[10px] font-bold uppercase tracking-widest text-primary/70">{{ group.title }}</span>
            </div>
            
            <div class="space-y-3 pb-2">
              <TransitionGroup
                enter-active-class="transition duration-300 ease-out"
                enter-from-class="-translate-x-4 opacity-0"
                enter-to-class="translate-x-0 opacity-100"
                leave-active-class="transition duration-200 ease-in absolute"
                leave-from-class="opacity-100"
                leave-to-class="opacity-0 scale-95"
                move-class="transition duration-300 ease-in-out"
              >
                <div
                  v-for="msg in group.items"
                  :key="msg.id"
                  class="group relative flex gap-3 rounded-lg border border-border/20 bg-muted/15 p-3.5 transition-all hover:translate-y-[-1px] hover:border-border/60 hover:bg-muted/30 hover:shadow-md"
                >
                  <!-- Status Glow Indicator -->
                  <div 
                    class="absolute left-0 top-3 bottom-3 w-1 rounded-full opacity-60 transition-all group-hover:opacity-100"
                    :class="glowMap[msg.type]"
                  />

                  <!-- Icon -->
                  <component
                    :is="iconMap[msg.type]"
                    class="h-4 w-4 shrink-0 mt-0.5"
                    :class="[colorMap[msg.type], msg.type === 'loading' ? 'animate-spin' : '']"
                  />

                  <!-- Content -->
                  <div class="flex-1 min-w-0">
                    <div class="flex items-start justify-between gap-2">
                      <p class="text-sm font-bold leading-tight text-foreground/90">{{ msg.title }}</p>
                      <button
                        class="shrink-0 rounded-md p-1 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        @click="messageCenter.deleteMessage(msg.id)"
                      >
                        <X class="h-3.5 w-3.5" />
                      </button>
                    </div>
                    
                    <p v-if="msg.description" class="mt-1.5 text-[11px] text-muted-foreground/80 leading-relaxed break-words line-clamp-4 group-hover:line-clamp-none">
                      {{ msg.description }}
                    </p>

                    <!-- Progress Bar -->
                    <div v-if="msg.type === 'progress' && msg.progress !== undefined" class="mt-3">
                      <div class="flex items-center justify-between text-[10px] font-bold text-muted-foreground mb-1.5">
                        <span class="uppercase tracking-wider">{{ t('messageCenter.progress') }}</span>
                        <span class="tabular-nums">{{ msg.progress }}%</span>
                      </div>
                      <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted/50 ring-1 ring-border/10">
                        <div
                          class="h-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)] transition-all duration-300"
                          :style="{ width: `${msg.progress}%` }"
                        />
                      </div>
                    </div>

                    <!-- Action Buttons -->
                    <div v-if="msg.actions && msg.actions.length > 0" class="mt-3 flex gap-2">
                      <Button
                        v-for="(action, index) in msg.actions"
                        :key="index"
                        :variant="action.variant || 'default'"
                        size="sm"
                        class="h-7 text-[10px] font-bold uppercase tracking-wider px-3"
                        @click="action.action()"
                      >
                        {{ action.label }}
                      </Button>
                    </div>

                    <div class="mt-2.5 flex items-center justify-between">
                      <span class="text-[10px] font-medium text-muted-foreground/40 tabular-nums">
                        {{ formatTime(msg.timestamp) }}
                      </span>
                    </div>
                  </div>
                </div>
              </TransitionGroup>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
