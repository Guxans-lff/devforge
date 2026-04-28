<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { CheckCircle2, Circle, ClipboardList, Loader2, Pause, Play, RotateCcw, Square, XCircle } from 'lucide-vue-next'
import { loadBuiltinWorkflows } from '@/composables/useWorkflowScripts'
import {
  attachWorkflowStepVerification,
  cancelWorkflowRuntime,
  completeWorkflowStep,
  createWorkflowRuntime,
  failWorkflowStep,
  markWorkflowStepRunning,
  nextWorkflowAction,
  pauseWorkflowRuntime,
  resetWorkflowStep,
  resumeWorkflowRuntime,
  startWorkflowRuntime,
  type WorkflowRuntimeState,
} from '@/ai-gui/workflowRuntime'
import { loadWorkflowRuntime, saveWorkflowRuntime } from '@/ai-gui/workflowPersistence'
import { latestVerificationJob, parseVerificationReport } from '@/ai-gui/verificationReport'
import type { BackgroundJob } from '@/stores/background-job'

const props = defineProps<{
  jobs?: BackgroundJob[]
}>()

const emit = defineEmits<{
  (e: 'insert-prompt', prompt: string): void
  (e: 'verify', commands: string[]): void
}>()

const workflows = loadBuiltinWorkflows()
const selectedWorkflowId = ref(workflows[0]?.id ?? '')
const runtime = ref<WorkflowRuntimeState | null>(null)

const selectedWorkflow = computed(() => workflows.find(workflow => workflow.id === selectedWorkflowId.value) ?? workflows[0])
const action = computed(() => runtime.value ? nextWorkflowAction(runtime.value) : null)
const latestJob = computed(() => latestVerificationJob(props.jobs ?? []))
const verificationReport = computed(() => parseVerificationReport(latestJob.value?.result ?? latestJob.value?.error))

function statusIcon(status: string) {
  if (status === 'done') return CheckCircle2
  if (status === 'running') return Loader2
  if (status === 'failed') return XCircle
  return Circle
}

function statusClass(status: string): string {
  if (status === 'done') return 'text-emerald-400'
  if (status === 'running') return 'text-amber-400'
  if (status === 'failed') return 'text-red-400'
  return 'text-muted-foreground/45'
}

function createRun(): void {
  if (!selectedWorkflow.value) return
  runtime.value = startWorkflowRuntime(createWorkflowRuntime(selectedWorkflow.value))
}

function pauseRun(): void {
  if (!runtime.value) return
  runtime.value = pauseWorkflowRuntime(runtime.value)
}

function resumeRun(): void {
  if (!runtime.value) return
  runtime.value = resumeWorkflowRuntime(runtime.value)
}

function cancelRun(): void {
  if (!runtime.value) return
  runtime.value = cancelWorkflowRuntime(runtime.value)
}

function executeCurrentStep(): void {
  if (!runtime.value || !action.value) return
  const current = action.value
  runtime.value = markWorkflowStepRunning(runtime.value, current.step.id)
  if (current.type === 'prompt' || current.type === 'summary') {
    if (current.payload) emit('insert-prompt', current.payload)
    runtime.value = completeWorkflowStep(runtime.value, current.step.id, 'prompt inserted')
    return
  }
  if (current.type === 'verify') {
    if (current.payload) {
      emit('verify', [current.payload])
      runtime.value = attachWorkflowStepVerification(runtime.value, current.step.id, 'pending-verification')
    } else {
      runtime.value = failWorkflowStep(runtime.value, current.step.id, 'test step has no command')
    }
    return
  }
  runtime.value = completeWorkflowStep(runtime.value, current.step.id, 'skipped')
}

function resetStep(stepId: string): void {
  if (!runtime.value) return
  runtime.value = resetWorkflowStep(runtime.value, stepId)
}

