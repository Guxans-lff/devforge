<script setup lang="ts">
import { computed, ref } from 'vue'
import { FilePenLine, RotateCcw, Check, AlertCircle } from 'lucide-vue-next'
import type { FileOperation } from '@/types/ai'
import { aiRevertWriteFile } from '@/api/ai'
import { summarizeFileChanges } from '@/ai-gui/fileChangeSummary'

const props = defineProps<{
  operations: FileOperation[]
  sessionId?: string
}>()

const emit = defineEmits<{
  (e: 'update:operations', operations: FileOperation[]): void
}>()

const expanded = ref(false)
const busyIds = ref<Set<string>>(new Set())
const summary = computed(() => summarizeFileChanges(props.operations))
const visibleOperations = computed(() => expanded.value ? props.operations : props.operations.slice(0, 3))

function updateOperation(toolCallId: string, patch: Partial<FileOperation>): void {
  emit('update:operations', props.operations.map(operation =>
    operation.toolCallId === toolCallId ? { ...operation, ...patch } : operation,
  ))
}

async function revertOperation(operation: FileOperation): Promise<void> {
  if (!props.sessionId) {
    updateOperation(operation.toolCallId, { status: 'error', errorMessage: '缺少 sessionId，无法撤销。' })
    return
  }

  busyIds.value = new Set(busyIds.value).add(operation.toolCallId)
  try {
    await aiRevertWriteFile(props.sessionId, operation.toolCallId, operation.path)
    updateOperation(operation.toolCallId, { status: 'rejected', errorMessage: undefined })
  } catch (error) {
    updateOperation(operation.toolCallId, {
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  } finally {
    const next = new Set(busyIds.value)
    next.delete(operation.toolCallId)
    busyIds.value = next
  }
}

async function revertAll(): Promise<void> {
  for (const operation of props.operations) {
    if (operation.status === 'pending') {
      await revertOperation(operation)
    }
  }
}
</script>

<template>
  <section v-if="summary.total > 0" class="mx-auto max-w-4xl px-5">
    <div class="rounded-xl border border-border/40 bg-card/35 p-3">
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <FilePenLine class="h-4 w-4 shrink-0 text-primary/75" />
          <div class="min-w-0">
            <div class="text-xs font-semibold text-foreground/85">AI 文件变更</div>
            <div class="text-[11px] text-muted-foreground">
              共 {{ summary.total }} 个文件操作，待处理 {{ summary.pending }}，已撤销 {{ summary.rejected }}，异常 {{ summary.errored }}。
            </div>
          </div>
        </div>
        <button
          class="rounded-md border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          @click="expanded = !expanded"
        >
          {{ expanded ? '收起' : '查看全部' }}
        </button>
        <button
          class="inline-flex items-center gap-1 rounded-md border border-destructive/25 px-2.5 py-1 text-[11px] text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="summary.pending === 0"
          @click="revertAll"
        >
          <RotateCcw class="h-3 w-3" /> 撤销全部待处理
        </button>
      </div>

      <div v-if="expanded" class="mt-3 space-y-1.5">
        <div
          v-for="operation in visibleOperations"
          :key="operation.toolCallId"
          class="flex items-center gap-2 rounded-lg border border-border/25 bg-background/35 px-2.5 py-2 text-xs"
        >
          <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{{ operation.op }}</span>
          <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/75" :title="operation.path">{{ operation.path }}</span>
          <span v-if="operation.status === 'rejected'" class="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Check class="h-3 w-3" /> 已撤销
          </span>
          <span v-else-if="operation.status === 'error'" class="inline-flex items-center gap-1 text-[11px] text-destructive" :title="operation.errorMessage">
            <AlertCircle class="h-3 w-3" /> 异常
          </span>
          <button
            v-else
            class="rounded px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/10 disabled:cursor-wait disabled:opacity-50"
            :disabled="busyIds.has(operation.toolCallId)"
            @click="revertOperation(operation)"
          >
            {{ busyIds.has(operation.toolCallId) ? '撤销中...' : '撤销' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
