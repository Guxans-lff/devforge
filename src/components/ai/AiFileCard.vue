<script setup lang="ts">
/**
 * 可折叠文件卡片组件
 *
 * 在消息中展示 <file> 标签解析后的文件内容，
 * 默认折叠，点击展开查看完整内容。
 */
import { ref, computed } from 'vue'
import { File, ChevronRight, Copy, Check } from 'lucide-vue-next'

const props = defineProps<{
  name: string
  path: string
  size: number
  lines: number
  content: string
}>()

const expanded = ref(false)
const copied = ref(false)

/** 格式化文件大小 */
const formattedSize = computed(() => {
  const bytes = props.size
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
})

/** 预览行数（折叠时显示前 5 行） */
const previewLines = computed(() => {
  const allLines = props.content.split('\n')
  return allLines.slice(0, 5).join('\n')
})

const hasMoreLines = computed(() => props.lines > 5)

async function copyContent() {
  try {
    await navigator.clipboard.writeText(props.content)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* 静默失败 */ }
}
</script>

<template>
  <div class="my-1.5 rounded-lg border border-border/40 bg-muted/10 overflow-hidden">
    <!-- 头部 -->
    <button
      class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/20 transition-colors"
      @click="expanded = !expanded"
    >
      <ChevronRight
        class="h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform duration-200"
        :class="{ 'rotate-90': expanded }"
      />
      <File class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
      <span class="text-xs font-medium text-foreground/80 truncate">{{ name }}</span>
      <span class="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground/40">
        <span>{{ lines }} 行</span>
        <span>{{ formattedSize }}</span>
      </span>
    </button>

    <!-- 内容区 -->
    <div v-if="expanded || !hasMoreLines" class="relative border-t border-border/30">
      <!-- 复制按钮 -->
      <button
        class="absolute right-2 top-2 z-10 rounded p-1 hover:bg-muted text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        :title="copied ? '已复制' : '复制文件内容'"
        @click.stop="copyContent"
      >
        <component :is="copied ? Check : Copy" class="h-3 w-3" />
      </button>

      <pre
        class="overflow-x-auto p-3 text-[11px] leading-relaxed font-mono text-foreground/75 select-text max-h-[400px] overflow-y-auto"
      ><code>{{ content }}</code></pre>
    </div>

    <!-- 折叠预览 -->
    <div v-else class="border-t border-border/30">
      <pre
        class="overflow-x-auto px-3 pt-2 pb-1 text-[11px] leading-relaxed font-mono text-foreground/50 select-text"
      ><code>{{ previewLines }}</code></pre>
      <div class="px-3 pb-2">
        <span class="text-[10px] text-muted-foreground/40">… 还有 {{ lines - 5 }} 行，点击展开</span>
      </div>
    </div>
  </div>
</template>
