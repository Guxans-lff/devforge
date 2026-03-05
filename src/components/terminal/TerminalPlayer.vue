<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from '@/composables/useTheme'
import { useSettingsStore } from '@/stores/settings'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Play, Pause, RotateCcw, FastForward, FileVideo, Loader2, Download } from 'lucide-vue-next'
import * as recorderApi from '@/api/terminal-recorder'
import { save } from '@tauri-apps/plugin-dialog'

const props = defineProps<{
  filePath: string
}>()

const { t } = useI18n()
const { activeTheme } = useTheme()
const settingsStore = useSettingsStore()

const terminalRef = ref<HTMLDivElement>()
const containerRef = ref<HTMLDivElement>()
const playing = ref(false)
const loading = ref(true)
const totalDuration = ref(0)
const speed = ref(1)
const currentTime = ref(0)
const eventCount = ref(0)
const recordingDate = ref('')
const terminalSize = ref({ width: 0, height: 0 })

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let events: { time: number; type: string; data: string }[] = []
let eventIndex = 0
let playTimer: ReturnType<typeof setTimeout> | null = null
let resizeObserver: ResizeObserver | null = null

const speedOptions = [0.5, 1, 2, 4, 8]
const fileName = computed(() => props.filePath.split(/[/\\]/).pop() ?? '')

function nextSpeed() {
  const idx = speedOptions.indexOf(speed.value)
  speed.value = speedOptions[(idx + 1) % speedOptions.length] ?? 1
}

const progressPercent = computed(() =>
  totalDuration.value > 0 ? (currentTime.value / totalDuration.value) * 100 : 0
)

const timeText = computed(() => {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return `${fmt(currentTime.value)} / ${fmt(totalDuration.value)}`
})

async function loadRecording() {
  loading.value = true
  try {
    const content = await recorderApi.readRecording(props.filePath)
    const lines = content.trim().split('\n')
    if (lines.length === 0) return

    const header = JSON.parse(lines[0]!) as { width?: number; height?: number; timestamp?: number }
    const width = header.width ?? 120
    const height = header.height ?? 40
    terminalSize.value = { width, height }

    if (header.timestamp) {
      recordingDate.value = new Date(header.timestamp * 1000).toLocaleString()
    }

    if (terminal) {
      terminal.resize(width, height)
    }

    events = []
    for (let i = 1; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]!) as [number, string, string]
        events.push({ time: parsed[0], type: parsed[1], data: parsed[2] })
      } catch {
        // 跳过无效行
      }
    }
    eventCount.value = events.length
    totalDuration.value = events.length > 0 ? events[events.length - 1]!.time : 0
  } catch (e) {
    console.warn('加载录制失败:', e)
  } finally {
    loading.value = false
  }
}

function play() {
  if (events.length === 0) return
  if (eventIndex >= events.length) {
    reset()
  }
  playing.value = true
  scheduleNext()
}

function pause() {
  playing.value = false
  if (playTimer) {
    clearTimeout(playTimer)
    playTimer = null
  }
}

function togglePlay() {
  playing.value ? pause() : play()
}

function reset() {
  pause()
  eventIndex = 0
  currentTime.value = 0
  terminal?.reset()
}

function scheduleNext() {
  if (!playing.value || eventIndex >= events.length) {
    playing.value = false
    return
  }
  const event = events[eventIndex]!
  const prevTime = eventIndex > 0 ? events[eventIndex - 1]!.time : 0
  const delay = ((event.time - prevTime) / speed.value) * 1000

  playTimer = setTimeout(() => {
    if (!playing.value) return
    if (event.type === 'o') {
      terminal?.write(event.data)
    }
    currentTime.value = event.time
    eventIndex++
    scheduleNext()
  }, Math.min(delay, 2000))
}

function seekTo(percent: number) {
  pause()
  terminal?.reset()
  const targetTime = (percent / 100) * totalDuration.value
  eventIndex = 0
  for (let i = 0; i < events.length; i++) {
    if (events[i]!.time > targetTime) break
    if (events[i]!.type === 'o') {
      terminal?.write(events[i]!.data)
    }
    eventIndex = i + 1
  }
  currentTime.value = targetTime
}

function handleProgressClick(e: MouseEvent) {
  const bar = e.currentTarget as HTMLElement
  const rect = bar.getBoundingClientRect()
  const percent = ((e.clientX - rect.left) / rect.width) * 100
  seekTo(Math.max(0, Math.min(100, percent)))
}

