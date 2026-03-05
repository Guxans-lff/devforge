<script setup lang="ts">
import { ref, onMounted, defineAsyncComponent } from 'vue'
import type { SchemaCache } from '@/types/database'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    language?: string
    readOnly?: boolean
    schema?: SchemaCache | null
    driver?: string
  }>(),
  {
    modelValue: '',
    language: 'sql',
    readOnly: false,
    schema: null,
    driver: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  execute: [sql: string]
  executeSelected: [sql: string]
}>()

// 延迟加载 Monaco Editor
const isLoaded = ref(false)
const SqlEditor = defineAsyncComponent(() => import('./SqlEditor.vue'))
const editorRef = ref<InstanceType<typeof SqlEditor>>()

onMounted(() => {
  // 延迟 100ms 加载编辑器，避免阻塞初始渲染
  setTimeout(() => {
    isLoaded.value = true
  }, 100)
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

// 透传 SqlEditor 暴露的方法
function getSelectedText(): string {
  return (editorRef.value as any)?.getSelectedText() ?? ''
}

function focus() {
  (editorRef.value as any)?.focus()
}

function insertText(text: string) {
  (editorRef.value as any)?.insertText(text)
}

function formatDocument() {
  (editorRef.value as any)?.formatDocument()
}

defineExpose({ getSelectedText, focus, insertText, formatDocument })
</script>

<template>
  <div class="h-full w-full">
    <!-- 加载占位符 -->
    <div
      v-if="!isLoaded"
      class="flex h-full w-full items-center justify-center bg-muted/30"
    >
      <div class="flex flex-col items-center gap-2">
        <div class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p class="text-sm text-muted-foreground">加载编辑器...</p>
      </div>
    </div>

    <!-- 实际编辑器 -->
    <SqlEditor
      v-if="isLoaded"
      ref="editorRef"
      :model-value="modelValue"
      :language="language"
      :read-only="readOnly"
      :schema="schema"
      :driver="driver"
      @update:model-value="handleUpdate"
      @execute="handleExecute"
      @execute-selected="handleExecuteSelected"
    />
  </div>
</template>
