<script setup lang="ts">
/**
 * 交互式 Rebase 面板
 * 拖拽排列 commit、选择操作（pick/squash/fixup/reword/drop）后执行
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  gitInteractiveRebasePlan,
  gitInteractiveRebaseExecute,
  gitInteractiveRebaseAbort,
} from '@/api/git'
import type { RebaseEntry, RebaseAction } from '@/types/git'
import {
  Loader2, GripVertical, X, Play, Ban,
  Check, Combine, Trash2, MessageSquare, ArrowDownUp,
} from 'lucide-vue-next'

const props = defineProps<{
  repoPath: string
  baseCommit: string
}>()

const emit = defineEmits<{
  close: []
  done: []
}>()

const { t } = useI18n()
const toast = useToast()

const loading = ref(false)
const executing = ref(false)
const plan = ref<RebaseEntry[]>([])

// ── 操作选项 ──────────────────────────────────────────────────────
const actionOptions: { value: string; labelKey: string; icon: typeof Check }[] = [
  { value: 'pick', labelKey: 'git.rebasePick', icon: Check },
  { value: 'squash', labelKey: 'git.rebaseSquash', icon: Combine },
  { value: 'fixup', labelKey: 'git.rebaseFixup', icon: Combine },
  { value: 'reword', labelKey: 'git.rebaseReword', icon: MessageSquare },
  { value: 'drop', labelKey: 'git.rebaseDrop', icon: Trash2 },
]

// ── 加载 Rebase 计划 ─────────────────────────────────────────────
onMounted(async () => {
  loading.value = true
  try {
    plan.value = await gitInteractiveRebasePlan(props.repoPath, props.baseCommit)
    if (plan.value.length === 0) {
      toast.warning(t('git.rebasePlanEmpty'))
    }
  } catch (e) {
    toast.error(t('git.rebaseLoadFailed'), String(e))
  } finally {
    loading.value = false
  }
})

// ── 操作变更 ─────────────────────────────────────────────────────
/** 获取 action 的字符串 key */
function actionKey(action: RebaseAction): string {
  if (typeof action === 'object' && action !== null && 'reword' in action) return 'reword'
  return action as string
}

/** 设置某个 entry 的 action */
function setAction(index: number, value: string) {
  const entry = plan.value[index]
  if (!entry) return
  if (value === 'reword') {
    entry.action = { reword: entry.message }
  } else {
    entry.action = value as RebaseAction
  }
}

/** reword 消息编辑 */
function getRewordMessage(action: RebaseAction): string {
  if (typeof action === 'object' && 'reword' in action) return action.reword
  return ''
}

function setRewordMessage(index: number, msg: string) {
  const entry = plan.value[index]
  if (entry) entry.action = { reword: msg }
}

// ── 拖拽排序（原生 HTML5 DnD） ─────────────────────────────────
const dragIdx = ref<number | null>(null)
const dropIdx = ref<number | null>(null)

function onDragStart(e: DragEvent, idx: number) {
  dragIdx.value = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }
}

function onDragOver(e: DragEvent, idx: number) {
  e.preventDefault()
  dropIdx.value = idx
}

function onDragLeave() {
  dropIdx.value = null
}

function onDrop(e: DragEvent, toIdx: number) {
  e.preventDefault()
  const fromIdx = dragIdx.value
  if (fromIdx !== null && fromIdx !== toIdx) {
    const items = [...plan.value]
    const [moved] = items.splice(fromIdx, 1)
    if (moved) items.splice(toIdx, 0, moved)
    plan.value = items
  }
  dragIdx.value = null
  dropIdx.value = null
}

function onDragEnd() {
  dragIdx.value = null
  dropIdx.value = null
}

// ── 执行 Rebase ─────────────────────────────────────────────────
async function executeRebase() {
  executing.value = true
  try {
    const result = await gitInteractiveRebaseExecute(props.repoPath, props.baseCommit, plan.value)
    if (result.success) {
      toast.success(t('git.rebaseInteractiveSuccess', {
        completed: result.completedSteps,
        total: result.totalSteps,
      }))
      emit('done')
    } else {
      toast.error(t('git.rebaseConflicts', {
        files: result.conflicts.join(', '),
      }))
    }
  } catch (e) {
    toast.error(t('git.rebaseExecFailed'), String(e))
  } finally {
    executing.value = false
  }
}

