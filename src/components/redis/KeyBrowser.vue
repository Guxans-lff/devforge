<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Search, CheckSquare, Trash2, Clock, Download, Upload, CheckCheck, XSquare, Database } from 'lucide-vue-next'
import KeyTreeItem from './KeyTreeItem.vue'
import type { TreeNode } from './KeyTreeItem.vue'
import { redisScanKeys, redisGetKeyInfo, redisDeleteKeys, redisRenameKey, redisSetTtl, redisBatchDelete, redisBatchSetTtl, redisBatchExport, redisBatchImport } from '@/api/redis'
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
    toast.error(t('redis.loadKeysFailed'), (e as any)?.message ?? String(e))
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
    toast.error(t('redis.getKeyInfoFailed'), (e as any)?.message ?? String(e))
  }
}

/** 删除键（本地移除，避免全量 SCAN 刷新） */
async function handleDeleteKey(key: string, event: Event) {
  event.stopPropagation()
  try {
    await redisDeleteKeys(props.connectionId, [key])
    toast.success(t('redis.keyDeleted'))
    keys.value = keys.value.filter(k => k !== key)
    buildTree()
    emit('delete')
  } catch (e) {
    toast.error(t('redis.deleteKeyFailed'), (e as any)?.message ?? String(e))
  }
}

// ========== 批量操作 ==========
const batchMode = ref(false)
const selectedKeys = ref<Set<string>>(new Set())
const showTtlDialog = ref(false)
const batchTtl = ref(3600)
const batchLoading = ref(false)

/** 所有叶子键 */
const allLeafKeys = computed(() => keys.value)

/** 选中数量 */
const selectedCount = computed(() => selectedKeys.value.size)

/** 切换批量模式 */
function toggleBatchMode() {
  batchMode.value = !batchMode.value
  if (!batchMode.value) {
    selectedKeys.value = new Set()
  }
}

