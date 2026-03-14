<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, toRef } from 'vue'
import * as monaco from 'monaco-editor'
import { useTheme } from '@/composables/useTheme'
import { useSettingsStore } from '@/stores/settings'
import { useSqlFormatter } from '@/composables/useSqlFormatter'
import type { SchemaCache } from '@/types/database'
import { useSqlCompletion } from '@/composables/useSqlCompletion'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    language?: string
    readOnly?: boolean
    schema?: SchemaCache | null
    isLoadingSchema?: boolean
    driver?: string
  }>(),
  {
    modelValue: '',
    language: 'sql',
    readOnly: false,
    schema: null,
    isLoadingSchema: false,
    driver: undefined,
  },
)

// 注册 SQL 智能补全（传入 Schema 缓存、驱动类型和加载状态）
useSqlCompletion(toRef(props, 'schema'), toRef(props, 'driver'), toRef(props, 'isLoadingSchema'))

const emit = defineEmits<{
  'update:modelValue': [value: string]
  execute: [sql: string]
  executeSelected: [sql: string]
  executeAll: [sql: string]
  save: []
}>()

const editorContainer = ref<HTMLDivElement>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null
const { activeTheme, activeThemeId } = useTheme()
const settingsStore = useSettingsStore()
const { formatSqlText } = useSqlFormatter()

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

onMounted(async () => {
  await nextTick()
  if (!editorContainer.value) return

  editor = monaco.editor.create(editorContainer.value, {
    value: props.modelValue,
    language: props.language,
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
    suggest: {
      showKeywords: true,
      showSnippets: true,
    },
    readOnly: props.readOnly,
  })

  editor.onDidChangeModelContent(() => {
    const value = editor?.getValue() ?? ''
    emit('update:modelValue', value)
  })

  // Ctrl+Enter / F5 -> execute all SQL
  editor.addAction({
    id: 'execute-sql',
    label: 'Execute SQL',
    keybindings: [
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      monaco.KeyCode.F5,
    ],
    run: (ed) => {
      const selection = ed.getSelection()
      const model = ed.getModel()
      if (selection && model && !selection.isEmpty()) {
        const selectedText = model.getValueInRange(selection)
        emit('executeSelected', selectedText)
      } else {
        emit('execute', ed.getValue())
      }
    },
  })

  // Shift+Alt+F -> 格式化 SQL（支持选中部分）
  editor.addAction({
    id: 'format-sql',
    label: 'Format SQL',
    keybindings: [
      monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
    ],
    run: (ed) => {
      formatDocumentOrSelection(ed)
    },
  })

  // Ctrl+Shift+F -> 格式化 SQL（支持选中部分）
  editor.addAction({
    id: 'format-sql-selection',
    label: 'Format SQL (Selection)',
    keybindings: [
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
    ],
    run: (ed) => {
      formatDocumentOrSelection(ed)
    },
  })

  // Ctrl+Shift+Enter -> 执行全部语句（忽略选中，强制执行全部）
  editor.addAction({
    id: 'execute-all-sql',
    label: 'Execute All SQL',
    keybindings: [
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
    ],
    run: (ed) => {
      emit('executeAll', ed.getValue())
    },
  })

  // Ctrl+S -> 保存 SQL 片段
  editor.addAction({
    id: 'save-sql-snippet',
    label: 'Save SQL Snippet',
    keybindings: [
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
    ],
    run: () => {
      emit('save')
    },
  })
})

watch(activeThemeId, () => {
  if (editor) {
    const themeId = registerMonacoTheme()
    monaco.editor.setTheme(themeId)
  }
})

watch(
  () => props.modelValue,
  (newVal) => {
    if (editor && editor.getValue() !== newVal) {
      editor.setValue(newVal)
    }
  },
)

// React to user settings changes
watch(
  () => settingsStore.settings,
  (s) => {
    if (!editor) return
    editor.updateOptions({
      fontSize: s.editorFontSize,
      tabSize: s.editorTabSize,
      wordWrap: s.editorWordWrap ? 'on' : 'off',
      minimap: { enabled: s.editorMinimap },
    })
  },
  { deep: true },
)

onBeforeUnmount(() => {
  editor?.dispose()
  editor = null
})

function getSelectedText(): string {
  if (!editor) return ''
  const selection = editor.getSelection()
  const model = editor.getModel()
  if (selection && model && !selection.isEmpty()) {
    return model.getValueInRange(selection)
  }
  return ''
}

function focus() {
  editor?.focus()
}

function insertText(text: string) {
  if (!editor) return
  const position = editor.getPosition()
  if (position) {
    editor.executeEdits('insert', [
      {
        range: new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column,
        ),
        text,
      },
    ])
  }
}

/** 格式化整个文档或选中部分 */
function formatDocumentOrSelection(ed?: monaco.editor.ICodeEditor) {
  const target = ed ?? editor
  if (!target) return
  const model = target.getModel()
  if (!model) return

  const language = props.driver === 'postgresql' ? 'postgresql' : 'mysql'
  const selection = target.getSelection()

  // 如果有选中文本，只格式化选中部分
  if (selection && !selection.isEmpty()) {
    const selectedText = model.getValueInRange(selection)
    const result = formatSqlText(selectedText, {
      language,
      tabWidth: settingsStore.settings.editorTabSize,
      keywordCase: 'upper',
    })
    if (result.success) {
      target.executeEdits('format', [{
        range: selection,
        text: result.formatted,
      }])
    }
    return
  }

  // 否则格式化整个文档
  const currentValue = model.getValue()
  const result = formatSqlText(currentValue, {
    language,
    tabWidth: settingsStore.settings.editorTabSize,
    keywordCase: 'upper',
  })
  if (result.success) {
    target.executeEdits('format', [{
      range: model.getFullModelRange(),
      text: result.formatted,
    }])
  }
}

/** 格式化文档（对外暴露的方法，兼容原有调用） */
function formatDocument() {
  formatDocumentOrSelection()
}

defineExpose({ getSelectedText, focus, insertText, formatDocument })
</script>

<template>
  <div ref="editorContainer" class="h-full w-full" />
</template>
