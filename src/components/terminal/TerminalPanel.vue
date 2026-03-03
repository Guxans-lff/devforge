<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { listen } from '@tauri-apps/api/event'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
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
let sessionId = ''
let unlistenOutput: (() => void) | null = null
let unlistenStatus: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let detectCwdUntil = 0 // 时间戳，在此之前检测 pwd 输出

function createTerminal() {
  const tc = activeTheme.value.terminal

  terminal = new Terminal({
    cursorBlink: settingsStore.settings.terminalCursorBlink,
    fontSize: settingsStore.settings.terminalFontSize,
    fontFamily: settingsStore.settings.terminalFontFamily,
    cursorStyle: settingsStore.settings.terminalCursorStyle,
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

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon())

  if (terminalRef.value) {
    terminal.open(terminalRef.value)
    fitAddon.fit()
  }

  // Send user input to SSH
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

    // Listen for SSH output
    unlistenOutput = await listen<number[]>(
      `ssh://output/${sessionId}`,
      (event) => {
        if (terminal) {
          const data = new Uint8Array(event.payload)
          terminal.write(data)
          // 仅在 pwd 检测窗口期内解析输出
          if (detectCwdUntil > Date.now()) {
            try {
              const text = new TextDecoder().decode(data)
              const lines = text.split(/\r?\n/)
              for (const line of lines) {
                const clean = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()
                if (/^\/[a-zA-Z0-9_.\/\-]+$/.test(clean) && clean.length > 1 && !clean.includes(' ')) {
                  emit('cwdChange', clean)
                  detectCwdUntil = 0 // 匹配到后关闭检测
                  break
                }
              }
            } catch { /* ignore */ }
          }
        }
      },
    )

    // Listen for status changes
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

  fitAddon.fit()

  if (sessionId && status.value === 'connected') {
    sshApi.sshResize(sessionId, terminal.cols, terminal.rows).catch((err) => {
      console.warn('SSH resize failed:', err)
    })
  }
}

async function cleanup() {
  unlistenOutput?.()
  unlistenOutput = null
  unlistenStatus?.()
  unlistenStatus = null
  resizeObserver?.disconnect()
  resizeObserver = null

  if (sessionId) {
    await sshApi.sshDisconnect(sessionId).catch(() => {})
    sessionId = ''
  }

  terminal?.dispose()
  terminal = null
  fitAddon = null
}

onMounted(() => {
  createTerminal()

  // Observe container resize
  if (terminalRef.value) {
    resizeObserver = new ResizeObserver(() => {
      handleResize()
    })
    resizeObserver.observe(terminalRef.value)
  }

  connect()
})

onBeforeUnmount(() => {
  cleanup()
})

// React to theme changes
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

// React to user settings changes
watch(
  () => settingsStore.settings,
  (s) => {
    if (!terminal) return
    terminal.options.fontSize = s.terminalFontSize
    terminal.options.fontFamily = s.terminalFontFamily
    terminal.options.cursorStyle = s.terminalCursorStyle
    terminal.options.cursorBlink = s.terminalCursorBlink
    fitAddon?.fit()
  },
  { deep: true },
)

function sendData(data: string) {
  if (sessionId && status.value === 'connected') {
    // 检测是否发送了 pwd 或 cd 命令，开启 cwd 检测窗口
    const cmd = data.replace(/\n$/, '').trim()
    if (cmd === 'pwd' || cmd.startsWith('cd ') || cmd === 'cd') {
      detectCwdUntil = Date.now() + 3000 // 3 秒检测窗口
    }
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

defineExpose({ reconnect, handleResize, sendData, getSessionInfo })
</script>

<template>
  <div class="relative h-full w-full overflow-hidden">
    <!-- Terminal container -->
    <div
      ref="terminalRef"
      class="h-full w-full p-2"
      :class="{ 'opacity-30': status === 'connecting' }"
      @dragover.prevent
      @drop.prevent="handleDrop"
    />

    <!-- Connecting overlay -->
    <div
      v-if="status === 'connecting'"
      class="absolute inset-0 flex items-center justify-center"
    >
      <div class="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 class="h-4 w-4 animate-spin" />
        {{ t('terminal.connecting') }}
      </div>
    </div>

    <!-- Error / Disconnected State (High Fidelity Card) -->
    <div
      v-if="status === 'disconnected' || status === 'error'"
      class="absolute inset-0 z-10 flex items-center justify-center bg-background/40 backdrop-blur-[2px] p-6 animate-in fade-in duration-500"
    >
      <div class="relative w-full max-w-sm overflow-hidden rounded-2xl border border-border/20 bg-background/80 p-6 shadow-2xl backdrop-blur-xl ring-1 ring-white/5">
        <!-- Background Glow -->
        <div class="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-destructive/10 blur-2xl"></div>
        <div class="absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-primary/5 blur-2xl"></div>

        <div class="relative flex flex-col items-center text-center">
          <!-- Icon Container -->
          <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 ring-1 ring-destructive/20 shadow-[0_8px_16px_rgba(var(--color-destructive),0.1)]">
            <ShieldAlert class="h-7 w-7 text-destructive" />
          </div>

          <h3 class="mb-1 text-base font-bold tracking-tight text-foreground">
            {{ status === 'error' ? t('connection.connectionFailed') : t('terminal.disconnected') }}
          </h3>
          <p class="mb-6 px-4 font-mono text-[11px] font-medium leading-relaxed text-muted-foreground/80 break-all">
             {{ status === 'error' ? errorMessage : t('terminal.disconnected') }}
          </p>

          <!-- Diagnostic Suggestions -->
          <div class="mb-8 grid w-full grid-cols-1 gap-2 text-left">
             <div class="flex items-start gap-2.5 rounded-lg bg-muted/30 p-2.5 ring-1 ring-border/5 transition-colors hover:bg-muted/50">
                <WifiOff class="mt-0.5 h-3.5 w-3.5 text-muted-foreground/60" />
                <div>
                   <p class="text-[10px] font-bold text-foreground/70 uppercase tracking-tighter">{{ t('connection.checkNetwork' as any) || '网络检查' }}</p>
                   <p class="text-[9px] font-medium text-muted-foreground/50">{{ t('connection.checkNetworkDesc' as any) || '确保本地网络通畅，检查代理或 VPN 设置' }}</p>
                </div>
             </div>
             <div class="flex items-start gap-2.5 rounded-lg bg-muted/30 p-2.5 ring-1 ring-border/5 transition-colors hover:bg-muted/50">
                <KeyRound class="mt-0.5 h-3.5 w-3.5 text-muted-foreground/60" />
                <div>
                   <p class="text-[10px] font-bold text-foreground/70 uppercase tracking-tighter">{{ t('connection.checkAuth' as any) || '身份验证' }}</p>
                   <p class="text-[9px] font-medium text-muted-foreground/50">{{ t('connection.checkAuthDesc' as any) || '检查连接配置中的用户名、密码 or 私钥' }}</p>
                </div>
             </div>
             <div class="flex items-start gap-2.5 rounded-lg bg-muted/30 p-2.5 ring-1 ring-border/5 transition-colors hover:bg-muted/50">
                <Activity class="mt-0.5 h-3.5 w-3.5 text-muted-foreground/60" />
                <div>
                   <p class="text-[10px] font-bold text-foreground/70 uppercase tracking-tighter">{{ t('connection.checkServer' as any) || '服务器状态' }}</p>
                   <p class="text-[9px] font-medium text-muted-foreground/50">{{ t('connection.checkServerDesc' as any) || '确认远程主机在线且 22 端口已开放' }}</p>
                </div>
             </div>
          </div>

          <!-- Actions -->
          <div class="flex w-full items-center gap-2">
            <Button
              class="flex-1 h-9 bg-primary text-[12px] font-bold shadow-[0_4px_12px_rgba(var(--color-primary),0.3)] hover:shadow-[0_6px_20px_rgba(var(--color-primary),0.4)] transition-all active:scale-95"
              @click="reconnect"
            >
              <RotateCcw class="mr-1.5 h-3.5 w-3.5" />
              {{ t('terminal.reconnect') }}
            </Button>
            <Button
              variant="outline"
              class="h-9 px-4 text-[12px] font-medium border-border/40 hover:bg-muted/30 transition-all active:scale-95"
              @click="status = 'connecting'; connect()"
            >
              {{ t('common.retry' as any) || '重试' }}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