async function saveToLocal() {
  const defaultName = fileName.value || 'recording.cast'
  const targetPath = await save({
    defaultPath: defaultName,
    filters: [{ name: 'Asciicast', extensions: ['cast'] }],
  })
  if (!targetPath) return
  try {
    await recorderApi.exportRecording(props.filePath, targetPath)
  } catch (e) {
    console.warn('导出失败:', e)
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  switch (e.key) {
    case ' ':
      e.preventDefault()
      togglePlay()
      break
    case 'r':
    case 'R':
      reset()
      break
    case 'ArrowRight':
      e.preventDefault()
      seekTo(Math.min(100, progressPercent.value + 5))
      break
    case 'ArrowLeft':
      e.preventDefault()
      seekTo(Math.max(0, progressPercent.value - 5))
      break
  }
}

onMounted(() => {
  const tc = activeTheme.value.terminal
  terminal = new Terminal({
    cursorBlink: false,
    fontSize: settingsStore.settings.terminalFontSize,
    fontFamily: settingsStore.settings.terminalFontFamily,
    disableStdin: true,
    theme: {
      background: tc.background,
      foreground: tc.foreground,
      cursor: tc.cursor,
    },
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  if (terminalRef.value) {
    terminal.open(terminalRef.value)
    fitAddon.fit()
  }
  // 监听容器大小变化
  if (terminalRef.value) {
    resizeObserver = new ResizeObserver(() => fitAddon?.fit())
    resizeObserver.observe(terminalRef.value)
  }
  // 自动聚焦以接收键盘事件
  containerRef.value?.focus()
  loadRecording()
})

onBeforeUnmount(() => {
  pause()
  resizeObserver?.disconnect()
  terminal?.dispose()
})
</script>

<template>
  <div ref="containerRef" class="flex h-full flex-col" tabindex="0" @keydown="handleKeydown">
    <!-- 顶部信息栏 -->
    <div class="shrink-0 flex items-center gap-3 border-b border-border px-4 py-2 bg-muted/30">
      <FileVideo class="h-4 w-4 text-muted-foreground shrink-0" />
      <div class="flex-1 min-w-0">
        <span class="text-sm font-medium truncate block">{{ fileName }}</span>
        <span v-if="recordingDate" class="text-[11px] text-muted-foreground">
          {{ recordingDate }}
          <template v-if="terminalSize.width"> · {{ terminalSize.width }}x{{ terminalSize.height }}</template>
          <template v-if="eventCount"> · {{ eventCount }} {{ t('recording.events') }}</template>
        </span>
      </div>
      <div v-if="loading" class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 class="h-3.5 w-3.5 animate-spin" />
        {{ t('recording.loading') }}
      </div>
      <Button
        v-else
        variant="ghost"
        size="icon"
        class="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
        :title="t('recording.saveToLocal')"
        @click="saveToLocal"
      >
        <Download class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- 回放终端 -->
    <div ref="terminalRef" class="flex-1 min-h-0 overflow-hidden p-1" />

    <!-- 控制栏 -->
    <div class="shrink-0 border-t border-border px-4 py-2 space-y-1.5">
      <!-- 进度条 -->
      <div
        class="group flex-1 h-2 bg-muted rounded-full cursor-pointer relative hover:h-2.5 transition-all"
        @click="handleProgressClick"
      >
        <div
          class="h-full bg-primary rounded-full transition-[width] duration-75"
          :style="{ width: `${progressPercent}%` }"
        />
        <!-- 拖拽手柄 -->
        <div
          class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-3.5 rounded-full bg-primary border-2 border-background shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
          :style="{ left: `${progressPercent}%` }"
        />
      </div>
      <!-- 按钮行 -->
      <div class="flex items-center gap-1">
        <TooltipProvider :delay-duration="300">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" class="h-8 w-8" :disabled="loading" @click="togglePlay">
                <Play v-if="!playing" class="h-4 w-4" />
                <Pause v-else class="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top"><p>{{ playing ? t('recording.pause') : t('recording.play') }} (Space)</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" class="h-8 w-8" :disabled="loading" @click="reset">
                <RotateCcw class="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top"><p>{{ t('recording.reset') }} (R)</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span class="text-xs text-muted-foreground tabular-nums ml-1">{{ timeText }}</span>
        <div class="flex-1" />
        <Button variant="outline" size="sm" class="h-7 px-2.5 text-xs tabular-nums gap-1" @click="nextSpeed">
          <FastForward class="h-3 w-3" />
          {{ speed }}x
        </Button>
      </div>
    </div>
  </div>
</template>
