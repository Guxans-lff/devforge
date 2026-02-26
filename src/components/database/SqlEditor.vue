<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, toRef } from 'vue'
import * as monaco from 'monaco-editor'
import { useTheme } from '@/composables/useTheme'
import { useSettingsStore } from '@/stores/settings'
import type { SchemaCache } from '@/types/database'
import { useSqlCompletion } from '@/composables/useSqlCompletion'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    language?: string
    readOnly?: boolean
    schema?: SchemaCache | null
  }>(),
  {
    modelValue: '',
    language: 'sql',
    readOnly: false,
    schema: null,
  },
)

// Register SQL completion provider
useSqlCompletion(toRef(props, 'schema'))

const emit = defineEmits<{
  'update:modelValue': [value: string]
  execute: [sql: string]
  executeSelected: [sql: string]
}>()

const editorContainer = ref<HTMLDivElement>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null
const { activeTheme, activeThemeId } = useTheme()
const settingsStore = useSettingsStore()

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

defineExpose({ getSelectedText, focus, insertText })
</script>

<template>
  <div ref="editorContainer" class="h-full w-full" />
</template>
