<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as monaco from 'monaco-editor'
import { useTheme } from '@/composables/useTheme'
import { useSettingsStore } from '@/stores/settings'
import { useFileEditorStore } from '@/stores/file-editor'
import { useToast } from '@/composables/useToast'
import { Button } from '@/components/ui/button'
import {
  X,
  Save,
  Loader2,
  FileText,
} from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const { t } = useI18n()
const { activeTheme } = useTheme()
const settingsStore = useSettingsStore()
const fileEditorStore = useFileEditorStore()
const toast = useToast()

const editorContainer = ref<HTMLDivElement>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null

// 关闭确认对话框
const showCloseConfirm = ref(false)
const pendingCloseId = ref<string | null>(null)

const fileList = computed(() => fileEditorStore.fileList)
const activeFile = computed(() => fileEditorStore.activeFile)
const hasOpenFiles = computed(() => fileEditorStore.openFiles.size > 0)

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

function initEditor() {
  if (!editorContainer.value || editor) return

  editor = monaco.editor.create(editorContainer.value, {
    value: '',
    language: 'plaintext',
    theme: registerMonacoTheme(),
    minimap: { enabled: settingsStore.settings.editorMinimap },
    fontSize: settingsStore.settings.editorFontSize,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
    lineNumbers: 'on',
    tabSize: settingsStore.settings.editorTabSize,
    wordWrap: settingsStore.settings.editorWordWrap ? 'on' : 'off',
    automaticLayout: true,
    scrollBeyondLastLine: false,
    padding: { top: 8, bottom: 8 },
    renderLineHighlight: 'line',
    cursorBlinking: 'smooth',
    smoothScrolling: true,
    bracketPairColorization: { enabled: true },
  })

  editor.onDidChangeModelContent(() => {
    const file = fileEditorStore.activeFile
    if (file && editor) {
      fileEditorStore.updateContent(file.id, editor.getValue())
    }
  })

  // Ctrl+S 保存
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    handleSave()
  })
}

function syncEditorContent() {
  if (!editor || !activeFile.value) return
  const file = activeFile.value

  const model = editor.getModel()
  if (model) {
    const currentLang = model.getLanguageId()
    if (currentLang !== file.language) {
      monaco.editor.setModelLanguage(model, file.language)
    }
    if (model.getValue() !== file.content) {
      model.setValue(file.content)
    }
  }
}

// 监听活动文件切换
watch(
  () => fileEditorStore.activeFileId,
  async () => {
    await nextTick()
    if (!activeFile.value) return
    if (!editor) {
      initEditor()
    }
    syncEditorContent()
  },
)

// 监听文件加载完成
watch(
  () => activeFile.value?.isLoading,
  async (isLoading, wasLoading) => {
    if (wasLoading && !isLoading) {
      await nextTick()
      if (!editor) {
        initEditor()
      }
      syncEditorContent()
    }
  },
)

// 监听主题变化
watch(
  () => activeTheme.value.id,
  () => {
    if (editor) {
      const themeId = registerMonacoTheme()
      monaco.editor.setTheme(themeId)
    }
  },
)

// 监听编辑器设置变化，实时同步到已打开的编辑器实例
watch(
  () => [
    settingsStore.settings.editorFontSize,
    settingsStore.settings.editorTabSize,
    settingsStore.settings.editorWordWrap,
    settingsStore.settings.editorMinimap,
  ] as const,
  ([fontSize, tabSize, wordWrap, minimap]) => {
    if (!editor) return
    editor.updateOptions({
      fontSize,
      tabSize,
      wordWrap: wordWrap ? 'on' : 'off',
      minimap: { enabled: minimap },
    })
  },
)

async function handleSave() {
  const file = activeFile.value
  if (!file || !file.isDirty) return
  try {
    await fileEditorStore.saveFile(file.id)
    toast.success(t('toast.saveSuccess'))
  } catch (e) {
    toast.error(t('toast.saveFailed'), String(e))
  }
}

