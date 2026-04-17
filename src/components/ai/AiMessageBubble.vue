<script setup lang="ts">
/**
 * AI 消息气泡组件
 *
 * 参照 Claude Code VSCode 插件风格：
 * - 用户消息：带深色背景的条块，一眼可见提问内容
 * - 助手消息：文档式平铺，紧凑排版
 * - 错误消息：红色警告条
 */
import { computed, ref } from 'vue'
import type { AiMessage, FileOperation } from '@/types/ai'
import { parseFileMarkers } from '@/utils/file-markers'
import { ChevronRight, Copy, Check, AlertCircle, Download, RotateCw } from 'lucide-vue-next'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@/api/database'
import AiCodeBlock from './AiCodeBlock.vue'
import AiFileCard from './AiFileCard.vue'
import AiToolCallBlock from './AiToolCallBlock.vue'
import AiFileOpsGroup from './AiFileOpsGroup.vue'

const props = defineProps<{
  message: AiMessage
  sessionId?: string
}>()

const emit = defineEmits<{
  (e: 'continue'): void
}>()

const showThinking = ref(false)
const copied = ref(false)

const hasThinking = computed(() => !!props.message.thinking?.trim())
const isUser = computed(() => props.message.role === 'user')
const isError = computed(() => props.message.role === 'error')
const hasToolCalls = computed(() => (props.message.toolCalls?.length ?? 0) > 0)

/** 可恢复的错误消息（流式超时/中断/未完成） */
const canContinue = computed(() => {
  if (!isError.value) return false
  const c = props.message.content ?? ''
  return /\[超时中断\]|\[已中断\]|上一轮回复未完成或已中断/.test(c)
})

/** 提取 write_file 成功态工具调用，转为 FileOperation 列表供 AiFileOpsGroup 渲染 */
const fileOperations = computed<FileOperation[]>(() => {
  if (!props.message.toolCalls) return []
  return props.message.toolCalls
    .filter(tc => tc.name === 'write_file' && tc.status === 'success')
    .map(tc => {
      const args = tc.parsedArgs ?? {}
      const path = (args.path as string) ?? ''
      return {
        op: 'modify' as const,
        path,
        fileName: path.split(/[/\\]/).pop() ?? '',
        newContent: (args.content as string) ?? '',
        status: 'pending' as const,
        toolCallId: tc.id,
      }
    })
})

/** 非文件写入的其他工具调用（如 read_file、search_files 等） */
const otherToolCalls = computed(() =>
  (props.message.toolCalls ?? []).filter(tc => tc.name !== 'write_file')
)

async function copyContent() {
  try {
    await navigator.clipboard.writeText(props.message.content)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* 静默失败 */ }
}

