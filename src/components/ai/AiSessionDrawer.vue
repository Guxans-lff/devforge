<script setup lang="ts">
/**
 * AI 历史会话抽屉（Sheet）
 *
 * 从左侧滑出，展示历史对话列表，支持搜索、切换、删除。
 */
import { ref, computed } from 'vue'
import type { AiSession } from '@/types/ai'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageSquare, Trash2, Search, Plus } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  sessions: AiSession[]
  activeSessionId: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  select: [id: string]
  create: []
  delete: [id: string]
}>()

const searchQuery = ref('')

/** 待确认删除的会话 ID */
const deleteConfirmId = ref<string | null>(null)

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
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

function handleSelect(id: string) {
  emit('select', id)
  emit('update:open', false)
}

function handleCreate() {
  emit('create')
  emit('update:open', false)
}
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent side="left" class="w-[320px] p-0">
      <SheetHeader class="px-4 pt-4 pb-3 border-b border-border/50">
        <SheetTitle class="text-sm">历史对话</SheetTitle>
        <SheetDescription class="text-xs text-muted-foreground">
          切换或管理你的 AI 对话会话
        </SheetDescription>
      </SheetHeader>

      <div class="flex flex-col h-[calc(100%-80px)]">
        <!-- 搜索 + 新建 -->
        <div class="flex items-center gap-2 px-4 py-3">
          <div class="relative flex-1">
            <Search class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              v-model="searchQuery"
              placeholder="搜索会话…"
              class="h-8 pl-8 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            class="h-8 w-8 shrink-0"
            title="新建对话"
            @click="handleCreate"
          >
            <Plus class="h-4 w-4" />
          </Button>
        </div>

        <!-- 会话列表 -->
        <ScrollArea class="flex-1 min-h-0">
          <div class="px-3 pb-3 space-y-0.5">
            <!-- 空状态 -->
            <div
              v-if="filteredSessions.length === 0"
              class="flex flex-col items-center justify-center py-12 text-center"
            >
              <MessageSquare class="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p class="text-xs text-muted-foreground">
                {{ searchQuery ? '未找到匹配会话' : '暂无历史对话' }}
              </p>
            </div>

            <!-- 会话项 -->
            <button
              v-for="session in filteredSessions"
              :key="session.id"
              class="group w-full flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
              :class="{ 'bg-primary/5 border border-primary/10': session.id === activeSessionId }"
              @click="handleSelect(session.id)"
            >
              <MessageSquare class="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
              <div class="min-w-0 flex-1">
                <p class="text-xs font-medium truncate">{{ session.title }}</p>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="text-[10px] text-muted-foreground">{{ session.model }}</span>
                  <span class="text-[10px] text-muted-foreground">{{ formatRelativeTime(session.updatedAt) }}</span>
                </div>
              </div>
              <!-- 删除按钮（两步确认） -->
              <button
                v-if="deleteConfirmId !== session.id"
                class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-all"
                title="删除会话"
                @click.stop="deleteConfirmId = session.id"
              >
                <Trash2 class="h-3 w-3" />
              </button>
              <button
                v-else
                class="px-1.5 py-0.5 rounded bg-destructive/10 text-destructive text-[10px] font-medium transition-all"
                @click.stop="emit('delete', session.id); deleteConfirmId = null"
              >
                确认删除
              </button>
            </button>
          </div>
        </ScrollArea>
      </div>
    </SheetContent>
  </Sheet>
</template>
