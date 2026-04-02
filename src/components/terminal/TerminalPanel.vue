<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, onActivated, onDeactivated, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { listen } from '@tauri-apps/api/event'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import * as sshApi from '@/api/ssh'
import { useTheme } from '@/composables/useTheme'
import { useSettingsStore } from '@/stores/settings'
import { Loader2, ShieldAlert, WifiOff, KeyRound, Activity, RotateCcw } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  connectionId: string
  connectionName: string
}>()

const emit = defineEmits<{
  statusChange: [status: string]
  cwdChange: [path: string]
}>()

const { t } = useI18n()
const { activeTheme, activeThemeId } = useTheme()
const settingsStore = useSettingsStore()
const terminalRef = ref<HTMLDivElement>()
const status = ref<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
const errorMessage = ref('')

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let searchAddon: SearchAddon | null = null
let sessionId = ''
let unlistenOutput: (() => void) | null = null
let unlistenStatus: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let webglAddon: WebglAddon | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let paused = false // deactivated 时暂停数据处理
let lastDetectedCwd = '' // 最近一次获取到的工作目录

// === 端到端流控写入引擎（参考 VS Code + xterm.js 官方方案）===
//
// 核心原理：
//   xterm.js 的 write(data, callback) 在数据被解析处理后触发 callback。
//   我们在 callback 中累计已处理字节数，每处理 ACK_BYTE_THRESHOLD 字节
//   就通过 Tauri command 通知后端。后端据此决定是否暂停从 SSH channel 读取。
//
// 这是 xterm.js 官方推荐的水位线流控方案，VS Code 终端也是这么做的。

// 流控状态
let totalReceived = 0       // 累计从后端收到的字节数
let totalAcked = 0          // 累计已通过 ACK 通知后端的字节数
let totalProcessed = 0      // 累计 xterm.js 已处理完的字节数
let pendingAckBytes = 0     // 自上次 ACK 以来已处理但未通知的字节数

// 流控参数
const ACK_BYTE_THRESHOLD = 128_000  // 每处理 128KB 发一次 ACK

/** 发送 ACK 到后端，通知已处理的字节数 */
function sendFlowAck() {
  if (!sessionId || pendingAckBytes === 0) return
  totalAcked = totalProcessed
  pendingAckBytes = 0
  sshApi.sshFlowAck(sessionId, totalAcked).catch((e: unknown) => console.warn('[Terminal]', e))
}

/** 将数据写入 xterm.js 并注册处理完成回调用于流控 */
function flowControlledWrite(data: Uint8Array) {
  if (!terminal || paused) return

  const chunkSize = data.length
  totalReceived += chunkSize

  // 使用 xterm.js 的 write callback：数据被解析处理完后触发
  terminal.write(data, () => {
    totalProcessed += chunkSize
    pendingAckBytes += chunkSize

    // 累积到阈值再发 ACK，避免过于频繁的 IPC 调用
    if (pendingAckBytes >= ACK_BYTE_THRESHOLD) {
      sendFlowAck()
    }
  })
}

function createTerminal() {
  const tc = activeTheme.value.terminal

  terminal = new Terminal({
    cursorBlink: settingsStore.settings.terminalCursorBlink,
    fontSize: settingsStore.settings.terminalFontSize,
    fontFamily: settingsStore.settings.terminalFontFamily,
    cursorStyle: settingsStore.settings.terminalCursorStyle,
    scrollback: settingsStore.settings.terminalScrollback ?? 5000,
    theme: {
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
    },
    allowProposedApi: true,
  })

  // 基础插件
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon())

  // Unicode 11 插件 — CJK 宽字符正确对齐
  const unicode11 = new Unicode11Addon()
  terminal.loadAddon(unicode11)
  terminal.unicode.activeVersion = '11'

  // Search 插件 — 终端内搜索
  searchAddon = new SearchAddon()
  terminal.loadAddon(searchAddon)

  if (terminalRef.value) {
    terminal.open(terminalRef.value)
    fitAddon.fit()

    // WebGL 渲染器 — GPU 加速
    try {
      webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose()
        webglAddon = null
      })
      terminal.loadAddon(webglAddon)
    } catch (e) {
      webglAddon = null
      console.warn('WebGL 渲染器加载失败，回退到 Canvas 2D:', e)
    }
  }

  // 用户键盘输入发送到 SSH
  terminal.onData((data) => {
    if (sessionId && status.value === 'connected') {
      sshApi.sshSendData(sessionId, data).catch((err) => {
        console.warn('SSH send data failed:', err)
      })
    }
  })
}

