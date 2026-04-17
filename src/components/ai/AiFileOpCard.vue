<script setup lang="ts">
/**
 * AI 文件操作卡片 — 毛玻璃折叠风格
 *
 * 展示单个文件的操作结果（创建/修改/删除），
 * 支持展开 mini diff 和并排 Diff
 */
import { ref, computed } from 'vue'
import { computeMiniDiff } from '@/composables/useAiDiff'
import type { FileOperation } from '@/types/ai'
import { ChevronRight, Check, X } from 'lucide-vue-next'
import AiDiffViewer from './AiDiffViewer.vue'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

const props = defineProps<{
  op: FileOperation
  autoExpand?: boolean
}>()

const emit = defineEmits<{
  apply: [op: FileOperation]
  reject: [op: FileOperation]
}>()

const expanded = ref(props.autoExpand ?? false)
const showDiffViewer = ref(false)

/** 文件扩展名→颜色 */
const FILE_COLORS: Record<string, string> = {
  vue: '#42b883', ts: '#3178c6', js: '#f7df1e', java: '#e76f00',
  py: '#3776ab', rs: '#dea584', css: '#264de4', html: '#e34f26',
}

const fileColor = computed(() => {
  const ext = props.op.fileName.split('.').pop()?.toLowerCase() ?? ''
  return FILE_COLORS[ext] ?? '#6b7280'
})

/** mini diff 数据 */
const miniDiff = computed(() => {
  if (props.op.op === 'create' || !props.op.oldContent || !props.op.newContent) return null
  return computeMiniDiff(props.op.oldContent, props.op.newContent, 10)
})

/** 增删统计 */
const stats = computed(() => {
  if (!miniDiff.value) {
    if (props.op.op === 'create' && props.op.newContent) {
      return { added: props.op.newContent.split('\n').length, removed: 0 }
    }
    if (props.op.op === 'delete' && props.op.oldContent) {
      return { added: 0, removed: props.op.oldContent.split('\n').length }
    }
    return { added: 0, removed: 0 }
  }
  const added = miniDiff.value.lines.filter(l => l.type === 'added').length
  const removed = miniDiff.value.lines.filter(l => l.type === 'removed').length
  return { added, removed }
})

const isApplied = computed(() => props.op.status === 'applied')
const isRejected = computed(() => props.op.status === 'rejected')

async function handleApply() {
  emit('apply', props.op)
}

async function handleReject() {
  emit('reject', props.op)
}

/** 路径中提取目录 */
const dirPath = computed(() => {
  const parts = props.op.path.replace(/\\/g, '/').split('/')
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/') + '/'
})
</script>

<template>
  <div
    class="rounded-xl border transition-all duration-200"
    :class="[
      isApplied ? 'border-green-500/15 bg-green-500/[0.02] opacity-70' :
      isRejected ? 'border-border/10 bg-muted/5 opacity-50' :
      'border-white/[0.06] bg-white/[0.02] backdrop-blur-xl',
    ]"
  >
    <!-- 头部 -->
    <div
      class="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer select-none"
      @click="expanded = !expanded"
    >
      <ChevronRight
        class="h-2.5 w-2.5 transition-transform duration-150 flex-shrink-0"
        :class="expanded ? 'rotate-90 text-primary/60' : 'text-muted-foreground/40'"
      />
      <div
        class="w-2 h-2 rounded-[2px] flex-shrink-0"
        :style="{ background: `linear-gradient(135deg, ${fileColor}, ${fileColor}cc)` }"
      />
      <span class="font-medium text-[12px] text-foreground/90">{{ op.fileName }}</span>
      <span class="text-[10px] text-muted-foreground/30 truncate">{{ dirPath }}</span>
      <span
        v-if="op.op === 'create'"
        class="text-[9px] font-medium px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/15 text-indigo-400"
      >NEW</span>
      <span
        v-if="op.op === 'delete'"
        class="text-[9px] font-medium px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/15 text-red-400"
      >DEL</span>
      <Check v-if="isApplied" class="h-3.5 w-3.5 text-green-400 ml-auto flex-shrink-0" />
      <span v-else-if="isRejected" class="text-[10px] text-muted-foreground/30 line-through ml-auto">已撤销</span>
      <div v-if="!isApplied && !isRejected" class="ml-auto flex gap-1.5 flex-shrink-0">
        <span v-if="stats.added" class="text-[10px] text-green-400">+{{ stats.added }}</span>
        <span v-if="stats.removed" class="text-[10px] text-red-400">-{{ stats.removed }}</span>
      </div>
    </div>

    <!-- mini diff 展开区 -->
    <div v-if="expanded" class="border-t border-white/[0.03]">
      <div v-if="miniDiff" class="px-3.5 py-2 font-mono text-[10px] leading-[1.7] bg-black/15">
        <div
          v-for="(line, i) in miniDiff.lines"
          :key="i"
          :class="line.type === 'removed' ? 'text-red-400/70' : 'text-green-400/70'"
        >
          <span class="select-none">{{ line.type === 'removed' ? '- ' : '+ ' }}</span>{{ line.content }}
        </div>
        <div v-if="miniDiff.truncated > 0" class="text-muted-foreground/30 mt-1">
          ... 还有 {{ miniDiff.truncated }} 行改动
        </div>
      </div>
      <div v-else-if="op.op === 'create' && op.newContent" class="px-3.5 py-2 font-mono text-[10px] leading-[1.7] bg-black/15 text-green-400/60">
        <div v-for="(line, i) in op.newContent.split('\n').slice(0, 10)" :key="i">
          <span class="select-none text-green-400/30">+ </span>{{ line }}
        </div>
        <div v-if="(op.newContent.split('\n').length) > 10" class="text-muted-foreground/30 mt-1">
          ... 还有 {{ op.newContent.split('\n').length - 10 }} 行
        </div>
      </div>
      <div v-if="!isApplied && !isRejected" class="px-3.5 py-2 flex gap-3 border-t border-white/[0.03]">
        <button class="text-[10px] font-medium text-green-400 hover:text-green-300 transition-colors" @click.stop="handleApply">Apply</button>
        <button class="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors" @click.stop="handleReject">Reject</button>
        <button
          v-if="op.op === 'modify'"
          class="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
          @click.stop="showDiffViewer = true"
        >Side-by-side</button>
      </div>
    </div>

    <!-- 并排 Diff 全屏抽屉 -->
    <Sheet v-model:open="showDiffViewer">
      <SheetContent side="right" class="w-[min(1100px,96vw)] sm:max-w-none p-0 overflow-hidden bg-background">
        <SheetHeader class="px-4 py-2 border-b border-border/30">
          <SheetTitle class="text-sm">全屏审阅 · {{ op.fileName }}</SheetTitle>
        </SheetHeader>
        <div class="h-[calc(100vh-52px)] overflow-auto p-3">
          <AiDiffViewer
            v-if="op.oldContent && op.newContent"
            :old-text="op.oldContent"
            :new-text="op.newContent"
            :file-name="op.fileName"
            :dir-path="dirPath"
            @apply="() => { handleApply(); showDiffViewer = false }"
            @reject="() => { handleReject(); showDiffViewer = false }"
            @close="showDiffViewer = false"
          />
          <div v-else class="p-6 text-sm text-muted-foreground">
            本次操作无旧内容可对比（新建文件或无 oldContent）。
          </div>
        </div>
      </SheetContent>
    </Sheet>
  </div>
</template>