/** 切换选中状态 */
function toggleKeySelection(key: string) {
  const next = new Set(selectedKeys.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  selectedKeys.value = next
}

/** 全选 */
function selectAll() {
  selectedKeys.value = new Set(allLeafKeys.value)
}

/** 取消全选 */
function deselectAll() {
  selectedKeys.value = new Set()
}

/** 批量删除（本地移除已删键，避免全量 SCAN 刷新） */
async function handleBatchDelete() {
  if (selectedCount.value === 0) return
  const count = selectedCount.value
  if (!confirm(t('redis.batch.deleteConfirm', { count }))) return
  batchLoading.value = true
  try {
    const deletedKeys = [...selectedKeys.value]
    await redisBatchDelete(props.connectionId, deletedKeys)
    toast.success(t('redis.batch.deleteSuccess', { count }))
    // 本地移除已删键，避免全量 SCAN
    const deletedSet = new Set(deletedKeys)
    keys.value = keys.value.filter(k => !deletedSet.has(k))
    buildTree()
    selectedKeys.value = new Set()
    emit('delete')
  } catch (e) {
    toast.error(t('redis.batch.deleteFailed'), (e as any)?.message ?? String(e))
  } finally {
    batchLoading.value = false
  }
}

/** 批量设置 TTL */
async function handleBatchSetTtl() {
  if (selectedCount.value === 0) return
  showTtlDialog.value = true
}

/** 确认设置 TTL */
async function confirmBatchSetTtl() {
  const count = selectedCount.value
  batchLoading.value = true
  try {
    await redisBatchSetTtl(props.connectionId, [...selectedKeys.value], batchTtl.value)
    toast.success(t('redis.batch.ttlSuccess', { count }))
    showTtlDialog.value = false
  } catch (e) {
    toast.error(t('redis.batch.ttlFailed'), (e as any)?.message ?? String(e))
  } finally {
    batchLoading.value = false
  }
}

/** 批量导出 JSON */
async function handleBatchExport() {
  if (selectedCount.value === 0) return
  batchLoading.value = true
  try {
    const items = await redisBatchExport(props.connectionId, [...selectedKeys.value])
    const data = {
      exportedAt: new Date().toISOString(),
      keys: items,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `redis-export-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('redis.batch.exportSuccess', { count: selectedCount.value }))
  } catch (e) {
    toast.error(t('redis.batch.exportFailed'), (e as any)?.message ?? String(e))
  } finally {
    batchLoading.value = false
  }
}

/** 批量导入 JSON */
async function handleBatchImport() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    // 文件大小限制 50MB
    if (file.size > 50 * 1024 * 1024) {
      toast.error(t('redis.batch.importFailed'), t('redis.batch.importTooLarge'))
      return
    }
    batchLoading.value = true
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const items = data.keys || data
      if (!Array.isArray(items) || items.length === 0) {
        toast.error(t('redis.batch.importFailed'), t('redis.batch.importInvalidFormat'))
        return
      }
      const count = await redisBatchImport(props.connectionId, items)
      toast.success(t('redis.batch.importSuccess', { count }))
      emit('delete') // 触发刷新
    } catch (e) {
      toast.error(t('redis.batch.importFailed'), (e as any)?.message ?? String(e))
    } finally {
      batchLoading.value = false
    }
  }
  input.click()
}

// ========== 右键菜单 ==========
const showRenameDialog = ref(false)
const showKeyTtlDialog = ref(false)
const contextKey = ref('')
const renameNewKey = ref('')
const keyTtlValue = ref(3600)

/** 处理右键菜单操作 */
async function handleContextAction(action: string, key: string) {
  contextKey.value = key
  switch (action) {
    case 'copy':
      await navigator.clipboard.writeText(key)
      toast.success(t('redis.contextMenu.copied'))
      break
    case 'rename':
      renameNewKey.value = key
      showRenameDialog.value = true
      break
    case 'setTtl':
      keyTtlValue.value = 3600
      showKeyTtlDialog.value = true
      break
    case 'delete':
      if (!confirm(t('redis.contextMenu.deleteConfirm', { key }))) return
      try {
        await redisDeleteKeys(props.connectionId, [key])
        toast.success(t('redis.keyDeleted'))
        keys.value = keys.value.filter(k => k !== key)
        buildTree()
        emit('delete')
      } catch (e) {
        toast.error(t('redis.deleteKeyFailed'), (e as any)?.message ?? String(e))
      }
      break
  }
}

/** 确认重命名 */
async function confirmRename() {
  if (!renameNewKey.value.trim() || renameNewKey.value === contextKey.value) {
    showRenameDialog.value = false
    return
  }
  try {
    await redisRenameKey(props.connectionId, contextKey.value, renameNewKey.value.trim())
    toast.success(t('redis.contextMenu.renameSuccess'))
    showRenameDialog.value = false
    emit('delete') // 触发刷新
  } catch (e) {
    toast.error(t('redis.contextMenu.renameFailed'), (e as any)?.message ?? String(e))
  }
}

/** 确认设置 TTL */
async function confirmKeyTtl() {
  try {
    await redisSetTtl(props.connectionId, contextKey.value, keyTtlValue.value)
    toast.success(t('redis.contextMenu.ttlSuccess'))
    showKeyTtlDialog.value = false
  } catch (e) {
    toast.error(t('redis.contextMenu.ttlFailed'), (e as any)?.message ?? String(e))
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
          class="h-8 pl-8 text-xs font-medium"
          @keydown.enter="loadKeys(true)"
        />
      </div>
    </div>

    <!-- 批量操作工具栏 -->
    <div class="flex items-center gap-1 px-2 py-1.5 border-b border-border/20 shrink-0">
      <Button variant="ghost" size="sm" class="h-7 px-2 text-xs" :class="batchMode && 'text-primary'" @click="toggleBatchMode">
        <CheckSquare class="h-3.5 w-3.5 mr-1" />
        {{ t('redis.batch.selectMode') }}
      </Button>
      <template v-if="batchMode">
        <div class="h-3.5 w-px bg-border/30" />
        <span class="text-[10px] text-muted-foreground/60">{{ t('redis.batch.selected', { count: selectedCount }) }}</span>
        <div class="flex-1" />
        <Button variant="ghost" size="sm" class="h-6 px-1.5 text-[10px]" @click="selectAll">
          <CheckCheck class="h-3 w-3 mr-0.5" />
          {{ t('redis.batch.selectAll') }}
        </Button>
        <Button variant="ghost" size="sm" class="h-6 px-1.5 text-[10px]" @click="deselectAll">
          <XSquare class="h-3 w-3 mr-0.5" />
          {{ t('redis.batch.deselectAll') }}
        </Button>
      </template>
    </div>

    <!-- 批量操作按钮（选中时显示） -->
    <div v-if="batchMode && selectedCount > 0" class="flex items-center gap-1 px-2 py-1.5 border-b border-border/20 bg-muted/10 shrink-0">
      <Button variant="ghost" size="sm" class="h-7 px-2 text-xs text-destructive" :disabled="batchLoading" @click="handleBatchDelete">
        <Trash2 class="h-3.5 w-3.5 mr-1" />
        {{ t('redis.batch.delete') }}
      </Button>
      <Button variant="ghost" size="sm" class="h-7 px-2 text-xs" :disabled="batchLoading" @click="handleBatchSetTtl">
        <Clock class="h-3.5 w-3.5 mr-1" />
        {{ t('redis.batch.setTtl') }}
      </Button>
      <Button variant="ghost" size="sm" class="h-7 px-2 text-xs" :disabled="batchLoading" @click="handleBatchExport">
        <Download class="h-3.5 w-3.5 mr-1" />
        {{ t('redis.batch.export') }}
      </Button>
      <Button variant="ghost" size="sm" class="h-7 px-2 text-xs" :disabled="batchLoading" @click="handleBatchImport">
        <Upload class="h-3.5 w-3.5 mr-1" />
        {{ t('redis.batch.import') }}
      </Button>
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
          :batch-mode="batchMode"
          :selected-keys="selectedKeys"
          @select="handleSelect"
          @delete="handleDeleteKey"
          @toggle-check="toggleKeySelection"
          @context-action="handleContextAction"
        />

        <!-- 加载更多 -->
        <div v-if="hasMore" class="px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            class="w-full h-8 text-xs text-muted-foreground"
            :disabled="loading"
            @click="loadMore"
          >
            {{ loading ? t('redis.loading') : t('redis.loadMore') }}
          </Button>
        </div>

        <!-- 空状态 -->
        <div v-if="!loading && keys.length === 0" class="px-3 py-12 text-center">
          <Database class="h-8 w-8 mx-auto mb-3 text-muted-foreground/20" />
          <p class="text-sm text-muted-foreground/50 font-medium">{{ t('redis.noKeys') }}</p>
          <p class="text-xs text-muted-foreground/30 mt-1">{{ t('redis.noKeysHint') }}</p>
        </div>
      </div>
    </ScrollArea>

    <!-- TTL 设置弹窗（批量） -->
    <Teleport to="body">
      <div v-if="showTtlDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showTtlDialog = false">
        <div class="bg-popover border border-border rounded-lg p-4 w-[300px] space-y-3 shadow-xl">
          <div class="text-sm font-bold text-foreground">{{ t('redis.batch.setTtlTitle') }}</div>
          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">{{ t('redis.batch.ttlSeconds') }}</label>
            <Input v-model.number="batchTtl" type="number" class="h-8 text-xs" min="1" />
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="sm" class="h-7 text-xs" @click="showTtlDialog = false">{{ t('common.cancel') }}</Button>
            <Button size="sm" class="h-7 text-xs" :disabled="batchLoading" @click="confirmBatchSetTtl">{{ t('common.confirm') }}</Button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 重命名弹窗 -->
    <Teleport to="body">
      <div v-if="showRenameDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showRenameDialog = false">
        <div class="bg-popover border border-border rounded-lg p-4 w-[340px] space-y-3 shadow-xl">
          <div class="text-sm font-bold text-foreground">{{ t('redis.contextMenu.renameTitle') }}</div>
          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">{{ t('redis.contextMenu.newKeyName') }}</label>
            <Input v-model="renameNewKey" class="h-8 text-xs font-mono" @keydown.enter="confirmRename" />
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="sm" class="h-7 text-xs" @click="showRenameDialog = false">{{ t('common.cancel') }}</Button>
            <Button size="sm" class="h-7 text-xs" @click="confirmRename">{{ t('common.confirm') }}</Button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 单键 TTL 弹窗 -->
    <Teleport to="body">
      <div v-if="showKeyTtlDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="showKeyTtlDialog = false">
        <div class="bg-popover border border-border rounded-lg p-4 w-[300px] space-y-3 shadow-xl">
          <div class="text-sm font-bold text-foreground">{{ t('redis.contextMenu.setTtlTitle') }}</div>
          <div class="text-xs text-muted-foreground/60 font-mono truncate">{{ contextKey }}</div>
          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">{{ t('redis.batch.ttlSeconds') }}</label>
            <Input v-model.number="keyTtlValue" type="number" class="h-8 text-xs" min="1" @keydown.enter="confirmKeyTtl" />
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="sm" class="h-7 text-xs" @click="showKeyTtlDialog = false">{{ t('common.cancel') }}</Button>
            <Button size="sm" class="h-7 text-xs" @click="confirmKeyTtl">{{ t('common.confirm') }}</Button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
