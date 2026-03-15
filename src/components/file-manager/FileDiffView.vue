<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as monaco from 'monaco-editor'
import { useTheme } from '@/composables/useTheme'
import { useSettingsStore } from '@/stores/settings'
import { sftpReadFileContent, localReadFileContent } from '@/api/file-editor'
import { useToast } from '@/composables/useToast'
import { Button } from '@/components/ui/button'
import { Loader2, X, ArrowLeftRight } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  connectionId: string
  localPath: string
  remotePath: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const { activeTheme } = useTheme()
const settingsStore = useSettingsStore()
const toast = useToast()

const diffContainer = ref<HTMLDivElement>()
let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null

const loading = ref(false)
const localContent = ref('')
const remoteContent = ref('')
const diffStats = ref({ added: 0, removed: 0 })

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
    js: 'javascript', ts: 'typescript', json: 'json', html: 'html',
    css: 'css', py: 'python', java: 'java', rs: 'rust', go: 'go',
    sh: 'shell', sql: 'sql', yaml: 'yaml', yml: 'yaml', xml: 'xml',
    md: 'markdown', vue: 'html', toml: 'ini', conf: 'ini',
  }
  return map[ext] ?? 'plaintext'
}

function computeDiffStats(original: string, modified: string) {
  const origLines = original.split('\n')
  const modLines = modified.split('\n')
  // 简单统计：基于行数差异
  const origSet = new Set(origLines)
  const modSet = new Set(modLines)
  let added = 0
  let removed = 0
  for (const line of modLines) {
    if (!origSet.has(line)) added++
  }
  for (const line of origLines) {
    if (!modSet.has(line)) removed++
  }
  diffStats.value = { added, removed }
}

function initDiffEditor() {
  if (!diffContainer.value || diffEditor) return

  const language = getLanguageFromPath(props.remotePath)

  diffEditor = monaco.editor.createDiffEditor(diffContainer.value, {
    theme: registerMonacoTheme(),
    fontSize: settingsStore.settings.editorFontSize,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
    automaticLayout: true,
    readOnly: true,
    renderSideBySide: true,
    scrollBeyondLastLine: false,
    minimap: { enabled: false },
    padding: { top: 8, bottom: 8 },
  })

  const originalModel = monaco.editor.createModel(localContent.value, language)
  const modifiedModel = monaco.editor.createModel(remoteContent.value, language)

  diffEditor.setModel({
    original: originalModel,
    modified: modifiedModel,
  })
}

async function loadContents() {
  loading.value = true
  try {
    const [local, remote] = await Promise.all([
      localReadFileContent(props.localPath),
      sftpReadFileContent(props.connectionId, props.remotePath),
    ])
    localContent.value = local
    remoteContent.value = remote
    computeDiffStats(local, remote)

    await nextTick()
    if (!diffEditor) {
      initDiffEditor()
    } else {
      const model = diffEditor.getModel()
      if (model) {
        model.original.setValue(local)
        model.modified.setValue(remote)
      }
    }
  } catch (e) {
    toast.error(t('toast.operationFailed'), String(e))
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await nextTick()
      await loadContents()
    }
  },
)

watch(
  () => activeTheme.value.id,
  () => {
    if (diffEditor) {
      const themeId = registerMonacoTheme()
      monaco.editor.setTheme(themeId)
    }
  },
)

// 监听编辑器设置变化，实时同步到 diff 编辑器
watch(
  () => settingsStore.settings,
  (s) => {
    if (!diffEditor) return
    diffEditor.updateOptions({
      fontSize: s.editorFontSize,
    })
  },
  { deep: true },
)

onMounted(async () => {
  if (props.open) {
    await nextTick()
    await loadContents()
  }
})

onBeforeUnmount(() => {
  const model = diffEditor?.getModel()
  model?.original.dispose()
  model?.modified.dispose()
  diffEditor?.dispose()
  diffEditor = null
})
</script>

<template>
  <div v-if="open" class="flex h-full flex-col">
    <!-- 头部 -->
    <div class="flex items-center gap-2 border-b border-border px-3 py-1.5">
      <ArrowLeftRight class="h-3.5 w-3.5 text-muted-foreground" />
      <span class="text-xs font-medium">{{ t('fileEditor.diffTitle') }}</span>
      <span class="flex-1" />
      <div v-if="!loading" class="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span class="text-green-500">+{{ diffStats.added }}</span>
        <span class="text-red-500">-{{ diffStats.removed }}</span>
      </div>
      <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="emit('update:open', false)">
        <X class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- 文件路径标签 -->
    <div class="flex border-b border-border text-[10px] text-muted-foreground">
      <div class="flex-1 truncate border-r border-border px-2 py-1">
        {{ t('fileEditor.diffLocal') }}: {{ localPath }}
      </div>
      <div class="flex-1 truncate px-2 py-1">
        {{ t('fileEditor.diffRemote') }}: {{ remotePath }}
      </div>
    </div>

    <!-- Diff 编辑器 -->
    <div class="relative min-h-0 flex-1">
      <div v-if="loading" class="flex h-full items-center justify-center">
        <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
      <div v-show="!loading" ref="diffContainer" class="h-full w-full select-text" />
    </div>
  </div>
</template>
