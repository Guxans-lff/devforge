<script setup lang="ts">
import { Trash2, ChevronRight, ChevronDown, Key, Hash, List, Layers, SortAsc, HelpCircle } from 'lucide-vue-next'

export interface TreeNode {
  name: string
  fullKey: string
  isLeaf: boolean
  children: TreeNode[]
  expanded: boolean
  keyType?: string
}

const props = defineProps<{
  node: TreeNode
  depth: number
  selectedKey: string | null
}>()

const emit = defineEmits<{
  select: [node: TreeNode]
  delete: [key: string, event: Event]
}>()

/** 类型图标映射 */
const typeIcons: Record<string, typeof Key> = {
  string: Key,
  hash: Hash,
  list: List,
  set: Layers,
  zset: SortAsc,
}

/** 计算叶子节点数 */
function countLeaves(node: TreeNode): number {
  if (node.isLeaf) return 1
  return node.children.reduce((sum, child) => sum + countLeaves(child), 0)
}
</script>

<template>
  <div>
    <div
      class="flex items-center gap-1.5 px-2 py-1 cursor-pointer text-[11px] font-medium group hover:bg-muted/50 transition-colors"
      :class="node.isLeaf && node.fullKey === selectedKey ? 'bg-primary/10 text-primary' : 'text-foreground/80'"
      :style="{ paddingLeft: `${8 + depth * 16}px` }"
      @click="emit('select', node)"
    >
      <!-- 展开/折叠图标 -->
      <template v-if="!node.isLeaf">
        <ChevronDown v-if="node.expanded" class="h-3 w-3 shrink-0 text-muted-foreground/40" />
        <ChevronRight v-else class="h-3 w-3 shrink-0 text-muted-foreground/40" />
      </template>
      <div v-else class="w-3" />

      <!-- 类型图标 -->
      <component
        v-if="node.isLeaf"
        :is="typeIcons[node.keyType || ''] || HelpCircle"
        class="h-3 w-3 shrink-0 text-muted-foreground/50"
      />

      <!-- 名称 -->
      <span class="truncate flex-1">{{ node.name }}</span>

      <!-- 非叶子数量 -->
      <span v-if="!node.isLeaf" class="text-[9px] text-muted-foreground/30 font-mono">
        {{ countLeaves(node) }}
      </span>

      <!-- 删除按钮 -->
      <Trash2
        v-if="node.isLeaf"
        class="h-3 w-3 shrink-0 text-muted-foreground/20 opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
        @click.stop="emit('delete', node.fullKey, $event)"
      />
    </div>

    <!-- 子节点递归 -->
    <template v-if="!node.isLeaf && node.expanded">
      <KeyTreeItem
        v-for="child in node.children"
        :key="child.fullKey"
        :node="child"
        :depth="depth + 1"
        :selected-key="selectedKey"
        @select="emit('select', $event)"
        @delete="(key, e) => emit('delete', key, e)"
      />
    </template>
  </div>
</template>
