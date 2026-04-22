<script setup lang="ts">
/**
 * 本地文件编辑器 Tab 视图（IDEA 风格）
 *
 * 一 Tab 一文件，Monaco 呈现，Ctrl+S 保存，脏态同步到 Tab。
 */
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch, nextTick } from 'vue'
import * as monaco from 'monaco-editor'
import { useLocalFileEditorStore } from '@/stores/local-file-editor'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import { useTheme } from '@/composables/useTheme'
import { useSettingsStore } from '@/stores/settings'
import { useToast } from '@/composables/useToast'
import { revealInFolder } from '@/api/system'
import { Button } from '@/components/ui/button'
import { Save, Loader2, AlertCircle, RotateCw, FileText, Copy, FolderOpen } from 'lucide-vue-next'

const props = defineProps<{
  tabId: string
  absolutePath: string
}>()

const store = useLocalFileEditorStore()
const workspace = useWorkspaceStore()
const wsFiles = useWorkspaceFilesStore()
const { activeTheme } = useTheme()
const settings = useSettingsStore()
const toast = useToast()

const containerRef = ref<HTMLDivElement | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null

const file = computed(() => store.openFiles.get(props.absolutePath))
const dirty = computed(() => store.isDirty(props.absolutePath))

/** 面包屑片段（最后一段为文件名） */
const pathSegments = computed(() => {
  return props.absolutePath.split(/[/\\]/).filter(Boolean)
})

/** 编辑器统计（行数 / 字符数 / 大小） */
const stats = computed(() => {
  const content = file.value?.content ?? ''
  const bytes = new Blob([content]).size
  const lines = content === '' ? 0 : content.split('\n').length
  return {
    lines,
    chars: content.length,
    size: formatBytes(bytes),
  }
})

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function copyPath() {
  try {
    await navigator.clipboard.writeText(props.absolutePath)
    toast.success('路径已复制')
  } catch (e) {
    toast.error('复制失败', String(e))
  }
}

async function revealFile() {
  try {
    await revealInFolder(props.absolutePath)
  } catch (e) {
    toast.error('打开失败', formatError(e))
  }
}

function formatError(e: unknown): string {
  if (e == null) return '未知错误'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (typeof e === 'object') {
    const obj = e as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.error === 'string') return obj.error
    const keys = Object.keys(obj)
    if (keys.length === 1) {
      const k = keys[0]!
      const v = obj[k]
      if (typeof v === 'string') return `${k}: ${v}`
    }
    try {
      const s = JSON.stringify(e)
      if (s && s !== '{}') return s
    } catch { /* ignore */ }
  }
  return String(e)
}

function registerTheme(): string {
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

function createEditor() {
  if (!containerRef.value || editor) return
  const f = file.value
  if (!f) return

  editor = monaco.editor.create(containerRef.value, {
    value: f.content,
    language: f.language,
    theme: registerTheme(),
    minimap: { enabled: settings.settings.editorMinimap },
    fontSize: settings.settings.editorFontSize,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
    lineNumbers: 'on',
    tabSize: settings.settings.editorTabSize,
    wordWrap: settings.settings.editorWordWrap ? 'on' : 'off',
    automaticLayout: true,
    scrollBeyondLastLine: false,
    padding: { top: 8, bottom: 8 },
    renderLineHighlight: 'line',
    cursorBlinking: 'smooth',
    smoothScrolling: true,
    bracketPairColorization: { enabled: true },
  })

  editor.onDidChangeModelContent(() => {
    if (!editor) return
    store.updateContent(props.absolutePath, editor.getValue())
  })

  editor.onDidChangeCursorPosition(() => reportEditorContext())
  editor.onDidChangeCursorSelection(() => reportEditorContext())

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    void handleSave()
  })

  reportEditorContext()
}

/** 上报当前光标/选区到 workspace-files（供 AI IDE 上下文注入） */
function reportEditorContext(): void {
  if (!editor) return
  const f = file.value
  if (!f) return
  const pos = editor.getPosition()
  const sel = editor.getSelection()
  const selectedText = sel && !sel.isEmpty()
    ? (editor.getModel()?.getValueInRange(sel) ?? '')
    : ''
  wsFiles.setActiveEditor({
    path: props.absolutePath,
    language: f.language,
    cursorLine: pos?.lineNumber ?? 1,
    selectedText,
  })
}

async function handleSave() {
  const f = file.value
  if (!f || !dirty.value) return
  try {
    await store.save(props.absolutePath)
    toast.success('保存成功', f.fileName)
  } catch (e) {
    toast.error('保存失败', formatError(e))
  }
}

async function handleReload() {
  store.close(props.absolutePath)
  await store.ensureOpen(props.absolutePath)
}

onMounted(async () => {
  await store.ensureOpen(props.absolutePath)
  await nextTick()
  if (file.value && !file.value.loadError) {
    createEditor()
  }
})

onActivated(() => {
  reportEditorContext()
})

onDeactivated(() => {
  wsFiles.clearActiveEditor(props.absolutePath)
})

// 文件载入完成后创建编辑器
watch(
  () => file.value?.isLoading,
  async (loading, wasLoading) => {
    if (wasLoading && !loading && !file.value?.loadError) {
      await nextTick()
      createEditor()
    }
  },
)

// 同步脏态到 Tab
watch(dirty, (isDirty) => {
  const tab = workspace.tabs.find(t => t.id === props.tabId)
  if (tab && tab.dirty !== isDirty) {
    tab.dirty = isDirty
  }
}, { immediate: true })