function syncVerificationResult(job: BackgroundJob | null): void {
  if (!runtime.value || !job || job.kind !== 'verification') return
  const step = runtime.value.steps.find(item => item.status === 'running' && item.type === 'test')
  if (!step) return
  if (step.verificationJobId === 'pending-verification') {
    runtime.value = attachWorkflowStepVerification(runtime.value, step.id, job.id)
  }
  if (job.status === 'succeeded') {
    runtime.value = completeWorkflowStep(runtime.value, step.id, verificationReport.value?.summary ?? 'verification passed')
  }
  if (job.status === 'failed') {
    runtime.value = failWorkflowStep(runtime.value, step.id, verificationReport.value?.summary ?? job.error ?? 'verification failed')
  }
}

onMounted(() => {
  const saved = loadWorkflowRuntime()
  if (saved) runtime.value = saved
})

watch(runtime, value => saveWorkflowRuntime(value), { deep: true })
watch(latestJob, job => syncVerificationResult(job), { immediate: true })
</script>

<template>
  <section class="mx-auto max-w-4xl px-5">
    <div class="rounded-xl border border-border/40 bg-card/35 p-3">
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <ClipboardList class="h-4 w-4 shrink-0 text-primary/75" />
          <div class="min-w-0">
            <div class="text-xs font-semibold text-foreground/85">Workflow Runtime</div>
            <div class="text-[11px] text-muted-foreground">步骤化执行内置工作流，可插入 prompt 或挂接验证任务。</div>
          </div>
        </div>
        <select v-model="selectedWorkflowId" class="rounded-md border border-border/40 bg-background px-2 py-1 text-[11px] text-muted-foreground">
          <option v-for="workflow in workflows" :key="workflow.id" :value="workflow.id">{{ workflow.name }}</option>
        </select>
        <button class="inline-flex items-center gap-1 rounded-md border border-primary/25 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/10" @click="createRun">
          <Play class="h-3 w-3" /> 新建运行
        </button>
        <button class="inline-flex items-center gap-1 rounded-md border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-50" :disabled="runtime?.status !== 'running'" @click="pauseRun">
          <Pause class="h-3 w-3" /> 暂停
        </button>
        <button class="inline-flex items-center gap-1 rounded-md border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-50" :disabled="runtime?.status !== 'paused' && runtime?.status !== 'failed'" @click="resumeRun">
          <Play class="h-3 w-3" /> 恢复
        </button>
        <button class="inline-flex items-center gap-1 rounded-md border border-red-500/25 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-50" :disabled="!runtime || runtime.status === 'done' || runtime.status === 'cancelled'" @click="cancelRun">
          <Square class="h-3 w-3" /> 取消
        </button>
        <button class="inline-flex items-center gap-1 rounded-md border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-50" :disabled="!action" @click="executeCurrentStep">
          <Play class="h-3 w-3" /> 执行当前步
        </button>
      </div>

      <div v-if="runtime" class="mt-3 space-y-1.5">
        <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span class="rounded bg-muted px-2 py-0.5">{{ runtime.status }}</span>
          <span class="truncate">{{ runtime.workflowName }}</span>
        </div>
        <div v-if="runtime.interruptedReason" class="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          {{ runtime.interruptedReason }} 可点击“恢复”继续，或重置失败步骤后再执行。
        </div>
        <div v-for="step in runtime.steps" :key="step.id" class="flex items-center gap-2 rounded-lg border border-border/20 bg-background/35 px-2.5 py-2 text-xs">
          <component :is="statusIcon(step.status)" class="h-3.5 w-3.5" :class="[statusClass(step.status), step.status === 'running' && 'animate-spin']" />
          <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{{ step.type }}</span>
          <span class="min-w-0 flex-1 truncate text-muted-foreground" :title="step.prompt || step.command">{{ step.prompt || step.command || '无动作' }}</span>
          <span v-if="step.verificationJobId" class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{{ step.verificationJobId }}</span>
          <button class="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/40" @click="resetStep(step.id)">
            <RotateCcw class="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
