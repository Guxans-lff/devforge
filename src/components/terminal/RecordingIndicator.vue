<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Circle, Square, History } from 'lucide-vue-next'
import * as recorderApi from '@/api/terminal-recorder'
import type { RecordingInfo } from '@/api/terminal-recorder'
import { createLogger } from '@/utils/logger'

const log = createLogger('recording.indicator')

const props = defineProps<{
  sessionId: string
  cols: number
  rows: number
}>()

const emit = defineEmits<{
  'recording-change': [recording: boolean]
}>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const recording = ref(false)
const elapsed = ref(0)
const filePath = ref('')
const recordings = ref<RecordingInfo[]>([])
let timer: ReturnType<typeof setInterval> | null = null

const elapsedText = computed(() => {
  const m = Math.floor(elapsed.value / 60)
  const s = elapsed.value % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

async function toggleRecording() {
  if (recording.value) {
    await stopRecording()
  } else {
    await startRecording()
  }
}

async function startRecording() {
  try {
    filePath.value = await recorderApi.startRecording(
      props.sessionId,
      props.cols,
      props.rows,
    )
    recording.value = true
    elapsed.value = 0
    timer = setInterval(() => { elapsed.value++ }, 1000)
    emit('recording-change', true)
  } catch (e) {
    log.warn('start_recording_failed', undefined, e)
  }
}

async function stopRecording() {
  const savedPath = filePath.value
  try {
    await recorderApi.stopRecording(props.sessionId)
  } catch (e) {
    log.warn('stop_recording_failed', undefined, e)
  }
  recording.value = false
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  emit('recording-change', false)
  if (savedPath) {
    openPlayer(savedPath)
  }
}

function openPlayer(path: string) {
  const fileName = path.split(/[/\\]/).pop() ?? 'Recording'
  workspace.addTab({
    id: `player-${Date.now()}`,
    type: 'terminal-player',
    title: fileName,
    closable: true,
    meta: { filePath: path },
  })
}

async function loadRecordings() {
  try {
    recordings.value = await recorderApi.listRecordings()
  } catch (e) {
    log.warn('load_recordings_failed', undefined, e)
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(ts: number): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString()
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <!-- 录制按钮 -->
  <Tooltip>
    <TooltipTrigger as-child>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7"
        :class="recording ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'"
        @click="toggleRecording"
      >
        <Circle v-if="!recording" class="h-3.5 w-3.5" />
        <Square v-else class="h-3 w-3 fill-current" />
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">
      <p>{{ recording ? t('recording.stop') : t('recording.start') }}</p>
    </TooltipContent>
  </Tooltip>
  <span v-if="recording" class="flex items-center gap-1 text-xs text-destructive">
    <span class="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
    {{ elapsedText }}
  </span>
  <!-- 历史录制 -->
  <DropdownMenu @update:open="(open: boolean) => { if (open) loadRecordings() }">
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 text-muted-foreground hover:text-foreground"
        :title="t('recording.history')"
      >
        <History class="h-3.5 w-3.5" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-72 max-h-80 overflow-y-auto">
      <DropdownMenuLabel>{{ t('recording.history') }}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <div v-if="recordings.length === 0" class="px-2 py-3 text-center text-xs text-muted-foreground">
        {{ t('recording.noRecordings') }}
      </div>
      <template v-else>
        <DropdownMenuItem
          v-for="rec in recordings"
          :key="rec.filePath"
          class="flex flex-col items-start gap-0.5 cursor-pointer"
          @click="openPlayer(rec.filePath)"
        >
          <span class="text-xs font-medium truncate w-full">{{ rec.fileName }}</span>
          <span class="text-[10px] text-muted-foreground">
            {{ formatDate(rec.createdAt) }} · {{ formatSize(rec.size) }}
          </span>
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
