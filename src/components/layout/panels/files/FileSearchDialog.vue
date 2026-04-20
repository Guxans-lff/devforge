<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { fuzzyFilter } from '@/utils/fuzzyMatch'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import type { FileNode } from '@/types/workspace-files'
import { Search, File, Folder } from 'lucide-vue-next'

const emit = defineEmits<{ close: []; select: [node: FileNode] }>()
const store = useWorkspaceFilesStore()
const query = ref('')
const inputRef = ref<HTMLInputElement>()
const selectedIndex = ref(0)

/** 搜集所有已缓存节点 */
const allNodes = computed<FileNode[]>(() => {
  const nodes: FileNode[] = []
  for (const list of store.nodeCache.values()) {
    nodes.push(...list)
  }
  return nodes
})

const results = computed(() => {
  if (!query.value.trim()) return []
  return fuzzyFilter(allNodes.value, query.value, n => n.path, 50)
})

watch(query, () => { selectedIndex.value = 0 })

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  } else if (e.key === 'Enter' && results.value.length > 0) {
    e.preventDefault()
    const selected = results.value[selectedIndex.value]
    if (selected) emit('select', selected)
    emit('close')
  } else if (e.key === 'Escape') {
    emit('close')
  }
}

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" @click.self="emit('close')">
    <div class="w-[500px] max-w-[90vw] rounded-lg border bg-background shadow-xl">
      <div class="flex items-center gap-2 border-b px-3 py-2">
        <Search class="h-4 w-4 text-muted-foreground" />
        <input
          ref="inputRef"
          v-model="query"
          class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          placeholder="搜索文件名..."
          @keydown="handleKeyDown"
        />
      </div>
      <div class="max-h-[300px] overflow-auto">
        <div
          v-for="(node, i) in results"
          :key="node.id"
          class="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs"
          :class="{ 'bg-primary/10': i === selectedIndex }"
          @click="emit('select', node); emit('close')"
          @mouseenter="selectedIndex = i"
        >
          <component :is="node.isDirectory ? Folder : File" class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <span class="truncate">{{ node.path }}</span>
          <span class="text-[10px] text-muted-foreground/50 ml-auto flex-shrink-0">{{ node.rootId }}</span>
        </div>
        <div v-if="query && results.length === 0" class="px-3 py-4 text-center text-xs text-muted-foreground/50">
          无匹配结果
        </div>
      </div>
    </div>
  </div>
</template>
