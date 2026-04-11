<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, Trash2, ChevronDown, ChevronRight, RefreshCw, X } from 'lucide-vue-next'
import { redisStreamRange, redisStreamAdd, redisStreamDel, redisStreamLen } from '@/api/redis'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'
import type { StreamEntry } from '@/types/redis'

const props = defineProps<{
  connectionId: string
  redisKey: string
  total: number
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
}>()

const { t } = useI18n()
const toast = useToast()

// 数据
const entries = ref<StreamEntry[]>([])
const loading = ref(false)
const totalCount = ref(props.total)

// 分页（游标式，基于 Stream ID）
const PAGE_SIZE = 500
const pageStack = ref<string[]>([]) // 页面起始 ID 栈
const hasMore = ref(false)
const currentPage = ref(1)

// 展开的条目
const expandedIds = ref<Set<string>>(new Set())

// 添加对话框
const showAddDialog = ref(false)
const addFields = ref<{ field: string; value: string }[]>([{ field: '', value: '' }])
const adding = ref(false)

const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE)))

/** 加载条目 */
async function loadEntries(start = '-') {
  loading.value = true
  try {
    // 刷新总数
    totalCount.value = await redisStreamLen(props.connectionId, props.redisKey)

    const result = await redisStreamRange({
      connectionId: props.connectionId,
      key: props.redisKey,
      start,
      stop: '+',
      count: PAGE_SIZE + 1, // 多取 1 条判断是否有下一页
    })

    if (result.length > PAGE_SIZE) {
      hasMore.value = true
      entries.value = result.slice(0, PAGE_SIZE)
    } else {
      hasMore.value = false
      entries.value = result
    }

    expandedIds.value.clear()
  } catch (e) {
    toast.error(t('redis.stream.loadFailed'), parseBackendError(e).message)
  } finally {
    loading.value = false
  }
}

/** 下一页 */
function nextPage() {
  if (!hasMore.value || entries.value.length === 0) return
  const lastId = entries.value[entries.value.length - 1]!.id
  // 使用 lastId 的下一个可能 ID 作为起始
  const nextStart = incrementStreamId(lastId)
  pageStack.value.push(entries.value[0]!.id)
  currentPage.value++
  loadEntries(nextStart)
}

/** 上一页 */
function prevPage() {
  if (pageStack.value.length === 0) return
  const prevStart = pageStack.value.pop()!
  currentPage.value--
  loadEntries(prevStart)
}

/** 递增 Stream ID（用于分页游标） */
function incrementStreamId(id: string): string {
  const [ts, seq] = id.split('-')
  const nextSeq = parseInt(seq || '0') + 1
  return `${ts}-${nextSeq}`
}

/** 切换展开/折叠 */
function toggleExpand(id: string) {
  if (expandedIds.value.has(id)) {
    expandedIds.value.delete(id)
  } else {
    expandedIds.value.add(id)
  }
}

