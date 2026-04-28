<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Search, CheckSquare, Trash2, Clock, Download, Upload, CheckCheck, XSquare, Database } from 'lucide-vue-next'
import KeyTreeItem from './KeyTreeItem.vue'
import type { TreeNode } from './KeyTreeItem.vue'
import { buildRedisKeyTree, removeRedisKeys } from './redisKeyTree'
import { redisScanKeys, redisGetKeyInfo, redisDeleteKeys, redisRenameKey, redisSetTtl, redisBatchDelete, redisBatchSetTtl, redisBatchExport, redisBatchImport } from '@/api/redis'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'
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
const keyInfoCache = ref<Map<string, RedisKeyInfo>>(new Map())

/** 扁平化版本号：展开/折叠时递增，触发 flatVisibleNodes 重算 */
const flatVersion = ref(0)

/** 将树扁平化为可见节点列表（用于虚拟滚动） */
interface FlatNode {
  node: TreeNode
  depth: number
}

const flatVisibleNodes = computed<FlatNode[]>(() => {
  // 依赖 flatVersion 确保展开/折叠时重算
  void flatVersion.value
  const result: FlatNode[] = []
  function walk(nodes: TreeNode[], depth: number) {
    for (const node of nodes) {
      result.push({ node, depth })
      if (!node.isLeaf && node.expanded) {
        walk(node.children, depth + 1)
      }
    }
  }
  walk(treeData.value, 0)
  return result
})

const ROW_HEIGHT = 32
const scrollRef = ref<HTMLElement | null>(null)

const virtualizer = useVirtualizer(computed(() => ({
  count: flatVisibleNodes.value.length,
  getScrollElement: () => scrollRef.value,
  estimateSize: () => ROW_HEIGHT,
  overscan: 20,
})))

const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())
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
      keys.value = [...new Set([...keys.value, ...result.keys])]
    }
    cursor.value = result.cursor
    hasMore.value = result.cursor !== 0
    buildTree()
  } catch (e) {
    toast.error(t('redis.loadKeysFailed'), parseBackendError(e).message)
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
  treeData.value = buildRedisKeyTree(keys.value, { previousTree: treeData.value })
  flatVersion.value++
}

/** 选中键 */
async function handleSelect(node: TreeNode) {
  if (!node.isLeaf) {
    node.expanded = !node.expanded
    flatVersion.value++
    return
  }
  try {
    const cached = keyInfoCache.value.get(node.fullKey)
    const info = cached ?? await redisGetKeyInfo(props.connectionId, node.fullKey)
    if (!cached) keyInfoCache.value.set(node.fullKey, info)
    node.keyType = info.keyType
    emit('select', node.fullKey, info)
  } catch (e) {
    toast.error(t('redis.getKeyInfoFailed'), parseBackendError(e).message)
  }
}

/** 删除键（本地移除，避免全量 SCAN 刷新） */
async function handleDeleteKey(key: string, event: Event) {
  event.stopPropagation()
  try {
    await redisDeleteKeys(props.connectionId, [key])
    toast.success(t('redis.keyDeleted'))
    keys.value = removeRedisKeys(keys.value, [key])
    keyInfoCache.value.delete(key)
    buildTree()
    emit('delete')
  } catch (e) {
    toast.error(t('redis.deleteKeyFailed'), parseBackendError(e).message)
  }
}

// ========== 批量操作 ==========
const batchMode = ref(false)
const selectedKeys = ref<Set<string>>(new Set())
const showTtlDialog = ref(false)
const batchTtl = ref(3600)
const batchLoading = ref(false)
const showBatchDeleteConfirm = ref(false)

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
  showBatchDeleteConfirm.value = true
}

/** 确认批量删除 */
async function confirmBatchDelete() {
  const count = selectedCount.value
  batchLoading.value = true
  try {
    const deletedKeys = [...selectedKeys.value]
    await redisBatchDelete(props.connectionId, deletedKeys)
    toast.success(t('redis.batch.deleteSuccess', { count }))
    // 本地移除已删键，避免全量 SCAN
    const deletedSet = new Set(deletedKeys)
    keys.value = removeRedisKeys(keys.value, deletedSet)
    for (const key of deletedSet) keyInfoCache.value.delete(key)
    buildTree()
    selectedKeys.value = new Set()
    emit('delete')
  } catch (e) {
    toast.error(t('redis.batch.deleteFailed'), parseBackendError(e).message)
  } finally {
    batchLoading.value = false
    showBatchDeleteConfirm.value = false
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
    toast.error(t('redis.batch.ttlFailed'), parseBackendError(e).message)
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
    toast.error(t('redis.batch.exportFailed'), parseBackendError(e).message)
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
      toast.error(t('redis.batch.importFailed'), parseBackendError(e).message)
    } finally {
      batchLoading.value = false
    }
  }
  input.click()
}

// ========== 右键菜单 ==========
const showRenameDialog = ref(false)
const showKeyTtlDialog = ref(false)
const showKeyDeleteConfirm = ref(false)
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
      showKeyDeleteConfirm.value = true
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
    toast.error(t('redis.contextMenu.renameFailed'), parseBackendError(e).message)
  }
}