// ── 中止 Rebase ─────────────────────────────────────────────────
async function abortRebase() {
  try {
    await gitInteractiveRebaseAbort(props.repoPath)
    toast.success(t('git.rebaseAborted'))
    emit('close')
  } catch (e) {
    toast.error(t('git.rebaseAbortFailed'), String(e))
  }
}

/** 格式化时间 */
function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleString()
}

const canExecute = computed(() => plan.value.length > 0 && !executing.value)

/** action 的颜色 */
function actionColor(action: RebaseAction): string {
  const key = actionKey(action)
  switch (key) {
    case 'pick': return 'text-green-500'
    case 'squash': return 'text-blue-500'
    case 'fixup': return 'text-cyan-500'
    case 'reword': return 'text-yellow-500'
    case 'drop': return 'text-red-500 line-through'
    default: return ''
  }
}
</script>

<template>
  <div class="flex flex-col h-full bg-background">
    <!-- 头部 -->
    <div class="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/20">
      <div class="flex items-center gap-2">
        <ArrowDownUp class="h-4 w-4 text-primary" />
        <span class="text-sm font-semibold">{{ t('git.interactiveRebase') }}</span>
      </div>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="emit('close')">
        <X class="h-4 w-4" />
      </Button>
    </div>

    <!-- 提示 -->
    <div class="px-4 py-1.5 text-xs text-muted-foreground border-b border-border/50">
      {{ t('git.rebaseDragHint') }}
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
    </div>

    <!-- 计划列表 -->
    <ScrollArea v-else class="flex-1 min-h-0">
      <div class="p-2 space-y-0.5">
        <div
          v-for="(entry, idx) in plan"
          :key="entry.hash"
          draggable="true"
          class="flex items-start gap-2 px-2 py-2 rounded border transition-colors"
          :class="[
            dragIdx === idx ? 'opacity-40 border-dashed border-primary' : 'border-transparent',
            dropIdx === idx && dragIdx !== idx ? 'border-primary bg-primary/5' : 'hover:bg-accent/30',
            actionKey(entry.action) === 'drop' ? 'opacity-50' : '',
          ]"
          @dragstart="onDragStart($event, idx)"
          @dragover="onDragOver($event, idx)"
          @dragleave="onDragLeave"
          @drop="onDrop($event, idx)"
          @dragend="onDragEnd"
        >
          <!-- 拖拽手柄 -->
          <div class="cursor-grab pt-0.5 text-muted-foreground hover:text-foreground">
            <GripVertical class="h-4 w-4" />
          </div>

          <!-- 操作选择 -->
          <select
            :value="actionKey(entry.action)"
            class="shrink-0 h-7 w-24 rounded border border-border bg-background px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            :class="actionColor(entry.action)"
            @change="setAction(idx, ($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="opt in actionOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ t(opt.labelKey) }}
            </option>
          </select>

          <!-- Commit 信息 -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="font-mono text-primary text-xs shrink-0">{{ entry.shortHash }}</span>
              <span class="truncate text-xs font-medium" :class="{ 'line-through text-muted-foreground': actionKey(entry.action) === 'drop' }">
                {{ entry.message }}
              </span>
            </div>
            <div class="text-[10px] text-muted-foreground mt-0.5">
              {{ entry.author }} · {{ formatTime(entry.timestamp) }}
            </div>
            <!-- Reword 输入框 -->
            <input
              v-if="actionKey(entry.action) === 'reword'"
              :value="getRewordMessage(entry.action)"
              :placeholder="t('git.rebaseNewMessage')"
              class="mt-1 w-full h-7 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              @input="setRewordMessage(idx, ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
      </div>
    </ScrollArea>

    <!-- 底部操作栏 -->
    <div class="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/20">
      <Button variant="outline" size="sm" class="h-7 text-xs" @click="emit('close')">
        {{ t('git.rebaseCancel') }}
      </Button>
      <div class="flex items-center gap-2">
        <Button
          variant="destructive" size="sm" class="h-7 text-xs"
          :disabled="executing"
          @click="abortRebase"
        >
          <Ban class="h-3.5 w-3.5 mr-1" />
          {{ t('git.rebaseAbort') }}
        </Button>
        <Button
          size="sm" class="h-7 text-xs"
          :disabled="!canExecute"
          @click="executeRebase"
        >
          <Loader2 v-if="executing" class="h-3.5 w-3.5 animate-spin mr-1" />
          <Play v-else class="h-3.5 w-3.5 mr-1" />
          {{ t('git.rebaseExecute') }}
        </Button>
      </div>
    </div>
  </div>
</template>