function handleCloseTab(id: string) {
  const file = fileEditorStore.openFiles.get(id)
  if (file?.isDirty) {
    pendingCloseId.value = id
    showCloseConfirm.value = true
  } else {
    fileEditorStore.closeFile(id)
  }
}

function forceClose() {
  if (pendingCloseId.value) {
    fileEditorStore.closeFile(pendingCloseId.value)
    pendingCloseId.value = null
  }
  showCloseConfirm.value = false
}

async function saveAndClose() {
  if (pendingCloseId.value) {
    try {
      await fileEditorStore.saveFile(pendingCloseId.value)
      fileEditorStore.closeFile(pendingCloseId.value)
    } catch (e) {
      toast.error(t('toast.saveFailed'), String(e))
    }
    pendingCloseId.value = null
  }
  showCloseConfirm.value = false
}

onMounted(async () => {
  await nextTick()
  if (activeFile.value && !activeFile.value.isLoading) {
    initEditor()
    syncEditorContent()
  }
})

onBeforeUnmount(() => {
  editor?.dispose()
  editor = null
})
</script>

<template>
  <div v-if="hasOpenFiles" class="flex h-full flex-col">
    <!-- 标签栏 -->
    <div class="flex items-center border-b border-border bg-muted/30">
      <div class="flex min-w-0 flex-1 items-center overflow-x-auto">
        <button
          v-for="file in fileList"
          :key="file.id"
          class="group flex shrink-0 items-center gap-1.5 border-r border-border px-3 py-1.5 text-xs transition-colors"
          :class="file.id === fileEditorStore.activeFileId
            ? 'bg-background text-foreground'
            : 'text-muted-foreground hover:bg-background/50'"
          @click="fileEditorStore.setActiveFile(file.id)"
        >
          <FileText class="h-3 w-3 shrink-0" />
          <span class="max-w-[120px] truncate">{{ file.fileName }}</span>
          <span v-if="file.isDirty" class="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--df-warning)]" />
          <Loader2 v-if="file.isSaving" class="h-3 w-3 shrink-0 animate-spin" />
          <span
            class="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
            @click.stop="handleCloseTab(file.id)"
          >
            <X class="h-3 w-3" />
          </span>
        </button>
      </div>
      <div class="flex shrink-0 items-center gap-1 px-2">
        <Button
          v-if="activeFile?.isDirty"
          variant="ghost"
          size="sm"
          class="h-6 gap-1 px-2 text-xs"
          @click="handleSave"
        >
          <Save class="h-3 w-3" />
          {{ t('common.save') }}
        </Button>
      </div>
    </div>

    <!-- 编辑器区域 -->
    <div class="relative min-h-0 flex-1">
      <div v-if="activeFile?.isLoading" class="flex h-full items-center justify-center">
        <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
      <div v-show="activeFile && !activeFile.isLoading" ref="editorContainer" class="h-full w-full select-text" />
    </div>

    <!-- 状态栏 -->
    <div v-if="activeFile" class="flex items-center justify-between border-t border-border px-3 py-0.5 text-[10px] text-muted-foreground">
      <span>{{ activeFile.remotePath }}</span>
      <span>{{ activeFile.language }}</span>
    </div>

    <!-- 关闭确认对话框 -->
    <Dialog v-model:open="showCloseConfirm">
      <DialogContent class="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>{{ t('fileEditor.unsavedChanges') }}</DialogTitle>
        </DialogHeader>
        <p class="text-sm text-muted-foreground">{{ t('fileEditor.unsavedChangesDesc') }}</p>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showCloseConfirm = false">
            {{ t('common.cancel') }}
          </Button>
          <Button variant="destructive" @click="forceClose">
            {{ t('fileEditor.discardClose') }}
          </Button>
          <Button @click="saveAndClose">
            {{ t('fileEditor.saveClose') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>

  <!-- 空状态 -->
  <div v-else class="flex h-full items-center justify-center text-xs text-muted-foreground">
    {{ t('fileEditor.noOpenFiles') }}
  </div>
</template>
