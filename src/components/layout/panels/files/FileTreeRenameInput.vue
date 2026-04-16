<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import type { FileNode } from '@/types/workspace-files'

const props = defineProps<{ node: FileNode }>()
const store = useWorkspaceFilesStore()
const inputRef = ref<HTMLInputElement>()
const inputValue = ref(props.node.name)

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
  const dotIndex = inputValue.value.lastIndexOf('.')
  if (dotIndex > 0 && !props.node.isDirectory) {
    inputRef.value?.setSelectionRange(0, dotIndex)
  } else {
    inputRef.value?.select()
  }
})

function confirm() {
  const newName = inputValue.value.trim()
  if (newName && newName !== props.node.name) {
    store.renameEntry(props.node.absolutePath, newName)
  } else {
    store.renamingNodeId = null
  }
}

function cancel() {
  store.renamingNodeId = null
}
</script>

<template>
  <input
    ref="inputRef"
    v-model="inputValue"
    class="h-5 w-full rounded border border-primary/50 bg-background px-1 text-xs outline-none"
    @keydown.enter="confirm"
    @keydown.escape="cancel"
    @blur="confirm"
  />
</template>
