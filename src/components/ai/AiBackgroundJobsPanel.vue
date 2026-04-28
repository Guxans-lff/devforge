<script setup lang="ts">
import { computed } from 'vue'
import type { BackgroundJob, BackgroundJobStatus } from '@/stores/background-job'
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  Ban,
  Trash2,
} from 'lucide-vue-next'

const props = defineProps<{
  jobs: BackgroundJob[]
}>()

const emit = defineEmits<{
  (e: 'clear-completed'): void
  (e: 'cancel', jobId: string): void
}>()

const activeJobs = computed(() =>
  props.jobs.filter(j => j.status === 'running' || j.status === 'queued' || j.status === 'cancelling'),
)

const completedJobs = computed(() =>
  props.jobs.filter(j => j.status === 'succeeded' || j.status === 'failed' || j.status === 'cancelled'),
)

function statusIcon(status: BackgroundJobStatus) {
  switch (status) {
    case 'running': return Loader2
    case 'queued': return Clock
    case 'cancelling': return Ban
    case 'succeeded': return CheckCircle2
    case 'failed': return XCircle
    case 'cancelled': return Ban
    default: return Clock
  }
}

function statusClass(status: BackgroundJobStatus): string {
  switch (status) {
    case 'running': return 'text-amber-400'
    case 'queued': return 'text-sky-400'
    case 'cancelling': return 'text-orange-400'
    case 'succeeded': return 'text-emerald-400'
    case 'failed': return 'text-red-400'
    case 'cancelled': return 'text-gray-400'
    default: return 'text-gray-400'
  }
}

function statusLabel(status: BackgroundJobStatus): string {
  switch (status) {
    case 'running': return '运行中'
    case 'queued': return '排队中'
    case 'cancelling': return '取消中'
    case 'succeeded': return '已完成'
    case 'failed': return '失败'
    case 'cancelled': return '已取消'
    default: return status
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'ai_compact': return 'AI 压缩'
    case 'ai_compact_auto': return 'AI 自动压缩'
    case 'schema_compare': return 'Schema 对比'
    case 'schema_compare_sql': return 'Schema 迁移 SQL'
    case 'erp_module_load': return 'ERP 模块加载'
    case 'resource_scan': return '资源扫描'
    case 'verification': return '验证任务'
    default: return kind
  }
}

function jobTitle(job: BackgroundJob): string {
  return job.title || kindLabel(job.kind)
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="activeJobs.length > 0" class="space-y-2">
      <p class="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground/50">
        活跃任务
      </p>
      <div
        v-for="job in activeJobs"
        :key="job.id"
        class="rounded-xl border border-border/25 bg-muted/10 px-3 py-2"
      >
        <div class="flex items-center gap-2">
          <component
            :is="statusIcon(job.status)"
            class="h-3.5 w-3.5 shrink-0"
            :class="[statusClass(job.status), job.status === 'running' && 'animate-spin']"
          />
          <span class="text-xs font-medium text-foreground/85">{{ jobTitle(job) }}</span>
          <span class="ml-auto text-[10px] uppercase tracking-wider" :class="statusClass(job.status)">
            {{ statusLabel(job.status) }}
          </span>
          <button
            class="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
            @click="emit('cancel', job.id)"
          >
            取消
          </button>
        </div>
        <div v-if="job.progress !== undefined && job.progress !== null" class="mt-1.5">
          <div class="h-1 w-full overflow-hidden rounded-full bg-muted/40">
            <div
              class="h-full rounded-full bg-primary/60 transition-all duration-300"
              :style="{ width: `${Math.min(job.progress, 100)}%` }"
            />
          </div>
        </div>
        <div class="mt-1 text-[10px] text-muted-foreground/50">
          <span>{{ formatTime(job.createdAt) }}</span>
          <span v-if="job.contextSummary" class="ml-1">· {{ job.contextSummary }}</span>
        </div>
      </div>
    </div>

    <div v-if="completedJobs.length > 0" class="space-y-2">
      <div class="flex items-center justify-between">
        <p class="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground/50">
          已完成
        </p>
        <button
          class="flex items-center gap-1 text-[10px] text-muted-foreground/50 transition-colors hover:text-red-400"
          @click="emit('clear-completed')"
        >
          <Trash2 class="h-3 w-3" />
          清空
        </button>
      </div>
      <div
        v-for="job in completedJobs.slice(0, 10)"
        :key="job.id"
        class="flex items-center gap-2 rounded-lg border border-border/15 bg-muted/5 px-2.5 py-1.5"
      >
        <component
          :is="statusIcon(job.status)"
          class="h-3 w-3 shrink-0"
          :class="statusClass(job.status)"
        />
        <span class="text-[11px] text-foreground/70">{{ jobTitle(job) }}</span>
        <span class="ml-auto text-[10px]" :class="statusClass(job.status)">
          {{ statusLabel(job.status) }}
        </span>
      </div>
      <p v-if="completedJobs.length > 10" class="text-center text-[10px] text-muted-foreground/40">
        还有 {{ completedJobs.length - 10 }} 个已完成任务
      </p>
    </div>

    <div
      v-if="jobs.length === 0"
      class="rounded-xl border border-dashed border-border/25 bg-muted/5 px-3 py-4 text-center"
    >
      <RotateCcw class="mx-auto h-4 w-4 text-muted-foreground/30" />
      <p class="mt-1.5 text-[11px] text-muted-foreground/50">暂无后台任务</p>
    </div>
  </div>
</template>
