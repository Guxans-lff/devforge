<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { Upload, Loader2, Check, X, FileUp } from 'lucide-vue-next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import Progress from '@/components/ui/progress.vue'
import { useToast } from '@/composables/useToast'
import { dbRestoreDatabase } from '@/api/db-backup'
import { computed } from 'vue'

interface RestoreProgress {
  statementsExecuted: number
  totalStatements: number
  status: string
  error: string | null
}

const props = defineProps<{
  connectionId: string
  database: string
}>()

const emit = defineEmits<{
  success: []
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const toast = useToast()

// 文件选择
const filePath = ref('')

// 进度
const restoring = ref(false)
const restoreDone = ref(false)
const restoreSuccess = ref(false)
const restoreError = ref<string | null>(null)
const statementsExecuted = ref(0)
const totalStatements = ref(0)

const progressPercent = computed(() => {
  if (totalStatements.value === 0) return 0
  return Math.round((statementsExecuted.value / totalStatements.value) * 100)
})

async function selectFile() {
  const selected = await openDialog({
    multiple: false,
    filters: [
      { name: 'SQL Files', extensions: ['sql'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (selected) {
    filePath.value = selected as string
  }
}

let progressUnlisten: (() => void) | null = null

async function startRestore() {
  if (!filePath.value) {
    toast.warning(t('restore.noFileSelected'))
    return
  }

  restoring.value = true
  restoreDone.value = false
  restoreSuccess.value = false
  restoreError.value = null
  statementsExecuted.value = 0
  totalStatements.value = 0

  progressUnlisten = await listen<RestoreProgress>('restore://progress', (event) => {
    const p = event.payload
    statementsExecuted.value = p.statementsExecuted
    totalStatements.value = p.totalStatements
    if (p.status === 'completed') {
      restoreDone.value = true
      restoreSuccess.value = true
    }
    if (p.error) {
      restoreError.value = p.error
    }
  })

  try {
    await dbRestoreDatabase(props.connectionId, props.database, filePath.value)
    restoreDone.value = true
    restoreSuccess.value = true
    toast.success(t('restore.success'))
    emit('success')
  } catch (e: any) {
    restoreDone.value = true
    restoreSuccess.value = false
    restoreError.value = e?.message ?? String(e)
    toast.error(t('restore.failed'), restoreError.value ?? '')
  } finally {
    restoring.value = false
    progressUnlisten?.()
    progressUnlisten = null
  }
}

function reset() {
  filePath.value = ''
  restoring.value = false
  restoreDone.value = false
  restoreSuccess.value = false
  restoreError.value = null
  statementsExecuted.value = 0
  totalStatements.value = 0
}

watch(open, (val) => {
  if (!val) {
    progressUnlisten?.()
    progressUnlisten = null
    reset()
  }
})

onBeforeUnmount(() => {
  progressUnlisten?.()
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex flex-col gap-0 p-0 max-w-md">
      <DialogHeader class="px-6 pt-5 pb-4 shrink-0">
        <DialogTitle class="flex items-center gap-2 text-base">
          <Upload class="size-4" />
          {{ t('restore.title') }}
        </DialogTitle>
        <DialogDescription class="text-xs">
          {{ props.database }}
        </DialogDescription>
      </DialogHeader>

      <Separator class="shrink-0" />

      <div class="px-6 py-4 space-y-4">

        <!-- 文件选择 -->
        <div class="space-y-2">
          <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {{ t('restore.selectFile') }}
          </span>
          <div class="flex gap-2">
            <Input
              :model-value="filePath"
              readonly
              :placeholder="t('restore.filePlaceholder')"
              class="flex-1 text-xs h-8"
            />
            <Button variant="outline" size="sm" class="shrink-0" :disabled="restoring" @click="selectFile">
              <FileUp class="size-3.5" />
              {{ t('restore.browse') }}
            </Button>
          </div>
        </div>

        <!-- 警告 -->
        <div class="rounded-md bg-df-warning/10 px-3 py-2 text-xs text-df-warning">
          {{ t('restore.warning') }}
        </div>

        <!-- 进度 -->
        <template v-if="restoring || restoreDone">
          <Separator />
          <div class="space-y-2">
            <div class="flex items-center justify-between text-xs text-muted-foreground">
              <span v-if="restoring">{{ t('restore.restoring') }}</span>
              <span v-else>{{ t('restore.done') }}</span>
              <span v-if="totalStatements > 0">
                {{ statementsExecuted }} / {{ totalStatements }}
              </span>
            </div>
            <Progress :model-value="progressPercent" />

            <!-- 结果 -->
            <div
              v-if="restoreDone"
              class="flex items-center gap-2 rounded-md px-3 py-2 text-xs"
              :class="restoreSuccess ? 'bg-df-success/10 text-df-success' : 'bg-destructive/10 text-destructive'"
            >
              <Check v-if="restoreSuccess" class="size-3.5 shrink-0" />
              <X v-else class="size-3.5 shrink-0" />
              <span v-if="restoreSuccess">
                {{ t('restore.success') }} — {{ statementsExecuted }} {{ t('restore.statementsExecuted') }}
              </span>
              <span v-else>{{ restoreError ?? t('restore.failed') }}</span>
            </div>
          </div>
        </template>

      </div>

      <Separator class="shrink-0" />

      <DialogFooter class="px-6 py-3 shrink-0">
        <Button variant="outline" size="sm" :disabled="restoring" @click="open = false">
          {{ restoreDone ? t('common.close') : t('common.cancel') }}
        </Button>
        <Button
          size="sm"
          :disabled="!filePath || restoring || restoreDone"
          @click="startRestore"
        >
          <Loader2 v-if="restoring" class="size-3.5 animate-spin" />
          <Upload v-else class="size-3.5" />
          {{ restoring ? t('restore.restoring') : t('restore.startRestore') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
