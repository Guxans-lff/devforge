<script setup lang="ts">
import type { WorkspaceRoot } from '@/types/workspace-files'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import {
  ChevronRight,
  FolderOpen,
  X,
  RefreshCw,
} from 'lucide-vue-next'

const props = defineProps<{
  root: WorkspaceRoot
}>()

const store = useWorkspaceFilesStore()

function toggleCollapse() {
  props.root.collapsed = !props.root.collapsed
}

function refresh() {
  store.refreshGitDecorations(props.root.path)
  for (const key of store.nodeCache.keys()) {
    if (key.startsWith(props.root.path)) {
      store.nodeCache.delete(key)
    }
  }
  store.nodeCache = new Map(store.nodeCache)
}
</script>

<template>
  <div
    class="flex h-8 items-center gap-1 px-2 text-xs font-bold uppercase tracking-wide text-muted-foreground/70 hover:bg-muted/30 cursor-pointer group"
    @click="toggleCollapse"
  >
    <ChevronRight
      class="h-3 w-3 transition-transform duration-150"
      :class="{ 'rotate-90': !root.collapsed }"
    />
    <FolderOpen class="h-3.5 w-3.5 text-blue-400" />
    <span class="flex-1 truncate">{{ root.name }}</span>
    <button
      class="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted/50"
      @click.stop="refresh"
      title="刷新"
    >
      <RefreshCw class="h-3 w-3" />
    </button>
    <button
      class="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted/50"
      @click.stop="store.removeRoot(root.id)"
      title="移除工作区"
    >
      <X class="h-3 w-3" />
    </button>
  </div>
</template>
