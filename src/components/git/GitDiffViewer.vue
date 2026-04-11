<script setup lang="ts">
/**
 * Git Diff 查看器
 * 支持两种模式：
 * 1. 纯文本 diff（默认，使用 hunk/line 数据）
 * 2. Monaco DiffEditor（side-by-side，需要 old/new 文件内容）
 */
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as monaco from 'monaco-editor'
import { useTheme } from '@/composables/useTheme'
import { useSettingsStore } from '@/stores/settings'
import type { GitDiff, GitFileDiff } from '@/types/git'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Columns2, AlignJustify } from 'lucide-vue-next'
import { gitStatusColor as statusColor, gitStatusIcon as statusIcon } from '@/composables/useGitUtils'

const props = defineProps<{
  diff: GitDiff | null
  fileDiff: GitFileDiff | null
  /** 旧文件内容（Monaco 模式用） */
  oldContent?: string
  /** 新文件内容（Monaco 模式用） */
  newContent?: string
}>()

const { t } = useI18n()
const { activeTheme } = useTheme()
const settingsStore = useSettingsStore()

/** 是否使用 Monaco Diff 编辑器 */
const useMonaco = ref(false)
/** side-by-side 或 inline */
const sideBySide = ref(true)

const diffContainer = ref<HTMLDivElement>()
let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null

// ── Monaco 主题注册 ────────────────────────────────────────────────
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

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    js: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
    json: 'json', html: 'html', css: 'css', scss: 'scss', less: 'less',
    py: 'python', java: 'java', rs: 'rust', go: 'go', rb: 'ruby',
    sh: 'shell', bash: 'shell', sql: 'sql', yaml: 'yaml', yml: 'yaml',
    xml: 'xml', md: 'markdown', vue: 'html', toml: 'ini', conf: 'ini',
    kt: 'kotlin', swift: 'swift', c: 'c', cpp: 'cpp', h: 'c',
  }
  return map[ext] ?? 'plaintext'
}

// ── Monaco 编辑器生命周期 ──────────────────────────────────────────
function initDiffEditor() {
  if (!diffContainer.value) return

  const filePath = props.fileDiff?.path ?? ''
  const language = getLanguageFromPath(filePath)
  const themeId = registerMonacoTheme()

  // 复用已有编辑器实例，只切换 model
  if (diffEditor) {
    const oldModel = diffEditor.getModel()
    const originalModel = monaco.editor.createModel(props.oldContent ?? '', language)
    const modifiedModel = monaco.editor.createModel(props.newContent ?? '', language)
    diffEditor.setModel({ original: originalModel, modified: modifiedModel })
    diffEditor.updateOptions({ renderSideBySide: true })
    // 销毁旧 model
    oldModel?.original.dispose()
    oldModel?.modified.dispose()
    return
  }

  diffEditor = monaco.editor.createDiffEditor(diffContainer.value, {
    theme: themeId,
    fontSize: settingsStore.settings.editorFontSize,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
    automaticLayout: true,
    readOnly: true,
    renderSideBySide: sideBySide.value,
    scrollBeyondLastLine: false,
    minimap: { enabled: false },
    padding: { top: 8, bottom: 8 },
  })

  const originalModel = monaco.editor.createModel(props.oldContent ?? '', language)
  const modifiedModel = monaco.editor.createModel(props.newContent ?? '', language)

  diffEditor.setModel({ original: originalModel, modified: modifiedModel })
}

function disposeDiffEditor() {
  if (diffEditor) {
    const model = diffEditor.getModel()
    model?.original.dispose()
    model?.modified.dispose()
    diffEditor.dispose()
    diffEditor = null
  }
}

// 当内容变化时更新 Monaco
watch(
  () => [props.oldContent, props.newContent],
  () => {
    if (!useMonaco.value || !diffEditor) return
    const model = diffEditor.getModel()
    if (model) {
      model.original.setValue(props.oldContent ?? '')
      model.modified.setValue(props.newContent ?? '')
    }
  },
)

// 当文件切换时重建 Monaco（语言可能变化），防抖避免快速切换时频繁创建/销毁
let reinitTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => props.fileDiff?.path,
  async () => {
    if (!useMonaco.value) return
    if (reinitTimer) clearTimeout(reinitTimer)
    reinitTimer = setTimeout(async () => {
      await nextTick()
      initDiffEditor()
    }, 150)
  },
)

// 切换 Monaco/文本 模式
watch(useMonaco, async (val) => {
  if (val) {
    await nextTick()
    initDiffEditor()
  }
  // 关闭 Monaco 模式时不销毁，下次打开直接复用
})