/** 字段预览（截取前 3 个） */
function fieldsPreview(fields: [string, string][]): string {
  return fields
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v.length > 30 ? v.slice(0, 30) + '…' : v}`)
    .join(', ')
}

/** 删除条目 */
async function handleDelete(id: string) {
  try {
    await redisStreamDel(props.connectionId, props.redisKey, [id])
    entries.value = entries.value.filter(e => e.id !== id)
    expandedIds.value.delete(id)
    totalCount.value--
    emit('refresh')
  } catch (e) {
    toast.error(t('redis.stream.deleteFailed'), parseBackendError(e).message)
  }
}

/** 打开添加对话框 */
function openAddDialog() {
  addFields.value = [{ field: '', value: '' }]
  showAddDialog.value = true
}

/** 添加字段行 */
function addFieldRow() {
  addFields.value.push({ field: '', value: '' })
}

/** 删除字段行 */
function removeFieldRow(index: number) {
  addFields.value.splice(index, 1)
}

/** 提交添加 */
async function handleAdd() {
  const validFields = addFields.value.filter(f => f.field.trim())
  if (validFields.length === 0) return

  adding.value = true
  try {
    await redisStreamAdd({
      connectionId: props.connectionId,
      key: props.redisKey,
      fields: validFields.map(f => [f.field.trim(), f.value]),
    })
    showAddDialog.value = false
    toast.success(t('redis.stream.addSuccess'))
    // 重新加载第一页
    pageStack.value = []
    currentPage.value = 1
    await loadEntries()
    emit('refresh')
  } catch (e) {
    toast.error(t('redis.stream.addFailed'), parseBackendError(e).message)
  } finally {
    adding.value = false
  }
}

/** 刷新 */
async function handleRefresh() {
  pageStack.value = []
  currentPage.value = 1
  await loadEntries()
}

watch(() => props.redisKey, () => {
  pageStack.value = []
  currentPage.value = 1
  loadEntries()
})

onMounted(() => { loadEntries() })
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 工具栏 -->
    <div class="flex items-center gap-2 px-4 py-2 border-b border-border/20">
      <Button variant="ghost" size="sm" class="h-7 px-2 text-[11px]" @click="openAddDialog">
        <Plus class="h-3.5 w-3.5 mr-1" />
        {{ t('redis.stream.addEntry') }}
      </Button>
      <Button variant="ghost" size="sm" class="h-7 px-2" @click="handleRefresh">
        <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': loading }" />
      </Button>
      <div class="flex-1" />
      <span class="text-[10px] text-muted-foreground/50">
        {{ t('redis.stream.totalEntries', { count: totalCount }) }}
      </span>
    </div>

    <!-- 条目列表 -->
    <ScrollArea class="flex-1">
      <table class="w-full text-[11px]">
        <thead class="sticky top-0 bg-muted/30 z-10">
          <tr class="border-b border-border/20">
            <th class="px-4 py-2 text-left font-bold text-muted-foreground/60 w-8"></th>
            <th class="px-4 py-2 text-left font-bold text-muted-foreground/60 w-[220px]">ID</th>
            <th class="px-4 py-2 text-left font-bold text-muted-foreground/60 w-[60px]">{{ t('redis.stream.fieldCount') }}</th>
            <th class="px-4 py-2 text-left font-bold text-muted-foreground/60">{{ t('redis.stream.preview') }}</th>
            <th class="px-4 py-2 w-10"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="entry in entries" :key="entry.id">
            <!-- 条目行 -->
            <tr
              class="border-b border-border/10 hover:bg-muted/20 group cursor-pointer"
              @click="toggleExpand(entry.id)"
            >
              <td class="px-4 py-1.5 text-muted-foreground/40">
                <ChevronDown v-if="expandedIds.has(entry.id)" class="h-3 w-3" />
                <ChevronRight v-else class="h-3 w-3" />
              </td>
              <td class="px-4 py-1.5 font-mono text-primary/80">{{ entry.id }}</td>
              <td class="px-4 py-1.5 text-center text-muted-foreground/60">{{ entry.fields.length }}</td>
              <td class="px-4 py-1.5 text-muted-foreground/50 truncate max-w-[400px]">
                {{ fieldsPreview(entry.fields) }}
              </td>
              <td class="px-4 py-1.5 text-right" @click.stop>
                <Trash2
                  class="h-3 w-3 inline-block text-muted-foreground/20 opacity-0 group-hover:opacity-100 hover:text-destructive cursor-pointer transition-all"
                  @click="handleDelete(entry.id)"
                />
              </td>
            </tr>
            <!-- 展开详情 -->
            <tr v-if="expandedIds.has(entry.id)">
              <td colspan="5" class="px-8 py-2 bg-muted/10">
                <div class="space-y-0.5">
                  <div
                    v-for="([k, v], idx) in entry.fields"
                    :key="idx"
                    class="flex gap-3 py-0.5"
                  >
                    <span class="font-mono font-medium text-foreground/70 min-w-[120px] shrink-0">{{ k }}</span>
                    <span class="font-mono text-foreground/50 break-all">{{ v }}</span>
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <!-- 空状态 -->
          <tr v-if="!loading && entries.length === 0">
            <td colspan="5" class="px-4 py-8 text-center text-muted-foreground/30">
              {{ t('redis.stream.empty') }}
            </td>
          </tr>
        </tbody>
      </table>
    </ScrollArea>

    <!-- 分页 -->
    <div v-if="totalCount > PAGE_SIZE" class="flex items-center justify-center gap-3 px-4 py-2 border-t border-border/20">
      <Button
        variant="ghost"
        size="sm"
        class="h-6 px-2 text-[10px]"
        :disabled="currentPage <= 1"
        @click="prevPage"
      >
        &lt;
      </Button>
      <span class="text-[10px] text-muted-foreground/60">{{ currentPage }} / {{ totalPages }}</span>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 px-2 text-[10px]"
        :disabled="!hasMore"
        @click="nextPage"
      >
        &gt;
      </Button>
    </div>

    <!-- 添加条目对话框 -->
    <Dialog :open="showAddDialog" @update:open="showAddDialog = $event">
      <DialogContent class="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle class="text-sm">{{ t('redis.stream.addEntry') }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-2 max-h-[300px] overflow-y-auto py-2">
          <div
            v-for="(row, idx) in addFields"
            :key="idx"
            class="flex items-center gap-2"
          >
            <Input
              v-model="row.field"
              :placeholder="t('redis.stream.fieldName')"
              class="h-8 text-xs flex-1"
            />
            <Input
              v-model="row.value"
              :placeholder="t('redis.stream.fieldValue')"
              class="h-8 text-xs flex-1"
            />
            <Button
              v-if="addFields.length > 1"
              variant="ghost"
              size="sm"
              class="h-8 px-1 shrink-0"
              @click="removeFieldRow(idx)"
            >
              <X class="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>
          <Button variant="outline" size="sm" class="h-7 text-[11px] w-full" @click="addFieldRow">
            <Plus class="h-3 w-3 mr-1" />
            {{ t('redis.stream.addField') }}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" @click="showAddDialog = false">
            {{ t('common.cancel') }}
          </Button>
          <Button
            size="sm"
            :disabled="adding || addFields.every(f => !f.field.trim())"
            @click="handleAdd"
          >
            {{ adding ? t('common.saving') : t('common.confirm') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
