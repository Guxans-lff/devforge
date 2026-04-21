<script setup lang="ts">
/**
 * AI 会话列表组件
 *
 * 显示所有对话会话，支持搜索、新建、切换、删除。
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiSession } from '@/types/ai'
import { Plus, MessageSquare, Trash2, Search } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'

const props = defineProps<{
  sessions: AiSession[]
  activeSessionId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
  create: []
  delete: [id: string]
}>()

const { t } = useI18n()
const searchQuery = ref('')

const filteredSessions = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return props.sessions
  return props.sessions.filter(s =>
    s.title.toLowerCase().includes(q),
  )
})

/** 格式化时间为相对时间 */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('ai.sessions.justNow')
  if (minutes < 60) return t('ai.sessions.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('ai.sessions.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('ai.sessions.daysAgo', { count: days })
  return new Date(ts).toLocaleDateString('zh-CN')
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 搜索 + 新建 -->
    <div class="flex items-center gap-2 px-3 py-2 border-b border-border/50">
      <div class="relative flex-1">
        <Search class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="searchQuery"
          :placeholder="t('ai.sessions.searchPlaceholder')"
          class="h-8 pl-8 text-xs"
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0"
        :title="t('ai.sessions.newChat')"
        @click="emit('create')"
      >
        <Plus class="h-4 w-4" />
      </Button>
    </div>

    <!-- 会话列表 -->
    <ScrollArea class="flex-1 min-h-0">
      <div class="p-1.5 space-y-0.5">
        <!-- 空状态 -->
        <div
          v-if="filteredSessions.length === 0"
          class="flex flex-col items-center justify-center py-8 text-center"
        >
          <MessageSquare class="h-8 w-8 text-muted-foreground/30 mb-2" />
          <p class="text-xs text-muted-foreground">
            {{ searchQuery ? t('ai.sessions.emptySearch') : t('ai.sessions.emptyList') }}
          </p>
          <Button
            v-if="!searchQuery"
            variant="outline"
            size="sm"
            class="mt-3 h-7 text-[11px]"
            @click="emit('create')"
          >
            <Plus class="mr-1 h-3 w-3" />
            {{ t('ai.sessions.startNewChat') }}
          </Button>
        </div>

        <!-- 会话项 -->
        <button
          v-for="session in filteredSessions"
          :key="session.id"
          class="group w-full flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
          :class="{ 'bg-primary/5 border border-primary/10': session.id === activeSessionId }"
          @click="emit('select', session.id)"
        >
          <MessageSquare class="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <p class="text-xs font-medium truncate">{{ session.title }}</p>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="text-[10px] text-muted-foreground">{{ session.model }}</span>
              <span class="text-[10px] text-muted-foreground">{{ formatRelativeTime(session.updatedAt) }}</span>
            </div>
          </div>
          <!-- 删除按钮 -->
          <button
            class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-all"
            :title="t('ai.sessions.deleteSession')"
            @click.stop="emit('delete', session.id)"
          >
            <Trash2 class="h-3 w-3" />
          </button>
        </button>
      </div>
    </ScrollArea>
  </div>
</template>
