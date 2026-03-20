<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import ConfirmDialog from '@/components/ui/confirm-dialog/ConfirmDialog.vue'
import CronInput from '@/components/database/CronInput.vue'
import {
  CalendarClock,
  Plus,
  Play,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  History,
} from 'lucide-vue-next'
import { useScheduler } from '@/composables/useScheduler'
import { useNotification } from '@/composables/useNotification'
import type { ScheduledTask } from '@/types/scheduler'

defineProps<{
  connectionId: string
  isConnected: boolean
}>()

const { t } = useI18n()
const notification = useNotification()
const {
  tasks,
  loading,
  loadError,
  loadTasks,
  createTask,
  updateTask,
  deleteTask,
  toggleTask,
  loadExecutions,
  runNow,
  getExecutions,
  loadingExecutions,
} = useScheduler()

// ===== 任务编辑对话框 =====
const editDialogOpen = ref(false)
const editingTask = ref<ScheduledTask | null>(null)
const editForm = ref({
  name: '',
  taskType: 'data_sync',
  cronExpr: '0 2 * * *',
  configJson: '',
  enabled: true,
})

/** 展开的任务（查看执行历史） */
const expandedTaskIds = ref<Set<string>>(new Set())

/** 删除确认 */
const deleteDialogOpen = ref(false)
const deletingTaskId = ref('')
const deletingTaskName = ref('')

/** 正在执行的任务 ID 集合 */
const runningTasks = ref<Set<string>>(new Set())

/** 是否为编辑模式 */
const isEditing = computed(() => editingTask.value !== null)

/** 格式化时间戳为本地时间字符串 */
function formatTime(ms: number | null): string {
  if (ms === null) return '-'
  return new Date(ms).toLocaleString()
}

/** 格式化时间距离 */
function formatRelativeTime(ms: number | null): string {
  if (ms === null) return '-'
  const now = Date.now()
  const diff = ms - now
  const absDiff = Math.abs(diff)

  if (absDiff < 60000) return diff > 0 ? t('scheduler.soonSuffix') : t('scheduler.justNow')
  if (absDiff < 3600000) {
    const minutes = Math.round(absDiff / 60000)
    return diff > 0
      ? t('scheduler.inMinutes', { n: minutes })
      : t('scheduler.minutesAgo', { n: minutes })
  }
  if (absDiff < 86400000) {
    const hours = Math.round(absDiff / 3600000)
    return diff > 0
      ? t('scheduler.inHours', { n: hours })
      : t('scheduler.hoursAgo', { n: hours })
  }
  const days = Math.round(absDiff / 86400000)
  return diff > 0
    ? t('scheduler.inDays', { n: days })
    : t('scheduler.daysAgo', { n: days })
}

/** 打开新建任务对话框 */
function handleCreate() {
  editingTask.value = null
  editForm.value = {
    name: '',
    taskType: 'data_sync',
    cronExpr: '0 2 * * *',
    configJson: '',
    enabled: true,
  }
  editDialogOpen.value = true
}

/** 打开编辑任务对话框 */
function handleEdit(task: ScheduledTask) {
  editingTask.value = task
  editForm.value = {
    name: task.name,
    taskType: task.taskType,
    cronExpr: task.cronExpr,
    configJson: task.configJson,
    enabled: task.enabled,
  }
  editDialogOpen.value = true
}

/** 保存任务 */
async function handleSave() {
  try {
    if (isEditing.value && editingTask.value) {
      await updateTask(editingTask.value.id, {
        name: editForm.value.name,
        cronExpr: editForm.value.cronExpr,
        configJson: editForm.value.configJson,
        enabled: editForm.value.enabled,
      })
      notification.success(t('scheduler.updateSuccess'))
    } else {
      await createTask(
        editForm.value.name,
        editForm.value.taskType,
        editForm.value.cronExpr,
        editForm.value.configJson,
        editForm.value.enabled,
      )
      notification.success(t('scheduler.createSuccess'))
    }
    editDialogOpen.value = false
  } catch (e: unknown) {
    notification.error(
      isEditing.value ? t('scheduler.updateFailed') : t('scheduler.createFailed'),
      e instanceof Error ? e.message : String(e),
      true,
    )
  }
}