async function connect() {
  if (!terminal || !fitAddon) return

  status.value = 'connecting'
  emit('statusChange', 'connecting')

  try {
    const cols = terminal.cols
    const rows = terminal.rows

    const session = await sshApi.sshConnect(props.connectionId, cols, rows)
    sessionId = session.sessionId

    // 监听 SSH 输出（Base64 编码传输）
    unlistenOutput = await listen<string>(
      `ssh://output/${sessionId}`,
      (event) => {
        if (terminal) {
          try {
            const binaryStr = atob(event.payload)
            const data = Uint8Array.from(binaryStr, c => c.charCodeAt(0))
            flowControlledWrite(data)
          } catch (e) {
            console.error('Terminal Base64 decode error:', e);
          }
        }
      },
    )

    // 监听连接状态变化
    unlistenStatus = await listen<string>(
      `ssh://status/${sessionId}`,
      () => {
        status.value = 'disconnected'
        emit('statusChange', 'disconnected')
        terminal?.write('\r\n\x1b[90m--- Session disconnected ---\x1b[0m\r\n')
      },
    )

    status.value = 'connected'
    emit('statusChange', 'connected')
  } catch (e) {
    status.value = 'error'
    errorMessage.value = String(e)
    emit('statusChange', 'error')
  }
}

async function reconnect() {
  await cleanup()
  createTerminal()
  await connect()
}

function handleResize() {
  if (!fitAddon || !terminal) return

  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (!fitAddon || !terminal) return
    fitAddon.fit()
    if (sessionId && status.value === 'connected' && terminal) {
      sshApi.sshResize(sessionId, terminal.cols, terminal.rows).catch((err) => {
        console.warn('SSH resize failed:', err)
      })
    }
  }, 150)
}

async function cleanup() {
  unlistenOutput?.()
  unlistenOutput = null
  unlistenStatus?.()
  unlistenStatus = null
  resizeObserver?.disconnect()
  resizeObserver = null
  if (resizeTimer) {
    clearTimeout(resizeTimer)
    resizeTimer = null
  }

  totalReceived = 0
  totalAcked = 0
  totalProcessed = 0
  pendingAckBytes = 0

  paused = false
  if (webglAddon) {
    webglAddon.dispose()
    webglAddon = null
  }

  if (sessionId) {
    await sshApi.sshDisconnect(sessionId).catch((e: unknown) => console.warn('[Terminal]', e))
    sessionId = ''
  }

  searchAddon = null
  terminal?.dispose()
  terminal = null
  fitAddon = null
}

onMounted(() => {
  createTerminal()

  if (terminalRef.value) {
    resizeObserver = new ResizeObserver(() => { handleResize() })
    resizeObserver.observe(terminalRef.value)
  }

  connect()
})

onBeforeUnmount(async () => {
  await cleanup()
})

// KeepAlive 切走时：释放 GPU 资源 + 暂停数据处理
onDeactivated(() => {
  paused = true
  // 释放 GPU 显存
  if (webglAddon) {
    webglAddon.dispose()
    webglAddon = null
  }
  // 停止监听窗口大小变化
  resizeObserver?.disconnect()
})

