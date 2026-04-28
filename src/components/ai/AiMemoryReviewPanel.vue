<script setup lang="ts">
import { useAiMemoryStore, type MemoryProposal } from '@/stores/ai-memory'
import { Check, X, Brain, Lightbulb, ShieldAlert, BookOpen, User, Bug } from 'lucide-vue-next'

const memoryStore = useAiMemoryStore()

const typeIcons: Record<string, unknown> = {
  project_rule: ShieldAlert,
  architecture_decision: Lightbulb,
  bug_lesson: Bug,
  user_preference: User,
  domain_knowledge: BookOpen,
  knowledge: Brain,
  summary: Brain,
  preference: User,
}

const typeLabels: Record<string, string> = {
  project_rule: '项目规则',
  architecture_decision: '架构决策',
  bug_lesson: '踩坑记录',
  user_preference: '用户偏好',
  domain_knowledge: '领域知识',
  knowledge: '知识',
  summary: '摘要',
  preference: '偏好',
}

function typeIcon(type: string) {
  return (typeIcons[type] ?? Brain) as typeof Brain
}

function typeLabel(type: string) {
  return typeLabels[type] ?? type
}

async function approve(p: MemoryProposal) {
  await memoryStore.approveProposal(p.id)
}

function reject(p: MemoryProposal) {
  memoryStore.rejectProposal(p.id)
}
</script>

<template>
  <div v-if="memoryStore.pendingProposals.length > 0" class="space-y-3">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
        待审核记忆
      </h3>
      <span class="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-400">
        {{ memoryStore.pendingProposals.length }}
      </span>
    </div>

    <div class="space-y-2">
      <div
        v-for="p in memoryStore.pendingProposals"
        :key="p.id"
        class="rounded-xl border border-border/25 bg-muted/10 p-3"
      >
        <div class="flex items-center gap-2">
          <component :is="typeIcon(p.type)" class="h-3.5 w-3.5 text-muted-foreground/60" />
          <span class="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {{ typeLabel(p.type) }}
          </span>
          <span class="ml-auto text-[10px] text-muted-foreground/40">
            {{ new Date(p.proposedAt).toLocaleTimeString('zh-CN') }}
          </span>
        </div>

        <p class="mt-1.5 text-sm font-medium text-foreground/85">{{ p.title }}</p>
        <p class="mt-0.5 text-xs leading-5 text-muted-foreground/70 line-clamp-3">{{ p.content }}</p>

        <div class="mt-2 flex items-center gap-2">
          <button
            class="flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400 transition-colors hover:bg-emerald-500/20"
            @click="approve(p)"
          >
            <Check class="h-3 w-3" />
            确认
          </button>
          <button
            class="flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-[11px] text-red-400 transition-colors hover:bg-red-500/20"
            @click="reject(p)"
          >
            <X class="h-3 w-3" />
            拒绝
          </button>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="rounded-xl border border-dashed border-border/25 bg-muted/5 px-3 py-4 text-center">
    <Brain class="mx-auto h-4 w-4 text-muted-foreground/30" />
    <p class="mt-1.5 text-[11px] text-muted-foreground/50">暂无待审核记忆</p>
  </div>
</template>