/** 导出消息为 .md 文件 */
async function exportMarkdown() {
  const filePath = await save({
    defaultPath: `ai-reply-${Date.now()}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (!filePath) return
  try {
    await writeTextFile(filePath, props.message.content)
  } catch (e) {
    console.error('[AI] 导出 Markdown 失败:', e)
  }
}

/** 解析消息文本为段落列表（文本 / 代码块 / 文件卡片） */
const contentSegments = computed(() => {
  const text = props.message.content
  if (!text) return []
  return parseFileMarkers(text)
})

/** 转义 HTML */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 行内 Markdown 渲染 */
function renderInline(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-foreground">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="px-1 py-px rounded bg-muted/80 text-[0.9em] font-mono">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="text-primary hover:underline">$1</a>')
}

/** 块级 Markdown 渲染 — 紧凑排版 */
function renderBlock(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    // 空行跳过
    if (!line.trim()) { i++; continue }

    // 标题
    const h1 = line.match(/^# (.+)$/)
    if (h1) { out.push(`<h2 class="text-[14px] font-bold mt-3 mb-1 text-foreground">${renderInline(h1[1]!)}</h2>`); i++; continue }
    const h2 = line.match(/^## (.+)$/)
    if (h2) { out.push(`<h3 class="text-[13px] font-bold mt-2.5 mb-0.5 text-foreground">${renderInline(h2[1]!)}</h3>`); i++; continue }
    const h3 = line.match(/^### (.+)$/)
    if (h3) { out.push(`<h4 class="text-[13px] font-semibold mt-2 mb-0.5 text-foreground">${renderInline(h3[1]!)}</h4>`); i++; continue }

    // 无序列表
    if (line.match(/^[-*] /)) {
      const items: string[] = []
      while (i < lines.length && lines[i]!.match(/^[-*] /)) {
        items.push(renderInline(lines[i]!.replace(/^[-*] /, '')))
        i++
      }
      out.push(`<ul class="my-1 ml-4 list-disc space-y-px">${items.map(it => `<li class="text-foreground/85 pl-0.5">${it}</li>`).join('')}</ul>`)
      continue
    }

    // 有序列表
    if (line.match(/^\d+\. /)) {
      const items: string[] = []
      while (i < lines.length && lines[i]!.match(/^\d+\. /)) {
        items.push(renderInline(lines[i]!.replace(/^\d+\. /, '')))
        i++
      }
      out.push(`<ol class="my-1 ml-4 list-decimal space-y-px">${items.map(it => `<li class="text-foreground/85 pl-0.5">${it}</li>`).join('')}</ol>`)
      continue
    }

    // 普通段落
    const pLines: string[] = []
    while (i < lines.length && lines[i]!.trim() !== '' && !lines[i]!.match(/^#{1,3} /) && !lines[i]!.match(/^[-*] /) && !lines[i]!.match(/^\d+\. /)) {
      pLines.push(renderInline(lines[i]!))
      i++
    }
    if (pLines.length > 0) {
      out.push(`<p class="my-0.5 leading-relaxed">${pLines.join('<br/>')}</p>`)
    }
  }

  return out.join('')
}
</script>

<template>
  <!-- ==================== 用户消息 ==================== -->
  <div v-if="isUser" class="my-1">
    <div class="rounded-lg bg-muted/50 px-4 py-3">
      <div class="flex items-center gap-2 mb-1">
        <div class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm bg-primary/15">
          <span class="text-[9px] font-bold text-primary leading-none">U</span>
        </div>
        <span class="text-[11px] font-medium text-muted-foreground">You</span>
      </div>
      <!-- 解析用户消息中的文件标签 -->
      <div class="text-[13px] text-foreground leading-relaxed select-text">
        <template v-for="(seg, i) in contentSegments" :key="i">
          <div v-if="seg.type === 'text'" class="whitespace-pre-wrap">{{ seg.content }}</div>
          <AiFileCard
            v-else-if="seg.type === 'file'"
            :name="seg.name"
            :path="seg.path"
            :size="seg.size"
            :lines="seg.lines"
            :content="seg.content"
            class="my-1.5"
          />
        </template>
      </div>
    </div>
  </div>

  <!-- ==================== 错误消息 ==================== -->
  <div v-else-if="isError" class="my-1">
    <div class="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2.5">
      <AlertCircle class="h-4 w-4 text-destructive shrink-0 mt-0.5" />
      <div class="flex-1 text-[13px] text-destructive leading-relaxed select-text">{{ message.content }}</div>
      <button
        v-if="canContinue"
        class="shrink-0 flex items-center gap-1 rounded-md border border-destructive/30 bg-background/60 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10 transition-colors"
        title="基于上一次的用户输入重新生成"
        @click="emit('continue')"
      >
        <RotateCw class="h-3 w-3" />
        继续生成
      </button>
    </div>
  </div>

  <!-- ==================== 助手消息 ==================== -->
  <div v-else class="group my-1">
    <!-- 标签行 -->
    <div class="flex items-center justify-between mb-0.5 px-1">
      <div class="flex items-center gap-2">
        <div class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm bg-emerald-500/15">
          <span class="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 leading-none">AI</span>
        </div>
        <span class="text-[11px] font-medium text-muted-foreground">Assistant</span>
        <span v-if="message.tokens" class="text-[10px] text-muted-foreground/30 font-mono">{{ message.tokens }} tokens</span>
      </div>
      <div class="flex items-center gap-0.5">
        <button
          v-if="!message.isStreaming && message.content"
          class="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground/30 hover:text-muted-foreground"
          title="导出 .md"
          @click="exportMarkdown"
        >
          <Download class="h-3.5 w-3.5" />
        </button>
        <button
          v-if="!message.isStreaming && message.content"
          class="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground/30 hover:text-muted-foreground"
          :title="copied ? '已复制' : '复制'"
          @click="copyContent"
        >
          <component :is="copied ? Check : Copy" class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="pl-[26px] pr-1">
      <!-- 思考过程 -->
      <div v-if="hasThinking" class="mb-1.5">
        <button
          class="flex items-center gap-1.5 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
          @click="showThinking = !showThinking"
        >
          <ChevronRight class="h-3 w-3 transition-transform duration-200" :class="{ 'rotate-90': showThinking }" />
          <span>思考过程</span>
        </button>
        <div
          v-show="showThinking"
          class="mt-1 pl-3 border-l border-muted-foreground/10 text-[11px] text-muted-foreground/35 font-mono leading-relaxed whitespace-pre-wrap max-h-[180px] overflow-y-auto"
        >
          {{ message.thinking }}
        </div>
      </div>

      <!-- 流式光标 -->
      <div v-if="message.isStreaming && !message.content" class="flex items-center gap-1.5 py-1">
        <span class="flex gap-[3px]">
          <span class="h-1 w-1 rounded-full bg-emerald-500/70 animate-pulse" />
          <span class="h-1 w-1 rounded-full bg-emerald-500/50 animate-pulse" style="animation-delay: 150ms" />
          <span class="h-1 w-1 rounded-full bg-emerald-500/30 animate-pulse" style="animation-delay: 300ms" />
        </span>
        <span class="text-[11px] text-muted-foreground/35">思考中</span>
      </div>

      <!-- 消息内容 -->
      <div v-if="message.content" class="text-[13px] leading-[1.65] text-foreground/90 select-text">
        <template v-for="(seg, i) in contentSegments" :key="i">
          <div v-if="seg.type === 'text'" v-html="renderBlock(seg.content)" />
          <AiCodeBlock v-else-if="seg.type === 'code'" :language="seg.language" :code="seg.content" class="my-1.5" />
          <AiFileCard
            v-else-if="seg.type === 'file'"
            :name="seg.name"
            :path="seg.path"
            :size="seg.size"
            :lines="seg.lines"
            :content="seg.content"
            class="my-1.5"
          />
        </template>
        <span
          v-if="message.isStreaming"
          class="inline-block h-3 w-[2px] animate-pulse rounded-full bg-emerald-500/60 ml-0.5 align-text-bottom"
        />
      </div>

      <!-- 工具调用块 -->
      <div v-if="hasToolCalls" class="mt-1.5 space-y-1">
        <!-- 文件操作组（聚合 write_file 为毛玻璃卡片组） -->
        <AiFileOpsGroup
          v-if="fileOperations.length > 0"
          :operations="fileOperations"
        />

        <!-- 其他工具调用（read_file、search_files 等） -->
        <div v-if="otherToolCalls.length" class="space-y-1">
          <AiToolCallBlock
            v-for="tc in otherToolCalls"
            :key="tc.id"
            :tool-call="tc"
            :session-id="sessionId"
          />
        </div>
      </div>
    </div>
  </div>
</template>