// KeepAlive 切回时：恢复 WebGL 渲染 + 重连 ResizeObserver
onActivated(() => {
  paused = false
  if (terminal && terminalRef.value) {
    // 重建 WebGL 渲染器
    try {
      if (webglAddon) {
        webglAddon.dispose()
        webglAddon = null
      }
      webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose()
        webglAddon = null
      })
      terminal.loadAddon(webglAddon)
    } catch {
      webglAddon = null
    }
    // 重连 ResizeObserver
    if (terminalRef.value && !resizeObserver) {
      resizeObserver = new ResizeObserver(() => { handleResize() })
      resizeObserver.observe(terminalRef.value)
    }
    fitAddon?.fit()
    terminal.focus()
  }
})

// 响应主题变化
watch(activeThemeId, () => {
  if (terminal) {
    const tc = activeTheme.value.terminal
    terminal.options.theme = {
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
})

// 响应用户设置变化
watch(
  () => settingsStore.settings,
  (s) => {
    if (!terminal) return
    terminal.options.fontSize = s.terminalFontSize
    terminal.options.fontFamily = s.terminalFontFamily
    terminal.options.cursorStyle = s.terminalCursorStyle
    terminal.options.cursorBlink = s.terminalCursorBlink
    terminal.options.scrollback = s.terminalScrollback ?? 5000
    fitAddon?.fit()
  },
  { deep: true },
)

function sendData(data: string) {
  if (sessionId && status.value === 'connected') {
    sshApi.sshSendData(sessionId, data).catch((err) => {
      console.warn('SSH send data failed:', err)
    })
  }
}

function handleDrop(e: DragEvent) {
  const text = e.dataTransfer?.getData('text/plain')
  if (text) {
    sendData(text)
  }
}

function getSessionInfo() {
  return {
    sessionId,
    cols: terminal?.cols ?? 120,
    rows: terminal?.rows ?? 40,
  }
}

/** 获取最近一次缓存的工作目录 */
function getCwd(): string {
  return lastDetectedCwd
}

/**
 * 主动请求当前工作目录（通过后端 exec channel，不在终端中执行命令）
 * 类似 XShell 的做法：后端通过 /proc/<pid>/cwd 获取 shell 进程的 cwd
 */
async function requestCwd(): Promise<string> {
  if (!sessionId || status.value !== 'connected') {
    return lastDetectedCwd
  }
  try {
    const cwd = await sshApi.sshGetCwd(sessionId)
    if (cwd) {
      lastDetectedCwd = cwd
      emit('cwdChange', cwd)
    }
    return cwd || lastDetectedCwd
  } catch (err) {
    return lastDetectedCwd
  }
}

// === 搜索功能方法 ===
function searchFind(query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) {
  if (!searchAddon) return false
  return searchAddon.findNext(query, {
    caseSensitive: options?.caseSensitive,
    wholeWord: options?.wholeWord,
    regex: options?.regex,
  })
}

function searchFindNext(query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) {
  if (!searchAddon) return false
  return searchAddon.findNext(query, {
    caseSensitive: options?.caseSensitive,
    wholeWord: options?.wholeWord,
    regex: options?.regex,
  })
}

function searchFindPrevious(query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) {
  if (!searchAddon) return false
  return searchAddon.findPrevious(query, {
    caseSensitive: options?.caseSensitive,
    wholeWord: options?.wholeWord,
    regex: options?.regex,
  })
}

function searchClear() {
  searchAddon?.clearDecorations()
}

defineExpose({ reconnect, handleResize, sendData, getSessionInfo, getCwd, requestCwd, searchFind, searchFindNext, searchFindPrevious, searchClear })
</script>

<template>
  <div class="relative h-full w-full overflow-hidden">
    <!-- 终端容器 -->
    <div
      ref="terminalRef"
      class="h-full w-full p-2"
      :class="{ 'opacity-30': status === 'connecting' }"
      @dragover.prevent
      @drop.prevent="handleDrop"
    />

    <!-- 连接中遮罩 -->
    <div
      v-if="status === 'connecting'"
      class="absolute inset-0 flex items-center justify-center"
    >
      <div class="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 class="h-4 w-4 animate-spin" />
        {{ t('terminal.connecting') }}
      </div>
    </div>

    <!-- 断开/错误状态卡片 -->
    <div
      v-if="status === 'disconnected' || status === 'error'"
      class="absolute inset-0 z-10 flex items-center justify-center bg-background/40 backdrop-blur-[2px] p-6 animate-in fade-in duration-500"
    >
      <div class="relative w-full max-w-sm overflow-hidden rounded-2xl border border-border/20 bg-background/80 p-6 shadow-2xl backdrop-blur-xl ring-1 ring-white/5">
        <div class="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-destructive/10 blur-2xl"></div>
        <div class="absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-primary/5 blur-2xl"></div>

        <div class="relative flex flex-col items-center text-center">
          <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 ring-1 ring-destructive/20 shadow-[0_8px_16px_rgba(var(--color-destructive),0.1)]">
            <ShieldAlert class="h-7 w-7 text-destructive" />
          </div>

          <h3 class="mb-1 text-base font-bold tracking-tight text-foreground">
            {{ status === 'error' ? t('connection.connectionFailed') : t('terminal.disconnected') }}
          </h3>
          <p class="mb-6 px-4 font-mono text-[11px] font-medium leading-relaxed text-muted-foreground/80 break-all">
             {{ status === 'error' ? errorMessage : t('terminal.disconnected') }}
          </p>

          <!-- 诊断建议 -->
          <div class="mb-8 grid w-full grid-cols-1 gap-2 text-left">
             <div class="flex items-start gap-2.5 rounded-lg bg-muted/30 p-2.5 ring-1 ring-border/5 transition-colors hover:bg-muted/50">
                <WifiOff class="mt-0.5 h-3.5 w-3.5 text-muted-foreground/60" />
                <div>
                   <p class="text-[10px] font-bold text-foreground/70 uppercase tracking-tighter">{{ t('terminal.diagNetwork') }}</p>
                   <p class="text-[9px] font-medium text-muted-foreground/50">{{ t('terminal.diagNetworkHint') }}</p>
                </div>
             </div>
             <div class="flex items-start gap-2.5 rounded-lg bg-muted/30 p-2.5 ring-1 ring-border/5 transition-colors hover:bg-muted/50">
                <KeyRound class="mt-0.5 h-3.5 w-3.5 text-muted-foreground/60" />
                <div>
                   <p class="text-[10px] font-bold text-foreground/70 uppercase tracking-tighter">{{ t('terminal.diagAuth') }}</p>
                   <p class="text-[9px] font-medium text-muted-foreground/50">{{ t('terminal.diagAuthHint') }}</p>
                </div>
             </div>
             <div class="flex items-start gap-2.5 rounded-lg bg-muted/30 p-2.5 ring-1 ring-border/5 transition-colors hover:bg-muted/50">
                <Activity class="mt-0.5 h-3.5 w-3.5 text-muted-foreground/60" />
                <div>
                   <p class="text-[10px] font-bold text-foreground/70 uppercase tracking-tighter">{{ t('terminal.diagServer') }}</p>
                   <p class="text-[9px] font-medium text-muted-foreground/50">{{ t('terminal.diagServerHint') }}</p>
                </div>
             </div>
          </div>

          <!-- 操作按钮 -->
          <div class="flex w-full items-center gap-2">
            <Button
              class="flex-1 h-9 bg-primary text-[12px] font-bold shadow-[0_4px_12px_rgba(var(--color-primary),0.3)] hover:shadow-[0_6px_20px_rgba(var(--color-primary),0.4)] transition-[background-color,color,box-shadow,scale] active:scale-95"
              @click="reconnect"
            >
              <RotateCcw class="mr-1.5 h-3.5 w-3.5" />
              {{ t('terminal.reconnect') }}
            </Button>
            <Button
              variant="outline"
              class="h-9 px-4 text-[12px] font-medium border-border/40 hover:bg-muted/30 transition-[background-color,color,scale] active:scale-95"
              @click="status = 'connecting'; connect()"
            >
              {{ t('common.retry') }}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