/** 确认删除 */
function handleDeleteConfirm(task: ScheduledTask) {
  deletingTaskId.value = task.id
  deletingTaskName.value = task.name
  deleteDialogOpen.value = true
}

/** 执行删除 */
async function handleDelete() {
  try {
    await deleteTask(deletingTaskId.value)
    notification.success(t('scheduler.deleteSuccess'))
  } catch (e: unknown) {
    notification.error(t('scheduler.deleteFailed'), e instanceof Error ? e.message : String(e), true)
  }
}

/** 启用/禁用切换 */
async function handleToggle(task: ScheduledTask, enabled: boolean) {
  try {
    await toggleTask(task.id, enabled)
  } catch (e: unknown) {
    notification.error(t('scheduler.toggleFailed'), e instanceof Error ? e.message : String(e), true)
  }
}

/** 立即执行 */
async function handleRunNow(task: ScheduledTask) {
  const newRunning = new Set(runningTasks.value)
  newRunning.add(task.id)
  runningTasks.value = newRunning

  try {
    const result = await runNow(task.id)
    notification.success(t('scheduler.runSuccess'), result)
  } catch (e: unknown) {
    notification.error(t('scheduler.runFailed'), e instanceof Error ? e.message : String(e), true)
  } finally {
    const newSet = new Set(runningTasks.value)
    newSet.delete(task.id)
    runningTasks.value = newSet
  }
}

/** 展开/折叠执行历史 */
function toggleExpand(taskId: string) {
  const next = new Set(expandedTaskIds.value)
  if (next.has(taskId)) {
    next.delete(taskId)
  } else {
    next.add(taskId)
    // 首次展开时加载执行历史
    loadExecutions(taskId)
  }
  expandedTaskIds.value = next
}

/** 获取状态对应的图标和颜色 */
function getStatusDisplay(status: string) {
  switch (status) {
    case 'running':
      return { icon: Loader2, color: 'text-primary', animate: true }
    case 'success':
      return { icon: CheckCircle2, color: 'text-emerald-500', animate: false }
    case 'failed':
      return { icon: XCircle, color: 'text-destructive', animate: false }
    case 'cancelled':
      return { icon: AlertCircle, color: 'text-muted-foreground', animate: false }
    default:
      return { icon: Clock, color: 'text-muted-foreground', animate: false }
  }
}

