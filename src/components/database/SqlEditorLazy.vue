<script setup lang="ts">
import { ref, onMounted, defineAsyncComponent } from 'vue'
import type { SchemaCache } from '@/types/database'
import type { SqlEditorExposed } from '@/types/component-exposed'

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

const emit = defineEmits<{
  'update:modelValue': [value: string]
  execute: [sql: string]
  executeSelected: [sql: string]
  executeAll: [sql: string]
  save: []
}>()

// 延迟加载 Monaco Editor
const isLoaded = ref(false)
const SqlEditor = defineAsyncComponent(() => import('./SqlEditor.vue'))
const editorRef = ref<InstanceType<typeof SqlEditor>>()

onMounted(() => {
  isLoaded.value = true
})

function handleUpdate(value: string) {
  emit('update:modelValue', value)
}

function handleExecute(sql: string) {
  emit('execute', sql)
}

function handleExecuteSelected(sql: string) {
  emit('executeSelected', sql)
}

/** 透传执行全部语句事件 */
function handleExecuteAll(sql: string) {
  emit('executeAll', sql)
}

/** 透传保存 SQL 片段事件 */
function handleSave() {
  emit('save')
}

/** 获取内部编辑器的类型安全引用 */
function getInner(): SqlEditorExposed | undefined {
  return editorRef.value as unknown as SqlEditorExposed | undefined
}

// 透传 SqlEditor 暴露的方法
function getSelectedText(): string {
  return getInner()?.getSelectedText() ?? ''
}

function focus() {
  getInner()?.focus()
}

function insertText(text: string) {
  getInner()?.insertText(text)
}

function formatDocument() {
  getInner()?.formatDocument()
}

defineExpose({ getSelectedText, focus, insertText, formatDocument })
</script>

<template>
  <div class="h-full w-full">
    <!-- 实际编辑器 -->
    <SqlEditor
      v-if="isLoaded"
      ref="editorRef"
      :model-value="modelValue"
      :language="language"
      :read-only="readOnly"
      :schema="schema"
      :is-loading-schema="isLoadingSchema"
      :driver="driver"
      @update:model-value="handleUpdate"
      @execute="handleExecute"
      @execute-selected="handleExecuteSelected"
      @execute-all="handleExecuteAll"
      @save="handleSave"
    />

    <!-- 加载占位符 -->
    <div
      v-else
      class="flex h-full w-full items-center justify-center bg-muted/30"
    >
      <div class="flex flex-col items-center gap-2">
        <div class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p class="text-sm text-muted-foreground">加载编辑器...</p>
      </div>
    </div>
  </div>
</template>