// 切换 side-by-side
watch(sideBySide, (val) => {
  if (diffEditor) {
    diffEditor.updateOptions({ renderSideBySide: val })
  }
})

// 主题变化
watch(
  () => activeTheme.value.id,
  () => {
    if (diffEditor) {
      const themeId = registerMonacoTheme()
      monaco.editor.setTheme(themeId)
    }
  },
)

// 编辑器设置变化
watch(
  () => settingsStore.settings.editorFontSize,
  (fontSize) => {
    diffEditor?.updateOptions({ fontSize })
  },
)

onBeforeUnmount(() => {
  if (reinitTimer) clearTimeout(reinitTimer)
  disposeDiffEditor()
})

// ── 工具函数 ──────────────────────────────────────────────────────

const hasMonacoContent = computed(() => props.oldContent !== undefined || props.newContent !== undefined)
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 文件头 -->
    <div v-if="fileDiff" class="flex items-center gap-2 px-3 py-1 border-b border-border bg-muted/30">
      <component :is="statusIcon(fileDiff.status)" class="h-3.5 w-3.5" :class="statusColor(fileDiff.status)" />
      <span class="text-xs font-mono truncate">{{ fileDiff.path }}</span>
      <span v-if="fileDiff.oldPath" class="text-xs text-muted-foreground">
        &larr; {{ fileDiff.oldPath }}
      </span>
      <div class="flex-1" />
      <span class="text-xs text-df-success">+{{ fileDiff?.stats?.insertions ?? diff?.stats.insertions ?? 0 }}</span>
      <span class="text-xs text-destructive">-{{ fileDiff?.stats?.deletions ?? diff?.stats.deletions ?? 0 }}</span>

      <!-- 模式切换 -->
      <div class="flex items-center gap-0.5 ml-2">
        <Button
          v-if="hasMonacoContent"
          variant="ghost" size="icon" class="h-6 w-6"
          :class="{ 'bg-accent': useMonaco }"
          @click="useMonaco = !useMonaco"
          :title="useMonaco ? t('git.textDiff') : t('git.monacoDiff')"
          :aria-label="useMonaco ? t('git.textDiff') : t('git.monacoDiff')"
        >
          <Columns2 class="h-3 w-3" />
        </Button>
        <Button
          v-if="useMonaco"
          variant="ghost" size="icon" class="h-6 w-6"
          :class="{ 'bg-accent': !sideBySide }"
          @click="sideBySide = !sideBySide"
          :title="sideBySide ? t('git.inlineMode') : t('git.sideBySideMode')"
          :aria-label="sideBySide ? t('git.inlineMode') : t('git.sideBySideMode')"
        >
          <AlignJustify class="h-3 w-3" />
        </Button>
      </div>
    </div>

    <!-- Monaco Diff 编辑器 -->
    <div v-if="useMonaco && fileDiff" class="flex-1 min-h-0">
      <div ref="diffContainer" class="h-full w-full" />
    </div>

    <!-- 纯文本 Diff -->
    <ScrollArea v-else class="flex-1">
      <div v-if="fileDiff && !fileDiff.isBinary" class="font-mono text-xs">
        <div v-for="(hunk, hi) in fileDiff.hunks" :key="hi">
          <div class="px-3 py-0.5 bg-df-info/10 text-df-info sticky top-0 z-10">
            {{ hunk.header }}
          </div>
          <div
            v-for="(line, li) in hunk.lines"
            :key="`${hi}-${li}`"
            class="flex hover:bg-accent/30"
            :class="{
              'bg-df-success/10': line.origin === '+',
              'bg-destructive/10': line.origin === '-',
            }"
          >
            <span class="w-12 shrink-0 text-right pr-2 text-muted-foreground/60 select-none border-r border-border/30">
              {{ line.oldLineno ?? '' }}
            </span>
            <span class="w-12 shrink-0 text-right pr-2 text-muted-foreground/60 select-none border-r border-border/30">
              {{ line.newLineno ?? '' }}
            </span>
            <span
              class="w-5 shrink-0 text-center select-none"
              :class="{
                'text-df-success': line.origin === '+',
                'text-destructive': line.origin === '-',
              }"
            >
              {{ line.origin === ' ' ? '' : line.origin }}
            </span>
            <pre class="flex-1 whitespace-pre-wrap break-all px-1">{{ line.content }}</pre>
          </div>
        </div>
      </div>
      <div v-else-if="fileDiff?.isBinary" class="flex items-center justify-center h-full text-xs text-muted-foreground">
        {{ t('git.binaryFile') }}
      </div>
      <div v-else class="flex items-center justify-center h-full text-xs text-muted-foreground py-8">
        {{ t('git.selectFileToView') }}
      </div>
    </ScrollArea>
  </div>
</template>
