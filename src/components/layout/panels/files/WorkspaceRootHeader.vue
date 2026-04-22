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
  aiActive?: boolean
  editorActive?: boolean
  aiReferencedActive?: boolean
  taskReferencedActive?: boolean
  focusedActive?: boolean
}>()

const emit = defineEmits<{
  (e: 'contextmenu', ev: MouseEvent): void
}>()

const store = useWorkspaceFilesStore()

function toggleCollapse() {
  props.root.collapsed = !props.root.collapsed
  // 展开时如果缓存为空，重新加载
  if (!props.root.collapsed && !store.nodeCache.has(props.root.path)) {
    store.refreshRoot(props.root.id)
  }
}

function refresh() {
  store.refreshRoot(props.root.id)
}
</script>

<template>
  <div
    class="flex items-center gap-2 px-3 cursor-pointer group transition-all duration-150 mx-1 rounded-lg"
    :class="[
      focusedActive
        ? 'bg-orange-500/10 ring-1 ring-orange-500/22 hover:bg-orange-500/13'
        : taskReferencedActive
          ? 'bg-amber-500/7 ring-1 ring-amber-500/14 hover:bg-amber-500/10'
        : aiActive
          ? 'bg-primary/8 ring-1 ring-primary/15 hover:bg-primary/10'
        : editorActive
          ? 'bg-emerald-500/7 ring-1 ring-emerald-500/14 hover:bg-emerald-500/10'
        : aiReferencedActive
          ? 'bg-sky-500/6 ring-1 ring-sky-500/12 hover:bg-sky-500/9'
        : root.collapsed
          ? 'hover:bg-muted/30'
          : 'bg-muted/20 hover:bg-muted/30',
    ]"
    style="height: 36px;"
    @click="toggleCollapse"
    @contextmenu.prevent="emit('contextmenu', $event)"
  >
    <ChevronRight
      class="h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-150 flex-shrink-0"
      :class="!root.collapsed && 'rotate-90'"
    />
    <div
      class="w-4 h-4 rounded-[3px] flex items-center justify-center flex-shrink-0"
      style="background: linear-gradient(135deg, #6366f1, #8b5cf6);"
    >
      <FolderOpen class="w-2.5 h-2.5 text-white" />
    </div>
    <span class="flex-1 truncate text-[12px] font-semibold text-foreground/90 tracking-tight">
      {{ root.name }}
    </span>
    <span
      v-if="focusedActive"
      class="rounded-full border border-orange-500/20 bg-orange-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-orange-300"
    >
      当前
    </span>
    <span
      v-else-if="taskReferencedActive"
      class="rounded-full border border-amber-500/16 bg-amber-500/7 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-amber-400"
    >
      相关
    </span>
    <span
      v-else-if="aiActive"
      class="rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-primary"
    >
      当前
    </span>
    <span
      v-else-if="aiReferencedActive"
      class="rounded-full border border-sky-500/14 bg-sky-500/6 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-sky-400/90"
    >
      相关
    </span>
    <span
      v-else-if="editorActive"
      class="rounded-full border border-emerald-500/16 bg-emerald-500/7 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-emerald-400"
    >
      当前
    </span>
    <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        class="p-1 rounded-md hover:bg-muted/50 text-muted-foreground/60 hover:text-muted-foreground"
        title="刷新"
        @click.stop="refresh"
      >
        <RefreshCw class="h-3 w-3" />
      </button>
      <button
        class="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground/60 hover:text-destructive"
        title="移除"
        @click.stop="store.removeRoot(root.id)"
      >
        <X class="h-3 w-3" />
      </button>
    </div>
  </div>
</template>
