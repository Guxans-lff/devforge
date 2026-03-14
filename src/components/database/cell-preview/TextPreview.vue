<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search } from 'lucide-vue-next'

const props = defineProps<{
  /** 文本内容 */
  value: string
}>()

const searchQuery = ref('')
const wrapText = ref(true)

/** 匹配搜索并高亮 */
const segments = computed(() => {
  if (!searchQuery.value || !props.value) {
    return [{ text: props.value, highlight: false }]
  }
  const query = searchQuery.value.toLowerCase()
  const result: { text: string; highlight: boolean }[] = []
  let remaining = props.value
  let lowerRemaining = remaining.toLowerCase()
  let idx = lowerRemaining.indexOf(query)

  while (idx !== -1) {
    if (idx > 0) {
      result.push({ text: remaining.slice(0, idx), highlight: false })
    }
    result.push({ text: remaining.slice(idx, idx + query.length), highlight: true })
    remaining = remaining.slice(idx + query.length)
    lowerRemaining = remaining.toLowerCase()
    idx = lowerRemaining.indexOf(query)
  }
  if (remaining) {
    result.push({ text: remaining, highlight: false })
  }
  return result
})

/** 匹配数量 */
const matchCount = computed(() => {
  if (!searchQuery.value || !props.value) return 0
  const query = searchQuery.value.toLowerCase()
  let count = 0
  let pos = props.value.toLowerCase().indexOf(query)
  while (pos !== -1) {
    count++
    pos = props.value.toLowerCase().indexOf(query, pos + 1)
  }
  return count
})

/** 字符数与字节数 */
const charCount = computed(() => props.value?.length ?? 0)
const byteCount = computed(() => new TextEncoder().encode(props.value ?? '').length)
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 工具栏 -->
    <div class="flex items-center gap-2 border-b border-border/50 px-3 py-1.5 shrink-0">
      <div class="flex items-center gap-1.5 flex-1">
        <Search class="h-3 w-3 text-muted-foreground" />
        <input
          v-model="searchQuery"
          placeholder="搜索..."
          class="h-6 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
        />
        <span v-if="searchQuery" class="text-[10px] text-muted-foreground tabular-nums">
          {{ matchCount }} 处匹配
        </span>
      </div>
      <button
        class="text-[10px] px-1.5 py-0.5 rounded-sm"
        :class="wrapText ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50'"
        @click="wrapText = !wrapText"
      >
        自动换行
      </button>
    </div>

    <!-- 文本内容 -->
    <div class="flex-1 overflow-auto p-3">
      <pre
        class="text-xs font-mono leading-relaxed select-text"
        :class="wrapText ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'"
      ><template v-for="(seg, i) in segments" :key="i"><span :class="seg.highlight ? 'bg-yellow-300/50 text-yellow-900 dark:bg-yellow-500/30 dark:text-yellow-200 rounded-sm px-0.5' : ''">{{ seg.text }}</span></template></pre>
    </div>

    <!-- 底部信息 -->
    <div class="flex items-center gap-3 border-t border-border/50 px-3 py-1 text-[10px] text-muted-foreground shrink-0">
      <span>{{ charCount }} 字符</span>
      <span>{{ byteCount }} 字节</span>
    </div>
  </div>
</template>
