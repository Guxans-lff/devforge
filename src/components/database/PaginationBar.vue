<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  /** 当前页码（从 1 开始） */
  currentPage: number
  /** 每页行数 */
  pageSize: number
  /** 总行数 */
  totalRows: number
  /** 查询执行时间（毫秒） */
  executionTimeMs?: number
}>()

const emit = defineEmits<{
  'update:currentPage': [page: number]
  'update:pageSize': [size: number]
}>()

/** 总页数 */
const totalPages = computed(() => Math.max(1, Math.ceil(props.totalRows / props.pageSize)))

/** 页码输入框 */
const pageInput = ref('')

/** 可选的每页行数 */
const pageSizeOptions = [50, 100, 200, 500, 1000]

/** 生成页码按钮列表（最多显示 7 个） */
const pageButtons = computed(() => {
  const total = totalPages.value
  const current = props.currentPage
  const pages: (number | '...')[] = []

  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    pages.push(1)
    if (current > 3) pages.push('...')
    const start = Math.max(2, current - 1)
    const end = Math.min(total - 1, current + 1)
    for (let i = start; i <= end; i++) pages.push(i)
    if (current < total - 2) pages.push('...')
    pages.push(total)
  }
  return pages
})

/** 跳转到指定页 */
function goToPage(page: number) {
  const p = Math.max(1, Math.min(page, totalPages.value))
  emit('update:currentPage', p)
}

/** 页码输入框回车跳转 */
function handlePageInputEnter() {
  const p = parseInt(pageInput.value, 10)
  if (!isNaN(p) && p >= 1 && p <= totalPages.value) {
    goToPage(p)
  }
  pageInput.value = ''
}

/** 切换每页行数 */
function handlePageSizeChange(e: Event) {
  const size = parseInt((e.target as HTMLSelectElement).value, 10)
  emit('update:pageSize', size)
  // 重置到第一页
  emit('update:currentPage', 1)
}
</script>

<template>
  <div class="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground shrink-0">
    <!-- 左侧：总行数和执行时间 -->
    <div class="flex items-center gap-2">
      <span>共 {{ totalRows.toLocaleString() }} 行</span>
      <span v-if="executionTimeMs !== undefined" class="text-muted-foreground/60">
        ({{ executionTimeMs }}ms)
      </span>
    </div>

    <!-- 中间：页码导航 -->
    <div class="flex items-center gap-0.5">
      <!-- 首页 -->
      <Button
        variant="ghost"
        size="sm"
        class="h-5 w-5 p-0"
        :disabled="currentPage <= 1"
        @click="goToPage(1)"
      >
        <ChevronFirst class="h-3 w-3" />
      </Button>
      <!-- 上一页 -->
      <Button
        variant="ghost"
        size="sm"
        class="h-5 w-5 p-0"
        :disabled="currentPage <= 1"
        @click="goToPage(currentPage - 1)"
      >
        <ChevronLeft class="h-3 w-3" />
      </Button>

      <!-- 页码按钮 -->
      <template v-for="(page, idx) in pageButtons" :key="idx">
        <span v-if="page === '...'" class="px-1 text-muted-foreground/50">...</span>
        <Button
          v-else
          variant="ghost"
          size="sm"
          class="h-5 min-w-[20px] px-1 text-[10px]"
          :class="page === currentPage ? 'bg-primary/10 text-primary font-bold' : ''"
          @click="goToPage(page)"
        >
          {{ page }}
        </Button>
      </template>

      <!-- 下一页 -->
      <Button
        variant="ghost"
        size="sm"
        class="h-5 w-5 p-0"
        :disabled="currentPage >= totalPages"
        @click="goToPage(currentPage + 1)"
      >
        <ChevronRight class="h-3 w-3" />
      </Button>
      <!-- 末页 -->
      <Button
        variant="ghost"
        size="sm"
        class="h-5 w-5 p-0"
        :disabled="currentPage >= totalPages"
        @click="goToPage(totalPages)"
      >
        <ChevronLast class="h-3 w-3" />
      </Button>

      <!-- 页码输入框 -->
      <input
        v-model="pageInput"
        type="text"
        :placeholder="`${currentPage}/${totalPages}`"
        class="ml-1 w-16 h-5 rounded border border-border bg-background px-1 text-[10px] text-center tabular-nums outline-none focus:border-primary"
        @keydown.enter="handlePageInputEnter"
      />
    </div>

    <!-- 右侧：每页行数选择器 -->
    <div class="flex items-center gap-1">
      <span>每页</span>
      <select
        :value="pageSize"
        class="h-5 rounded border border-border bg-background px-1 text-[10px] outline-none focus:border-primary"
        @change="handlePageSizeChange"
      >
        <option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }}</option>
      </select>
      <span>行</span>
    </div>
  </div>
</template>
