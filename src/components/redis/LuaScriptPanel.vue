<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as monaco from 'monaco-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Code, Play, Loader2, Trash2 } from 'lucide-vue-next'
import { redisEvalLua, redisScriptFlush } from '@/api/redis'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'
import { useTheme } from '@/composables/useTheme'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{
  connectionId: string
}>()

const { t } = useI18n()
const toast = useToast()
const { activeTheme, activeThemeId } = useTheme()
const settingsStore = useSettingsStore()

// Monaco 编辑器
const editorContainer = ref<HTMLDivElement>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null

// 脚本
const keysInput = ref('')
const argsInput = ref('')

// 执行状态
const executing = ref(false)
const resultText = ref('')
const durationMs = ref(0)
const hasResult = ref(false)
const isError = ref(false)

/** 注册主题 */
function registerMonacoTheme(): string {
  const theme = activeTheme.value
  const themeId = `devforge-${theme.id}`
  monaco.editor.defineTheme(themeId, {
    base: theme.editor.base,
    inherit: true,
    rules: theme.editor.rules,
    colors: theme.editor.colors,
  })
  return themeId
}

/** 获取脚本内容 */
function getScript(): string {
  return editor?.getValue() ?? ''
}

onMounted(async () => {
  await nextTick()
  if (!editorContainer.value) return

  editor = monaco.editor.create(editorContainer.value, {
    value: 'return "Hello from Lua!"',
    language: 'lua',
    theme: registerMonacoTheme(),
    minimap: { enabled: false },
    fontSize: settingsStore.settings.editorFontSize,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
    lineNumbers: 'on',
    tabSize: 2,
    wordWrap: 'on',
    automaticLayout: true,
    scrollBeyondLastLine: false,
    padding: { top: 8, bottom: 8 },
    renderLineHighlight: 'line',
    cursorBlinking: 'smooth',
    smoothScrolling: true,
    bracketPairColorization: { enabled: true },
    unicodeHighlight: {
      ambiguousCharacters: false,
      invisibleCharacters: false,
    },
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
    },
  })

  // Ctrl+Enter 执行脚本
  editor.addAction({
    id: 'execute-lua',
    label: 'Execute Lua Script',
    keybindings: [
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
    ],
    run: () => {
      handleExecute()
    },
  })
})

onBeforeUnmount(() => {
  editor?.dispose()
  editor = null
})

// 主题切换时更新
import { watch } from 'vue'
watch(activeThemeId, () => {
  if (editor) {
    const themeId = registerMonacoTheme()
    monaco.editor.setTheme(themeId)
  }
})

/** 执行 Lua 脚本 */
async function handleExecute() {
  const script = getScript()
  if (!script.trim()) return
  executing.value = true
  isError.value = false
  try {
    const keys = keysInput.value.trim() ? keysInput.value.split(',').map(k => k.trim()) : []
    const args = argsInput.value.trim() ? argsInput.value.split(',').map(a => a.trim()) : []

    const result = await redisEvalLua({
      connectionId: props.connectionId,
      script,
      keys,
      args,
    })

    resultText.value = typeof result.result === 'string'
      ? result.result
      : JSON.stringify(result.result, null, 2)
    durationMs.value = result.durationMs
    hasResult.value = true
  } catch (e) {
    resultText.value = parseBackendError(e).message
    durationMs.value = 0
    hasResult.value = true
    isError.value = true
  } finally {
    executing.value = false
  }
}

/** 清空脚本缓存 */
async function handleFlush() {
  try {
    await redisScriptFlush(props.connectionId)
    toast.success(t('redis.lua.flushed'))
  } catch (e) {
    toast.error(t('redis.lua.flushFailed'), parseBackendError(e).message)
  }
}
</script>

<template>
  <div class="flex h-full flex-col border-l border-border/40 bg-background/50">
    <!-- 头部 -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 shrink-0">
      <Code class="h-3.5 w-3.5 text-muted-foreground/50" />
      <span class="text-xs font-bold text-muted-foreground/50 uppercase tracking-wider">{{ t('redis.lua.title') }}</span>
      <div class="flex-1" />
      <Button variant="ghost" size="sm" class="h-7 text-xs px-2" @click="handleFlush">
        <Trash2 class="h-3.5 w-3.5 mr-1" />
        {{ t('redis.lua.scriptFlush') }}
      </Button>
    </div>

    <!-- Monaco 编辑器 -->
    <div ref="editorContainer" class="flex-1 min-h-[80px] border-b border-border/20" />

    <!-- KEYS & ARGV -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 shrink-0">
      <span class="text-xs text-muted-foreground/50 w-10 shrink-0">KEYS</span>
      <Input
        v-model="keysInput"
        :placeholder="t('redis.lua.keysPlaceholder')"
        class="h-7 flex-1 text-xs font-mono"
      />
    </div>
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 shrink-0">
      <span class="text-xs text-muted-foreground/50 w-10 shrink-0">ARGV</span>
      <Input
        v-model="argsInput"
        :placeholder="t('redis.lua.argsPlaceholder')"
        class="h-7 flex-1 text-xs font-mono"
      />
    </div>

    <!-- 执行按钮 -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 shrink-0">
      <Button
        size="sm"
        class="h-7 text-xs px-3"
        :disabled="executing"
        @click="handleExecute"
      >
        <Loader2 v-if="executing" class="h-3.5 w-3.5 mr-1 animate-spin" />
        <Play v-else class="h-3.5 w-3.5 mr-1" />
        {{ t('redis.lua.execute') }}
      </Button>
      <span class="text-[10px] text-muted-foreground/30">Ctrl+Enter</span>
      <span v-if="hasResult && !isError" class="text-[10px] text-muted-foreground/40 ml-auto">
        {{ t('redis.lua.duration', { ms: durationMs }) }}
      </span>
    </div>

    <!-- 结果区域 -->
    <div class="flex-1 min-h-[60px] overflow-auto p-3">
      <div v-if="hasResult">
        <pre
          class="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed"
          :class="isError ? 'text-destructive' : 'text-foreground/80'"
        >{{ resultText }}</pre>
      </div>
      <div v-else class="text-muted-foreground/20 text-center py-8 text-xs">
        {{ t('redis.lua.noResult') }}
      </div>
    </div>
  </div>
</template>
