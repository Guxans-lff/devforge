<script setup lang="ts">
/**
 * 本地终端面板 — 使用 portable-pty 创建本地 Shell
 * 简化版 TerminalPanel，无 SSH 流控逻辑
 */
import { ref, onMounted, onBeforeUnmount, onDeactivated, watch } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import * as localShellApi from '@/api/local-shell'
import { useTheme } from '@/composables/useTheme'
import { useSettingsStore } from '@/stores/settings'
import { Loader2, AlertCircle, RotateCcw } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  sessionId: string
}>()

const emit = defineEmits<{
  statusChange: [status: string]
}>()

const { activeTheme, activeThemeId } = useTheme()
const settingsStore = useSettingsStore()
const terminalRef = ref<HTMLDivElement>()
const status = ref<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
const errorMessage = ref('')

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let unlistenOutput: (() => void) | null = null
let unlistenExit: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null

/** 从主题定义获取 xterm 主题配色（与 TerminalPanel 完全一致） */
function getTermTheme() {
  const tc = activeTheme.value.terminal
  return {
    background: tc.background,
    foreground: tc.foreground,
    cursor: tc.cursor,
    selectionBackground: tc.selectionBackground,
    black: tc.black,
    red: tc.red,
    green: tc.green,
    yellow: tc.yellow,
    blue: tc.blue,
    magenta: tc.magenta,
    cyan: tc.cyan,
    white: tc.white,
    brightBlack: tc.brightBlack,
    brightRed: tc.brightRed,
    brightGreen: tc.brightGreen,
    brightYellow: tc.brightYellow,
    brightBlue: tc.brightBlue,
    brightMagenta: tc.brightMagenta,
    brightCyan: tc.brightCyan,
    brightWhite: tc.brightWhite,
  }
}

async function connect() {
  if (!terminalRef.value) return

  status.value = 'connecting'
  errorMessage.value = ''
  emit('statusChange', 'connecting')

  // 创建 xterm.js 实例（配置与 TerminalPanel 保持一致）
  terminal = new Terminal({
    cursorBlink: settingsStore.settings.terminalCursorBlink,
    cursorStyle: settingsStore.settings.terminalCursorStyle,
    fontSize: settingsStore.settings.terminalFontSize,
    fontFamily: settingsStore.settings.terminalFontFamily,
    theme: getTermTheme(),
    allowProposedApi: true,
    scrollback: settingsStore.settings.terminalScrollback ?? 5000,
  })

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon())
  terminal.loadAddon(new Unicode11Addon())
  terminal.unicode.activeVersion = '11'

  terminal.open(terminalRef.value)

  // 尝试加载 WebGL 渲染器
  try {
    terminal.loadAddon(new WebglAddon())
  } catch {
    // WebGL 不可用则使用 canvas 渲染
  }

  fitAddon.fit()

  const cols = terminal.cols
  const rows = terminal.rows

  // 监听 PTY 输出
  unlistenOutput = await listen<string>(`local://output/${props.sessionId}`, (event) => {
    if (!terminal) return
    const bytes = Uint8Array.from(atob(event.payload), c => c.charCodeAt(0))
    terminal.write(bytes)
  })

  // 监听 Shell 退出
  unlistenExit = await listen<string>(`local://exit/${props.sessionId}`, () => {
    status.value = 'disconnected'
    emit('statusChange', 'disconnected')
    terminal?.write('\r\n\x1b[90m[Shell 已退出]\x1b[0m\r\n')
  })

  // 用户输入 → 发送到后端
  terminal.onData((data) => {
    if (status.value === 'connected') {
      localShellApi.localShellWrite(props.sessionId, data).catch(() => {})
    }
  })

  // 启动 Shell
  try {
    await localShellApi.localShellSpawn(props.sessionId, cols, rows)
    status.value = 'connected'
    emit('statusChange', 'connected')
    terminal.focus()
  } catch (e: any) {
    status.value = 'error'
    errorMessage.value = e?.message ?? String(e)
    emit('statusChange', 'error')
    return
  }

  // 监听窗口大小变化
  resizeObserver = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      fitAddon?.fit()
      if (terminal && status.value === 'connected') {
        localShellApi.localShellResize(props.sessionId, terminal.cols, terminal.rows).catch(() => {})
      }
    }, 100)
  })
  resizeObserver.observe(terminalRef.value)
}

async function reconnect() {
  await cleanup()
  connect()
}

async function cleanup() {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (resizeTimer) {
    clearTimeout(resizeTimer)
    resizeTimer = null
  }
  unlistenOutput?.()
  unlistenOutput = null
  unlistenExit?.()
  unlistenExit = null

  if (status.value === 'connected') {
    try {
      await localShellApi.localShellClose(props.sessionId)
    } catch { /* 忽略关闭错误 */ }
  }

  terminal?.dispose()
  terminal = null
  fitAddon = null
}

// 主题切换时更新配色
watch(activeThemeId, () => {
  if (terminal) {
    terminal.options.theme = getTermTheme()
  }
})

// 字体大小变化
watch(() => settingsStore.settings.terminalFontSize, (size) => {
  if (terminal) {
    terminal.options.fontSize = size
    fitAddon?.fit()
  }
})

onMounted(() => {
  connect()
})

onBeforeUnmount(async () => {
  await cleanup()
})

// KeepAlive 场景：组件被缓存 deactivate 时也需要清理 PTY 资源
onDeactivated(async () => {
  await cleanup()
})

defineExpose({
  focus: () => terminal?.focus(),
})
</script>

<template>
  <div class="relative h-full w-full overflow-hidden">
    <!-- 终端容器 -->
    <div
      ref="terminalRef"
      class="h-full w-full"
      :class="{ 'opacity-0': status !== 'connected' }"
    />

    <!-- 连接中 -->
    <div
      v-if="status === 'connecting'"
      class="absolute inset-0 flex items-center justify-center bg-background"
    >
      <div class="flex flex-col items-center gap-3">
        <Loader2 class="h-6 w-6 animate-spin text-primary" />
        <span class="text-sm text-muted-foreground">启动本地终端...</span>
      </div>
    </div>

    <!-- 错误 -->
    <div
      v-if="status === 'error'"
      class="absolute inset-0 flex items-center justify-center bg-background"
    >
      <div class="flex flex-col items-center gap-3 text-center max-w-md">
        <AlertCircle class="h-8 w-8 text-destructive" />
        <div class="space-y-1">
          <p class="text-sm font-medium text-foreground">启动失败</p>
          <p class="text-xs text-muted-foreground">{{ errorMessage }}</p>
        </div>
        <Button variant="outline" size="sm" @click="reconnect">
          <RotateCcw class="h-3.5 w-3.5 mr-1.5" />
          重试
        </Button>
      </div>
    </div>

    <!-- 断开连接 -->
    <div
      v-if="status === 'disconnected'"
      class="absolute inset-0 flex items-center justify-center bg-background/80"
    >
      <div class="flex flex-col items-center gap-3">
        <p class="text-sm text-muted-foreground">Shell 已退出</p>
        <Button variant="outline" size="sm" @click="reconnect">
          <RotateCcw class="h-3.5 w-3.5 mr-1.5" />
          重新打开
        </Button>
      </div>
    </div>
  </div>
</template>
