<script setup lang="ts">
/**
 * AI Panel — AI 会话列表面板
 *
 * 显示 AI 会话列表 + 新建对话按钮 + 当前模型信息。
 * 点击会话打开对应 AI Tab。
 */
import { computed, onMounted } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAiChatStore } from '@/stores/ai-chat'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  Bot,
  Plus,
  MessageSquare,
  Sparkles,
} from 'lucide-vue-next'

const workspace = useWorkspaceStore()
const aiStore = useAiChatStore()

onMounted(() => {
  aiStore.init()
})

/** 当前活跃 AI Tab 对应的 sessionId */
const activeSessionId = computed(() => {
  const tab = workspace.activeTab
  if (tab?.type === 'ai-chat') return tab.meta?.sessionId ?? null
  return null
})

/** 默认模型信息 */
const defaultModelName = computed(() => {
  const provider = aiStore.defaultProvider
  if (!provider) return null
  const model = provider.models?.[0]
  return model ? `${provider.name} / ${model.name}` : provider.name
})

/** 格式化相对时间 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(timestamp).toLocaleDateString()
}

function openSession(sessionId: string, title: string) {
  workspace.addTab({
    id: `ai-chat-${sessionId}`,
    type: 'ai-chat',
    title,
    closable: true,
    meta: { sessionId },
  })
}

function createNewSession() {
  const sessionId = `session-${Date.now()}`
  workspace.addTab({
    id: `ai-chat-${sessionId}`,
    type: 'ai-chat',
    title: 'AI 对话',
    closable: true,
    meta: { sessionId },
  })
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 头部：模型信息 + 新建按钮 -->
    <div class="flex items-center justify-between px-3 pt-3 pb-2">
      <div v-if="defaultModelName" class="flex items-center gap-1.5 min-w-0">
        <Sparkles class="h-3.5 w-3.5 shrink-0 text-primary" />
        <span class="text-[11px] text-muted-foreground truncate">{{ defaultModelName }}</span>
      </div>
      <div v-else class="text-[11px] text-muted-foreground/50">未配置模型</div>

      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
        @click="createNewSession"
      >
        <Plus class="h-4 w-4" />
      </Button>
    </div>

    <!-- 会话列表 -->
    <ScrollArea class="flex-1 min-h-0">
      <!-- 空状态 -->
      <div
        v-if="aiStore.sessions.length === 0"
        class="flex flex-col items-center justify-center py-10 text-center"
      >
        <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted/30">
          <Bot class="h-5 w-5 text-muted-foreground/30" />
        </div>
        <p class="text-xs text-muted-foreground/60 mb-3">暂无对话</p>
        <Button
          variant="outline"
          size="sm"
          class="h-7 px-3 text-[11px]"
          @click="createNewSession"
        >
          <Plus class="mr-1.5 h-3 w-3" />
          新建对话
        </Button>
      </div>

      <!-- 会话列表 -->
      <div v-else class="px-1 py-1">
        <button
          v-for="session in aiStore.sessions"
          :key="session.id"
          class="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/50 transition-colors"
          :class="{
            'bg-primary/5 ring-1 ring-primary/20': activeSessionId === session.id,
          }"
          @click="openSession(session.id, session.title)"
        >
          <MessageSquare class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <div class="text-xs font-medium truncate">{{ session.title }}</div>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="text-[10px] text-muted-foreground/50">{{ session.model }}</span>
              <span class="text-[10px] text-muted-foreground/30">{{ formatRelativeTime(session.updatedAt) }}</span>
            </div>
          </div>
          <span class="text-[10px] text-muted-foreground/40 shrink-0">{{ session.messageCount }}</span>
        </button>
      </div>
    </ScrollArea>
  </div>
</template>
