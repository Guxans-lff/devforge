<script setup lang="ts">
import { computed } from 'vue'
import { Activity, AlertTriangle, Bot, CheckCircle2, KeyRound, MessageSquare, Route, Wrench, ClipboardList } from 'lucide-vue-next'
import type { AiTranscriptEvent, AiTranscriptEventType } from '@/composables/ai-agent/transcript/transcriptTypes'

const props = defineProps<{
  events: AiTranscriptEvent[]
  totalCount?: number
}>()

const displayEvents = computed(() => [...props.events].reverse().slice(0, 30))

const eventTypeCounts = computed(() => {
  const counts = new Map<AiTranscriptEventType, number>()
  for (const event of props.events) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1)
  }
  return Array.from(counts.entries()).map(([type, count]) => ({ type, count }))
})

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${hour}:${minute}:${second}`
}

function typeLabel(type: AiTranscriptEventType): string {
  switch (type) {
    case 'turn_start': return '回合开始'
    case 'turn_end': return '回合结束'
    case 'user_message': return '用户消息'
    case 'assistant_message': return '助手消息'
    case 'tool_call': return '工具调用'
    case 'tool_result': return '工具结果'
    case 'stream_error': return '流错误'
    case 'compact': return '压缩'
    case 'recovery': return '恢复'
    case 'permission': return '权限'
    case 'plan_status': return '计划'
    case 'usage': return '用量'
    case 'routing': return '路由'
    default: return type
  }
}

function typeClass(type: AiTranscriptEventType): string {
  switch (type) {
    case 'stream_error': return 'text-rose-300 bg-rose-500/10'
    case 'recovery': return 'text-amber-300 bg-amber-500/10'
    case 'tool_call':
    case 'tool_result': return 'text-cyan-300 bg-cyan-500/10'
    case 'plan_status': return 'text-violet-300 bg-violet-500/10'
    case 'routing': return 'text-sky-300 bg-sky-500/10'
    case 'permission': return 'text-orange-300 bg-orange-500/10'
    case 'turn_end': return 'text-emerald-300 bg-emerald-500/10'
    default: return 'text-muted-foreground bg-muted/30'
  }
}

function typeIcon(type: AiTranscriptEventType) {
  switch (type) {
    case 'user_message': return MessageSquare
    case 'assistant_message': return Bot
    case 'tool_call':
    case 'tool_result': return Wrench
    case 'stream_error':
    case 'recovery': return AlertTriangle
    case 'permission': return KeyRound
    case 'plan_status': return ClipboardList
    case 'routing': return Route
    case 'turn_end': return CheckCircle2
    default: return Activity
  }
}

function eventSummary(event: AiTranscriptEvent): string {
  const { payload } = event
  switch (payload.type) {
    case 'turn_start':
      return `turn=${payload.data.turnId}`
    case 'turn_end':
      return `${payload.data.status} · ${payload.data.durationMs}ms`
    case 'user_message':
      return payload.data.contentPreview || '(empty)'
    case 'assistant_message':
      return payload.data.contentPreview || '(empty)'
    case 'tool_call':
      return `${payload.data.toolName}${payload.data.path ? ` · ${payload.data.path}` : ''}`
    case 'tool_result':
      return `${payload.data.toolName} · ${payload.data.success ? 'success' : 'failed'}`
    case 'stream_error':
      return payload.data.error
    case 'compact':
      return `${payload.data.trigger} · ${payload.data.originalMessageCount} messages`
    case 'recovery':
      return `${payload.data.reason} · attempt ${payload.data.attempt}`
    case 'permission':
      return `${payload.data.toolName} · ${payload.data.decision}`
    case 'plan_status':
      return `${payload.data.status}${payload.data.stepTitle ? ` · ${payload.data.stepTitle}` : ''}`
    case 'usage':
      return `${payload.data.totalTokens} tokens`
    case 'routing':
      return payload.data.toProviderId ? `${payload.data.reason} · ${payload.data.toProviderId}` : payload.data.reason
    default:
      return ''
  }
}
</script>

<template>
  <section class="mt-3 rounded-2xl border border-border/25 bg-background/55 p-4">
    <div class="mb-3 flex items-center justify-between gap-3">
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
          Transcript Timeline
        </h3>
        <p class="mt-1 text-[11px] text-muted-foreground/55">
          最近 {{ displayEvents.length }} 条 / 共 {{ totalCount ?? events.length }} 条事件
        </p>
      </div>
      <div class="flex flex-wrap justify-end gap-1">
        <span
          v-for="item in eventTypeCounts.slice(0, 6)"
          :key="item.type"
          class="rounded-full px-2 py-0.5 text-[10px]"
          :class="typeClass(item.type)"
        >
          {{ typeLabel(item.type) }} {{ item.count }}
        </span>
      </div>
    </div>

    <div v-if="displayEvents.length === 0" class="rounded-lg border border-dashed border-border/30 py-5 text-center text-[11px] text-muted-foreground/55">
      当前会话暂无 transcript 事件。
    </div>

    <div v-else class="max-h-64 space-y-1 overflow-y-auto pr-1" data-testid="transcript-timeline">
      <div
        v-for="event in displayEvents"
        :key="event.id"
        class="flex items-start gap-2 rounded-lg border border-border/20 bg-muted/15 px-2.5 py-2"
        :data-event-type="event.type"
      >
        <component
          :is="typeIcon(event.type)"
          class="mt-0.5 h-3.5 w-3.5 shrink-0"
          :class="typeClass(event.type)"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-medium" :class="typeClass(event.type)">
              {{ typeLabel(event.type) }}
            </span>
            <span class="font-mono text-[9px] text-muted-foreground/45">
              {{ formatTime(event.timestamp) }}
            </span>
            <span v-if="event.turnId" class="truncate font-mono text-[9px] text-muted-foreground/45">
              {{ event.turnId }}
            </span>
          </div>
          <div class="mt-0.5 truncate text-[11px] text-foreground/75">
            {{ eventSummary(event) }}
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