/** 确认设置 TTL */
async function confirmKeyTtl() {
  try {
    await redisSetTtl(props.connectionId, contextKey.value, keyTtlValue.value)
    toast.success(t('redis.contextMenu.ttlSuccess'))
    showKeyTtlDialog.value = false
  } catch (e) {
    toast.error(t('redis.contextMenu.ttlFailed'), parseBackendError(e).message)
  }
}

/** 确认删除单键 */
async function confirmKeyDelete() {
  try {
    await redisDeleteKeys(props.connectionId, [contextKey.value])
    toast.success(t('redis.keyDeleted'))
    keys.value = removeRedisKeys(keys.value, [contextKey.value])
    keyInfoCache.value.delete(contextKey.value)
    buildTree()
    emit('delete')
  } catch (e) {
    toast.error(t('redis.deleteKeyFailed'), parseBackendError(e).message)
  } finally {
    showKeyDeleteConfirm.value = false
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

    <!-- 键列表（虚拟滚动） -->
    <div ref="scrollRef" class="flex-1 overflow-auto min-h-0">
      <div v-if="flatVisibleNodes.length > 0" :style="{ height: `${totalSize}px`, width: '100%', position: 'relative' }">
        <div
          v-for="row in virtualRows"
          :key="flatVisibleNodes[row.index]!.node.fullKey"
          class="absolute left-0 w-full"
          :style="{ height: `${row.size}px`, transform: `translateY(${row.start}px)` }"
        >
          <KeyTreeItem
            :node="flatVisibleNodes[row.index]!.node"
            :depth="flatVisibleNodes[row.index]!.depth"
            :selected-key="selectedKey"
            :batch-mode="batchMode"
            :selected-keys="selectedKeys"
            flat
            @select="handleSelect"
            @delete="handleDeleteKey"
            @toggle-check="toggleKeySelection"
            @context-action="handleContextAction"
          />
        </div>
      </div>

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

    <!-- 批量 TTL 设置弹窗 -->
    <Dialog :open="showTtlDialog" @update:open="showTtlDialog = $event">
      <DialogContent class="sm:max-w-[340px]">
        <DialogHeader>
          <DialogTitle>{{ t('redis.batch.setTtlTitle') }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-1.5 py-2">
          <label class="text-xs text-muted-foreground">{{ t('redis.batch.ttlSeconds') }}</label>
          <Input v-model.number="batchTtl" type="number" class="h-8 text-xs" min="1" />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" @click="showTtlDialog = false">{{ t('common.cancel') }}</Button>
          <Button size="sm" :disabled="batchLoading" @click="confirmBatchSetTtl">{{ t('common.confirm') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 重命名弹窗 -->
    <Dialog :open="showRenameDialog" @update:open="showRenameDialog = $event">
      <DialogContent class="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>{{ t('redis.contextMenu.renameTitle') }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-1.5 py-2">
          <label class="text-xs text-muted-foreground">{{ t('redis.contextMenu.newKeyName') }}</label>
          <Input v-model="renameNewKey" class="h-8 text-xs font-mono" @keydown.enter="confirmRename" />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" @click="showRenameDialog = false">{{ t('common.cancel') }}</Button>
          <Button size="sm" @click="confirmRename">{{ t('common.confirm') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 单键 TTL 弹窗 -->
    <Dialog :open="showKeyTtlDialog" @update:open="showKeyTtlDialog = $event">
      <DialogContent class="sm:max-w-[340px]">
        <DialogHeader>
          <DialogTitle>{{ t('redis.contextMenu.setTtlTitle') }}</DialogTitle>
          <DialogDescription class="font-mono truncate">{{ contextKey }}</DialogDescription>
        </DialogHeader>
        <div class="space-y-1.5 py-2">
          <label class="text-xs text-muted-foreground">{{ t('redis.batch.ttlSeconds') }}</label>
          <Input v-model.number="keyTtlValue" type="number" class="h-8 text-xs" min="1" @keydown.enter="confirmKeyTtl" />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" @click="showKeyTtlDialog = false">{{ t('common.cancel') }}</Button>
          <Button size="sm" @click="confirmKeyTtl">{{ t('common.confirm') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 单键删除确认弹窗 -->
    <Dialog :open="showKeyDeleteConfirm" @update:open="showKeyDeleteConfirm = $event">
      <DialogContent class="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>{{ t('redis.contextMenu.delete') }}</DialogTitle>
          <DialogDescription>{{ t('redis.contextMenu.deleteConfirm', { key: contextKey }) }}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" @click="showKeyDeleteConfirm = false">{{ t('common.cancel') }}</Button>
          <Button variant="destructive" size="sm" @click="confirmKeyDelete">{{ t('common.confirm') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 批量删除确认弹窗 -->
    <Dialog :open="showBatchDeleteConfirm" @update:open="showBatchDeleteConfirm = $event">
      <DialogContent class="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>{{ t('redis.batch.delete') }}</DialogTitle>
          <DialogDescription>{{ t('redis.batch.deleteConfirm', { count: selectedCount }) }}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" @click="showBatchDeleteConfirm = false">{{ t('common.cancel') }}</Button>
          <Button variant="destructive" size="sm" :disabled="batchLoading" @click="confirmBatchDelete">{{ t('common.confirm') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
