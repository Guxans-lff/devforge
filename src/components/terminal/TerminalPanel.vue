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
import { Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  connectionId: string
  connectionName: string
}>()

const emit = defineEmits<{
  statusChange: [status: string]
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
      sshApi.sshSendData(sessionId, data).catch(() => {
        // silently ignore send failures
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
          terminal.write(new Uint8Array(event.payload))
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
    terminal?.write(`\x1b[31mConnection failed: ${String(e)}\x1b[0m\r\n`)
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
    sshApi.sshResize(sessionId, terminal.cols, terminal.rows).catch(() => {})
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

defineExpose({ reconnect, handleResize })
</script>

<template>
  <div class="relative h-full w-full overflow-hidden">
    <!-- Terminal container -->
    <div
      ref="terminalRef"
      class="h-full w-full p-2"
      :class="{ 'opacity-30': status === 'connecting' }"
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

    <!-- Disconnected / Error overlay -->
    <div
      v-if="status === 'disconnected' || status === 'error'"
      class="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-background/80 py-2 backdrop-blur-sm"
    >
      <span class="text-xs text-muted-foreground">
        {{ status === 'error' ? errorMessage : t('terminal.disconnected') }}
      </span>
      <Button
        size="sm"
        class="text-xs"
        @click="reconnect"
      >
        {{ t('terminal.reconnect') }}
      </Button>
    </div>
  </div>
</template>