/** 用于编辑 configJson 的文本输入处理 */
function handleConfigJsonInput(e: Event) {
  editForm.value = { ...editForm.value, configJson: (e.target as HTMLTextAreaElement).value }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 标题栏 -->
    <div class="flex items-center justify-between border-b border-border/30 px-4 py-2">
      <div class="flex items-center gap-2">
        <CalendarClock class="h-4 w-4 text-primary" />
        <span class="text-sm font-medium">{{ t('scheduler.title') }}</span>
        <Badge v-if="tasks.length > 0" variant="secondary" class="text-[10px] h-4 px-1.5">
          {{ tasks.length }}
        </Badge>
      </div>
      <div class="flex items-center gap-1">
        <Button size="sm" variant="outline" class="h-7 text-xs" @click="loadTasks">
          <Loader2 v-if="loading" class="h-3 w-3 animate-spin mr-1" />
          {{ t('scheduler.refresh') }}
        </Button>
        <Button size="sm" class="h-7 text-xs" @click="handleCreate">
          <Plus class="h-3 w-3 mr-1" />
          {{ t('scheduler.create') }}
        </Button>
      </div>
    </div>

    <!-- 加载错误 -->
    <div v-if="loadError" class="px-4 py-3">
      <div class="flex items-center gap-2 text-xs text-destructive">
        <AlertCircle class="h-4 w-4 shrink-0" />
        {{ loadError }}
      </div>
    </div>

    <!-- 任务列表 -->
    <ScrollArea class="flex-1">
      <div v-if="loading && tasks.length === 0" class="flex items-center justify-center py-12">
        <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
      </div>

      <div v-else-if="tasks.length === 0" class="flex flex-col items-center justify-center py-12 gap-3">
        <CalendarClock class="h-10 w-10 text-muted-foreground/30" />
        <p class="text-xs text-muted-foreground">{{ t('scheduler.noTasks') }}</p>
        <Button size="sm" variant="outline" class="text-xs" @click="handleCreate">
          <Plus class="h-3 w-3 mr-1" />
          {{ t('scheduler.createFirst') }}
        </Button>
      </div>

      <div v-else class="divide-y divide-border/20">
        <div
          v-for="task in tasks"
          :key="task.id"
          class="group"
        >
          <!-- 任务行 -->
          <div class="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30 transition-colors">
            <!-- 展开按钮 -->
            <button
              class="p-0.5 rounded hover:bg-accent transition-colors"
              @click="toggleExpand(task.id)"
            >
              <ChevronDown
                v-if="expandedTaskIds.has(task.id)"
                class="h-3.5 w-3.5 text-muted-foreground"
              />
              <ChevronRight
                v-else
                class="h-3.5 w-3.5 text-muted-foreground"
              />
            </button>

            <!-- 启用/禁用开关 -->
            <Switch
              :checked="task.enabled"
              @update:checked="(v: boolean) => handleToggle(task, v)"
            />

            <!-- 任务信息 -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium truncate">{{ task.name }}</span>
                <Badge variant="outline" class="text-[10px] h-4 px-1 font-mono shrink-0">
                  {{ task.cronExpr }}
                </Badge>
                <Badge
                  :variant="task.enabled ? 'default' : 'secondary'"
                  class="text-[10px] h-4 px-1 shrink-0"
                >
                  {{ task.enabled ? t('scheduler.enabled') : t('scheduler.disabled') }}
                </Badge>
              </div>
              <div class="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                <span v-if="task.lastRun">
                  {{ t('scheduler.lastRun') }}: {{ formatRelativeTime(task.lastRun) }}
                </span>
                <span v-if="task.nextRun && task.enabled">
                  {{ t('scheduler.nextRun') }}: {{ formatRelativeTime(task.nextRun) }}
                </span>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                size="sm"
                variant="ghost"
                class="h-6 w-6 p-0"
                :disabled="runningTasks.has(task.id)"
                :title="t('scheduler.runNow')"
                @click="handleRunNow(task)"
              >
                <Loader2 v-if="runningTasks.has(task.id)" class="h-3 w-3 animate-spin" />
                <Play v-else class="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                class="h-6 w-6 p-0"
                :title="t('scheduler.edit')"
                @click="handleEdit(task)"
              >
                <Pencil class="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                class="h-6 w-6 p-0 text-destructive hover:text-destructive"
                :title="t('scheduler.delete')"
                @click="handleDeleteConfirm(task)"
              >
                <Trash2 class="h-3 w-3" />
              </Button>
            </div>
          </div>

          <!-- 执行历史（展开区域） -->
          <div
            v-if="expandedTaskIds.has(task.id)"
            class="bg-muted/20 border-t border-border/10 px-4 py-2"
          >
            <div class="flex items-center gap-2 mb-2">
              <History class="h-3 w-3 text-muted-foreground" />
              <span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {{ t('scheduler.executionHistory') }}
              </span>
              <Button
                size="sm"
                variant="ghost"
                class="h-5 text-[10px] px-1.5 ml-auto"
                @click="loadExecutions(task.id)"
              >
                <Loader2 v-if="loadingExecutions.has(task.id)" class="h-3 w-3 animate-spin" />
                <template v-else>{{ t('scheduler.refresh') }}</template>
              </Button>
            </div>

            <div v-if="loadingExecutions.has(task.id) && getExecutions(task.id).length === 0" class="py-3 text-center">
              <Loader2 class="h-4 w-4 animate-spin text-muted-foreground mx-auto" />
            </div>

            <div v-else-if="getExecutions(task.id).length === 0" class="py-3 text-center text-[10px] text-muted-foreground">
              {{ t('scheduler.noExecutions') }}
            </div>

            <div v-else class="space-y-1 max-h-48 overflow-y-auto">
              <div
                v-for="exec in getExecutions(task.id)"
                :key="exec.id"
                class="flex items-center gap-2 rounded px-2 py-1 text-[10px] hover:bg-accent/20"
              >
                <component
                  :is="getStatusDisplay(exec.status).icon"
                  class="h-3 w-3 shrink-0"
                  :class="[
                    getStatusDisplay(exec.status).color,
                    getStatusDisplay(exec.status).animate ? 'animate-spin' : '',
                  ]"
                />
                <span class="text-muted-foreground tabular-nums shrink-0">
                  {{ formatTime(exec.startedAt) }}
                </span>
                <span v-if="exec.finishedAt" class="text-muted-foreground/50 tabular-nums shrink-0">
                  ({{ Math.round((exec.finishedAt - exec.startedAt) / 1000) }}s)
                </span>
                <span class="flex-1 truncate" :class="exec.error ? 'text-destructive' : 'text-muted-foreground'">
                  {{ exec.error || exec.resultSummary || exec.status }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>

    <!-- 新建/编辑任务对话框 -->
    <Dialog v-model:open="editDialogOpen">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle class="text-sm">
            {{ isEditing ? t('scheduler.editTask') : t('scheduler.createTask') }}
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            {{ t('scheduler.taskFormDesc') }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4 py-2">
          <!-- 任务名称 -->
          <div class="space-y-1.5">
            <label class="text-xs font-medium">{{ t('scheduler.taskName') }}</label>
            <input
              :value="editForm.name"
              type="text"
              class="w-full h-8 rounded-md border border-input bg-background px-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              :placeholder="t('scheduler.taskNamePlaceholder')"
              @input="editForm = { ...editForm, name: ($event.target as HTMLInputElement).value }"
            />
          </div>

          <!-- Cron 表达式 -->
          <div class="space-y-1.5">
            <label class="text-xs font-medium">{{ t('scheduler.cronExpr') }}</label>
            <CronInput v-model="editForm.cronExpr" />
          </div>

          <!-- 任务配置 JSON -->
          <div class="space-y-1.5">
            <label class="text-xs font-medium">{{ t('scheduler.configJson') }}</label>
            <textarea
              :value="editForm.configJson"
              class="w-full h-32 rounded-md border border-input bg-background px-3 py-2 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              :placeholder="t('scheduler.configJsonPlaceholder')"
              @input="handleConfigJsonInput"
            />
          </div>

          <!-- 启用开关 -->
          <div class="flex items-center justify-between">
            <label class="text-xs font-medium">{{ t('scheduler.enableTask') }}</label>
            <Switch
              :checked="editForm.enabled"
              @update:checked="(v: boolean) => editForm = { ...editForm, enabled: v }"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" @click="editDialogOpen = false">
            {{ t('common.cancel') }}
          </Button>
          <Button size="sm" :disabled="!editForm.name || !editForm.cronExpr" @click="handleSave">
            {{ isEditing ? t('common.save') : t('scheduler.create') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 删除确认对话框 -->
    <ConfirmDialog
      v-model:open="deleteDialogOpen"
      :title="t('scheduler.deleteConfirmTitle', { name: deletingTaskName })"
      :description="t('scheduler.deleteConfirmDesc')"
      variant="destructive"
      :confirm-label="t('scheduler.confirmDelete')"
      @confirm="handleDelete"
    />
  </div>
</template>