// 主题切换
watch(
  () => activeTheme.value.id,
  () => {
    if (editor) {
      const themeId = registerTheme()
      monaco.editor.setTheme(themeId)
    }
  },
)

// 设置热更新
watch(
  () => [
    settings.settings.editorFontSize,
    settings.settings.editorTabSize,
    settings.settings.editorWordWrap,
    settings.settings.editorMinimap,
  ] as const,
  ([fontSize, tabSize, wordWrap, minimap]) => {
    editor?.updateOptions({
      fontSize,
      tabSize,
      wordWrap: wordWrap ? 'on' : 'off',
      minimap: { enabled: minimap },
    })
  },
)

onBeforeUnmount(() => {
  editor?.dispose()
  editor = null
  wsFiles.clearActiveEditor(props.absolutePath)
})
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <!-- 顶栏：面包屑 + 操作 -->
    <div class="flex items-center justify-between gap-3 border-b border-border/60 bg-gradient-to-b from-muted/40 to-muted/10 px-3 py-1.5">
      <!-- 面包屑 -->
      <div class="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
        <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10">
          <FileText class="h-3 w-3 text-primary" />
        </div>
        <div class="flex min-w-0 items-center gap-1 overflow-hidden">
          <template v-for="(seg, i) in pathSegments" :key="i">
            <span
              v-if="i < pathSegments.length - 1"
              class="shrink-0 text-muted-foreground/70"
            >
              {{ seg }}
            </span>
            <span
              v-else
              class="truncate font-medium text-foreground"
              :title="absolutePath"
            >
              {{ seg }}
            </span>
            <span
              v-if="i < pathSegments.length - 1"
              class="shrink-0 text-muted-foreground/40"
            >
              ›
            </span>
          </template>
          <span
            v-if="dirty"
            class="ml-1.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-[1px] text-[10px] font-medium text-amber-500"
          >
            <span class="h-1 w-1 rounded-full bg-amber-500" />
            未保存
          </span>
        </div>
      </div>

      <!-- 操作按钮组 -->
      <div class="flex shrink-0 items-center gap-0.5">
        <button
          class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-muted hover:text-foreground"
          title="复制路径"
          @click="copyPath"
        >
          <Copy class="h-3 w-3" />
        </button>
        <button
          class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-muted hover:text-foreground"
          title="在文件管理器中打开"
          @click="revealFile"
        >
          <FolderOpen class="h-3 w-3" />
        </button>
        <div class="mx-1 h-4 w-px bg-border/60" />
        <Button
          :disabled="!dirty || file?.isSaving"
          variant="ghost"
          size="sm"
          class="h-6 gap-1 px-2 text-xs"
          :class="dirty ? 'text-primary hover:bg-primary/10' : 'text-muted-foreground/50'"
          @click="handleSave"
        >
          <Loader2 v-if="file?.isSaving" class="h-3 w-3 animate-spin" />
          <Save v-else class="h-3 w-3" />
          {{ file?.isSaving ? '保存中' : '保存' }}
          <kbd v-if="dirty && !file?.isSaving" class="ml-0.5 hidden rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground/70 md:inline-block">Ctrl+S</kbd>
        </Button>
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="file?.isLoading" class="flex flex-1 flex-col items-center justify-center gap-2">
      <Loader2 class="h-6 w-6 animate-spin text-primary/70" />
      <p class="text-xs text-muted-foreground">正在加载文件…</p>
    </div>

    <!-- 错误态 -->
    <div v-else-if="file?.loadError" class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm">
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle class="h-6 w-6 text-destructive" />
      </div>
      <div class="max-w-[420px] text-center">
        <p class="font-medium text-foreground">无法打开文件</p>
        <p class="mt-1 break-all text-xs text-muted-foreground">{{ file.loadError }}</p>
      </div>
      <Button variant="outline" size="sm" class="gap-1" @click="handleReload">
        <RotateCw class="h-3 w-3" /> 重试
      </Button>
    </div>

    <!-- 编辑器 -->
    <div v-else class="relative min-h-0 flex-1 overflow-hidden">
      <div ref="containerRef" class="absolute inset-0 select-text" />
    </div>

    <!-- 状态栏 -->
    <div
      v-if="file && !file.isLoading && !file.loadError"
      class="flex items-center justify-between gap-4 border-t border-border/60 bg-muted/20 px-3 py-1 text-[11px] text-muted-foreground"
    >
      <div class="flex items-center gap-3">
        <span class="flex items-center gap-1.5">
          <span
            class="h-1.5 w-1.5 rounded-full transition-colors"
            :class="dirty ? 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]' : 'bg-emerald-500/70'"
          />
          {{ dirty ? '已修改' : '已保存' }}
        </span>
        <span class="text-muted-foreground/30">·</span>
        <span>{{ stats.lines }} 行</span>
        <span class="text-muted-foreground/30">·</span>
        <span>{{ stats.chars }} 字符</span>
        <span class="text-muted-foreground/30">·</span>
        <span>{{ stats.size }}</span>
      </div>
      <div class="flex items-center gap-3">
        <span class="rounded bg-muted/60 px-1.5 py-[1px] font-mono text-[10px] uppercase tracking-wide text-foreground/70">
          {{ file.language }}
        </span>
        <span>UTF-8</span>
        <span>LF</span>
      </div>
    </div>
  </div>
</template>
