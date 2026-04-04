<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Search } from 'lucide-vue-next'
import KeyTreeItem from './KeyTreeItem.vue'
import type { TreeNode } from './KeyTreeItem.vue'
import { redisScanKeys, redisGetKeyInfo, redisDeleteKeys } from '@/api/redis'
import { useToast } from '@/composables/useToast'
import type { RedisKeyInfo } from '@/types/redis'

const props = defineProps<{
  connectionId: string
  refreshTrigger: number
  selectedKey: string | null
}>()

const emit = defineEmits<{
  select: [key: string, info: RedisKeyInfo]
  delete: []
}>()

const { t } = useI18n()
const toast = useToast()

const pattern = ref('*')
const loading = ref(false)
const keys = ref<string[]>([])
const cursor = ref(0)
const hasMore = ref(false)
const treeData = ref<TreeNode[]>([])

/** SCAN 加载键 */
async function loadKeys(reset = true) {
  loading.value = true
  try {
    if (reset) {
      keys.value = []
      cursor.value = 0
    }
    const result = await redisScanKeys({
      connectionId: props.connectionId,
      cursor: cursor.value,
      pattern: pattern.value || '*',
      count: 500,
    })
    if (reset) {
      keys.value = result.keys
    } else {
      keys.value = [...keys.value, ...result.keys]
    }
    cursor.value = result.cursor
    hasMore.value = result.cursor !== 0
    buildTree()
  } catch (e) {
    toast.error('加载键列表失败', (e as any)?.message ?? String(e))
  } finally {
    loading.value = false
  }
}

/** 加载更多 */
async function loadMore() {
  if (!hasMore.value || loading.value) return
  await loadKeys(false)
}

/** 构建前缀树 */
function buildTree() {
  const separator = ':'
  const root: TreeNode[] = []
  const sorted = [...keys.value].sort()

  for (const key of sorted) {
    const parts = key.split(separator)
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const isLast = i === parts.length - 1
      const fullKey = parts.slice(0, i + 1).join(separator)

      let node = current.find(n => n.name === part && n.isLeaf === isLast)
      if (!node) {
        node = {
          name: part,
          fullKey: isLast ? key : fullKey,
          isLeaf: isLast,
          children: [],
          expanded: false,
        }
        current.push(node)
      }
      current = node.children
    }
  }

  // 折叠单链路径
  function collapse(nodes: TreeNode[]): TreeNode[] {
    return nodes.map(node => {
      if (!node.isLeaf && node.children.length === 1 && !node.children[0]!.isLeaf) {
        const child = node.children[0]!
        return {
          ...node,
          name: `${node.name}${separator}${child.name}`,
          fullKey: child.fullKey,
          children: collapse(child.children),
        }
      }
      if (!node.isLeaf) {
        node.children = collapse(node.children)
      }
      return node
    })
  }

  treeData.value = collapse(root)
}

/** 选中键 */
async function handleSelect(node: TreeNode) {
  if (!node.isLeaf) {
    node.expanded = !node.expanded
    return
  }
  try {
    const info = await redisGetKeyInfo(props.connectionId, node.fullKey)
    node.keyType = info.keyType
    emit('select', node.fullKey, info)
  } catch (e) {
    toast.error('获取键信息失败', (e as any)?.message ?? String(e))
  }
}

/** 删除键 */
async function handleDeleteKey(key: string, event: Event) {
  event.stopPropagation()
  try {
    await redisDeleteKeys(props.connectionId, [key])
    toast.success('键已删除')
    emit('delete')
  } catch (e) {
    toast.error('删除失败', (e as any)?.message ?? String(e))
  }
}

watch(() => props.refreshTrigger, () => {
  loadKeys(true)
})

onMounted(() => {
  loadKeys(true)
})
</script>

<template>
  <div class="flex h-full flex-col border-r border-border/40">
    <!-- 搜索栏 -->
    <div class="px-3 py-2 border-b border-border/30">
      <div class="relative">
        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
        <Input
          v-model="pattern"
          :placeholder="t('redis.searchPlaceholder')"
          class="h-8 pl-8 text-[11px] font-medium"
          @keydown.enter="loadKeys(true)"
        />
      </div>
    </div>

    <!-- 键列表 -->
    <ScrollArea class="flex-1">
      <div class="py-1">
        <KeyTreeItem
          v-for="node in treeData"
          :key="node.fullKey"
          :node="node"
          :depth="0"
          :selected-key="selectedKey"
          @select="handleSelect"
          @delete="handleDeleteKey"
        />

        <!-- 加载更多 -->
        <div v-if="hasMore" class="px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            class="w-full h-7 text-[10px] text-muted-foreground"
            :disabled="loading"
            @click="loadMore"
          >
            {{ loading ? t('redis.loading') : t('redis.loadMore') }}
          </Button>
        </div>

        <!-- 空状态 -->
        <div v-if="!loading && keys.length === 0" class="px-3 py-8 text-center">
          <p class="text-xs text-muted-foreground/40">{{ t('redis.noKeys') }}</p>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
