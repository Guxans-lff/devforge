<script setup lang="ts">
import { Trash2, ChevronRight, ChevronDown, Key, Hash, List, Layers, SortAsc, HelpCircle, Square, CheckSquare2 } from 'lucide-vue-next'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

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
  batchMode?: boolean
  selectedKeys?: Set<string>
}>()

const emit = defineEmits<{
  select: [node: TreeNode]
  delete: [key: string, event: Event]
  toggleCheck: [key: string]
  contextAction: [action: string, key: string]
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
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <div
          class="flex items-center gap-1.5 px-2 py-1 cursor-pointer text-[11px] font-medium group hover:bg-muted/50 transition-colors"
          :class="node.isLeaf && node.fullKey === selectedKey ? 'bg-primary/10 text-primary' : 'text-foreground/80'"
          :style="{ paddingLeft: `${8 + depth * 16}px` }"
          @click="batchMode && node.isLeaf ? emit('toggleCheck', node.fullKey) : emit('select', node)"
        >
          <!-- 批量模式 Checkbox -->
          <template v-if="batchMode && node.isLeaf">
            <CheckSquare2 v-if="selectedKeys?.has(node.fullKey)" class="h-3.5 w-3.5 shrink-0 text-primary" />
            <Square v-else class="h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />
          </template>

          <!-- 展开/折叠图标 -->
          <template v-else-if="!node.isLeaf">
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

          <!-- 删除按钮（非批量模式） -->
          <Trash2
            v-if="node.isLeaf && !batchMode"
            class="h-3 w-3 shrink-0 text-muted-foreground/20 opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
            @click.stop="emit('delete', node.fullKey, $event)"
          />
        </div>
      </ContextMenuTrigger>

      <!-- 右键菜单（仅叶子节点且非批量模式） -->
      <ContextMenuContent v-if="node.isLeaf && !batchMode" class="w-48">
        <ContextMenuItem @select="emit('contextAction', 'copy', node.fullKey)">
          {{ $t('redis.contextMenu.copyKey') }}
        </ContextMenuItem>
        <ContextMenuItem @select="emit('contextAction', 'rename', node.fullKey)">
          {{ $t('redis.contextMenu.rename') }}
        </ContextMenuItem>
        <ContextMenuItem @select="emit('contextAction', 'setTtl', node.fullKey)">
          {{ $t('redis.contextMenu.setTtl') }}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem class="text-destructive" @select="emit('contextAction', 'delete', node.fullKey)">
          {{ $t('redis.contextMenu.delete') }}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

    <!-- 子节点递归 -->
    <template v-if="!node.isLeaf && node.expanded">
      <KeyTreeItem
        v-for="child in node.children"
        :key="child.fullKey"
        :node="child"
        :depth="depth + 1"
        :selected-key="selectedKey"
        :batch-mode="batchMode"
        :selected-keys="selectedKeys"
        @select="emit('select', $event)"
        @delete="(key, e) => emit('delete', key, e)"
        @toggle-check="emit('toggleCheck', $event)"
        @context-action="(action, key) => emit('contextAction', action, key)"
      />
    </template>
  </div>
</template>
