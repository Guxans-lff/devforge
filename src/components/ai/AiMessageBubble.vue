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
import { ChevronRight, Copy, Check, AlertCircle, AlertTriangle, Info, Download, RotateCw } from 'lucide-vue-next'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@/api/database'
import DOMPurify from 'dompurify'
import AiCodeBlock from './AiCodeBlock.vue'
import AiFileCard from './AiFileCard.vue'
import AiToolCallBlock from './AiToolCallBlock.vue'
import AiFileOpsGroup from './AiFileOpsGroup.vue'
import AiContextPill from './AiContextPill.vue'

const props = defineProps<{
  message: AiMessage
  sessionId?: string
  /** 组内非首条时隐藏头像/名字行 */
  hideHeader?: boolean
  /** 是否是组内最后一条（最后一条不画时间线竖线） */
  isGroupEnd?: boolean
  /** 是否处于连续 assistant 组内（控制时间线样式） */
  inGroup?: boolean
  /** 最新 user 消息吸顶极简模式：单行省略 + 展开按钮 */
  stickyCompact?: boolean
}>()

const emit = defineEmits<{
  (e: 'continue'): void
  (e: 'bumpMaxOutput', value: number): void
}>()

/** 识别 [输出被 max_tokens 截断] 错误 → 显示一键调大按钮 */
const isMaxTokensTruncated = computed(() => {
  if (props.message.role !== 'error') return false
  return /\[输出被 max_tokens 截断\]/.test(props.message.content ?? '')
})

const copied = ref(false)

const hasThinking = computed(() => !!props.message.thinking?.trim())
const isUser = computed(() => props.message.role === 'user')
const isError = computed(() => props.message.role === 'error')
const hasToolCalls = computed(() => (props.message.toolCalls?.length ?? 0) > 0)

/** 用户消息折叠：超过 3 行时默认收起（展示 2 行） */
const USER_COLLAPSE_LINES = 3
const userExpanded = ref(false)
const userLineCount = computed(() => (props.message.content ?? '').split('\n').length)
const userNeedsCollapse = computed(() => isUser.value && userLineCount.value > USER_COLLAPSE_LINES)
const effectiveExpanded = computed(() => userExpanded.value)

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

/** 非文件写入的其他工具调用（含 awaiting 态的 write_file，让审批条可见） */
const otherToolCalls = computed(() =>
  (props.message.toolCalls ?? []).filter(
    tc => tc.name !== 'write_file' || tc.status !== 'success',
  )
)

/** 只读 / 信息类工具：以 Context Pill 形式紧凑展示 */
const READONLY_TOOLS = new Set(['read_file', 'list_directory', 'search_files', 'web_fetch', 'web_search'])
const contextPills = computed(() =>
  otherToolCalls.value.filter(tc => READONLY_TOOLS.has(tc.name) && tc.approvalState !== 'awaiting'),
)
/** 其余工具（含审批等待的 write_file / bash / todo_write 等）走完整卡片 */
const fullToolCalls = computed(() =>
  otherToolCalls.value.filter(tc => !READONLY_TOOLS.has(tc.name) || tc.approvalState === 'awaiting'),
)

/** Pill 点击 → 展开为完整卡片：把对应 toolCall id 加到强制展开集合 */
const expandedPillIds = ref<Set<string>>(new Set())
function expandPill(id: string) {
  const next = new Set(expandedPillIds.value)
  next.add(id)
  expandedPillIds.value = next
}
const remainingPills = computed(() =>
  contextPills.value.filter(tc => !expandedPillIds.value.has(tc.id)),
)
const promotedPillCalls = computed(() =>
  contextPills.value.filter(tc => expandedPillIds.value.has(tc.id)),
)

/** 将连续同名工具调用聚合为 group，减少垂直空间 */
interface PillGroup {
  name: string
  calls: typeof contextPills.value
}
const pillGroups = computed<PillGroup[]>(() => {
  const groups: PillGroup[] = []
  for (const tc of remainingPills.value) {
    const last = groups[groups.length - 1]
    if (last && last.name === tc.name) last.calls.push(tc)
    else groups.push({ name: tc.name, calls: [tc] })
  }
  return groups
})

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

/** 用户消息也走 markdown 渲染（列表、加粗、行内代码） */
const userRenderedSegments = computed(() =>
  contentSegments.value.map(seg => ({
    ...seg,
    html: seg.type === 'text' ? renderBlock(seg.content) : '',
  }))
)

/** 缓存 Markdown 渲染结果，避免每帧重算 */
const renderedSegments = computed(() =>
  contentSegments.value.map(seg => ({
    ...seg,
    html: seg.type === 'text' ? renderBlock(seg.content) : '',
  }))
)

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

  return DOMPurify.sanitize(out.join(''), { ADD_ATTR: ['target'] })
}
</script>

<template>
  <!-- ==================== 用户消息 ==================== -->
  <div v-if="isUser" :class="stickyCompact ? 'my-0 ai-prose' : 'my-3 ai-prose'">
    <div
      class="rounded-xl border border-white/[0.04]"
      :class="stickyCompact ? 'bg-background shadow-[0_2px_8px_rgba(0,0,0,0.4)]' : 'bg-white/[0.03]'"
      style="padding: 10px 14px;"
    >
      <!-- 吸顶极简态：单行省略 + 展开按钮 -->
      <div v-if="stickyCompact" class="flex items-center gap-2">
        <span class="text-[12px] text-foreground/80 truncate flex-1 leading-tight">{{ message.content }}</span>
        <button
          class="shrink-0 flex items-center gap-0.5 text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors ml-1"
          title="展开完整提问"
          @click.stop="userExpanded = !userExpanded"
        >
          <ChevronRight class="h-3 w-3" :class="userExpanded ? 'rotate-90' : 'rotate-0'" />
        </button>
      </div>

      <!-- 吸顶展开态（点击展开按钮后） -->
      <div
        v-if="stickyCompact && userExpanded"
        class="mt-2 text-[13px] text-foreground/85 leading-[1.65] select-text border-t border-white/[0.04] pt-2"
      >
        <template v-for="(seg, i) in userRenderedSegments" :key="i">
          <div v-if="seg.type === 'text'" v-html="seg.html" />
        </template>
      </div>

      <!-- 普通态 -->
      <template v-else-if="!stickyCompact">
        <!-- 用户消息：走 markdown 渲染（解析列表、加粗、行内代码） -->
        <div
          class="text-[13px] text-foreground leading-[1.65] select-text transition-[max-height] duration-200"
          :style="userNeedsCollapse && !effectiveExpanded ? { maxHeight: '3.5em', overflow: 'hidden' } : { maxHeight: 'none' }"
        >
          <template v-for="(seg, i) in userRenderedSegments" :key="i">
            <div v-if="seg.type === 'text'" v-html="seg.html" />
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
        <!-- 展开 / 收起按钮（右对齐，独立行，无负边距遮挡） -->
        <div v-if="userNeedsCollapse" class="relative z-[1] flex justify-end mt-1.5">
          <button
            class="cursor-pointer flex items-center gap-1 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
            @click.stop="userExpanded = !userExpanded"
          >
            <ChevronRight class="h-3 w-3 transition-transform duration-150" :class="effectiveExpanded ? '-rotate-90' : 'rotate-90'" />
            {{ effectiveExpanded ? '收起' : `展开全部（${userLineCount} 行）` }}
          </button>
        </div>
      </template>
    </div>
  </div>

  <!-- ==================== 错误消息 ==================== -->
  <div v-else-if="isError" class="my-1">
    <div class="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2.5">
      <AlertCircle class="h-4 w-4 text-destructive shrink-0 mt-0.5" />
      <div class="flex-1 text-[13px] text-destructive leading-relaxed select-text">
        <div>{{ message.content }}</div>
        <!-- max_tokens 截断一键修复 -->
        <div v-if="isMaxTokensTruncated" class="mt-2 flex items-center gap-1.5 flex-wrap">
          <span class="text-[11px] text-destructive/70">一键调大：</span>
          <button
            v-for="v in [16384, 32768, 65536, 131072]"
            :key="v"
            class="rounded-md border border-destructive/30 bg-background/60 px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/10 transition-colors font-mono"
            :title="`把当前模型 maxOutput 调到 ${v.toLocaleString()} token 并重新生成`"
            @click="emit('bumpMaxOutput', v)"
          >
            {{ v >= 1024 ? (v / 1024) + 'K' : v }}
          </button>
        </div>
      </div>
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
  <div
    v-else
    class="group ai-prose relative"
    :class="inGroup ? 'my-0' : 'my-1'"
    v-memo="[message.id, message.isStreaming, message.toolCalls?.length, message.content?.length, message.notice?.text, hideHeader, isGroupEnd]"
  >
    <!-- 左侧轨道竖线（组内条目持续存在） -->
    <div v-if="inGroup" class="timeline-track" :class="isGroupEnd ? 'timeline-track--end' : ''" />

    <!-- 状态节点圆点 -->
    <div
      class="timeline-dot"
      :class="message.isStreaming ? 'timeline-dot--streaming' : 'timeline-dot--done'"
    />

    <!-- 操作按钮（hover 才显，右上角） -->
    <div class="absolute right-1 top-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <span v-if="message.tokens" class="text-[9px] text-muted-foreground/25 font-mono mr-1">{{ message.tokens }}t</span>
      <span v-if="message.saveStatus === 'error'" class="text-[9px] text-destructive/60 font-mono mr-1" title="消息持久化失败">⚠</span>
      <button
        v-if="!message.isStreaming && message.content"
        class="p-1 rounded hover:bg-muted text-muted-foreground/30 hover:text-muted-foreground"
        title="导出 .md"
        @click="exportMarkdown"
      >
        <Download class="h-3.5 w-3.5" />
      </button>
      <button
        v-if="!message.isStreaming && message.content"
        class="p-1 rounded hover:bg-muted text-muted-foreground/30 hover:text-muted-foreground"
        :title="copied ? '已复制' : '复制'"
        @click="copyContent"
      >
        <component :is="copied ? Check : Copy" class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- 内容区（固定左侧缩进 26px，与轨道线对齐） -->
    <div class="pl-[26px] pr-1">
      <!-- 思考过程（原生 <details> 无 JS 开销） -->
      <details v-if="hasThinking" class="mb-1.5 group/thinking">
        <summary class="flex items-center gap-1.5 text-[11px] text-muted-foreground/35 hover:text-muted-foreground/55 transition-colors cursor-pointer list-none select-none italic">
          <ChevronRight class="h-3 w-3 transition-transform duration-200 group-open/thinking:rotate-90 not-italic" />
          <span>思考过程</span>
        </summary>
        <div class="mt-1 pl-3 border-l border-muted-foreground/10 text-[11px] text-muted-foreground/30 italic leading-relaxed whitespace-pre-wrap max-h-[180px] overflow-y-auto">
          {{ message.thinking }}
        </div>
      </details>

      <!-- 流式光标 -->
      <div v-if="message.isStreaming && !message.content" class="flex items-center gap-2 py-1.5">
        <span class="flex gap-[4px] items-end">
          <span class="thinking-dot" style="animation-delay: 0ms" />
          <span class="thinking-dot" style="animation-delay: 160ms" />
          <span class="thinking-dot" style="animation-delay: 320ms" />
        </span>
        <span class="text-[11px] text-muted-foreground/55 tracking-wide">思考中</span>
      </div>

      <!-- 消息内容（组内非首条弱化颜色，让胶囊成为视觉焦点） -->
      <div
        v-if="message.content"
        class="text-[13px] leading-[1.65] select-text"
        :class="hideHeader ? 'text-muted-foreground/55' : 'text-foreground/90'"
      >
        <template v-for="(seg, i) in renderedSegments" :key="i">
          <div v-if="seg.type === 'text'" v-html="seg.html" />
          <AiCodeBlock v-else-if="seg.type === 'code'" :language="seg.language" :code="seg.content" :is-streaming="message.isStreaming" class="my-1.5" />
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

      <!-- 工具调用块 -->
      <div v-if="hasToolCalls" class="mt-2.5 space-y-1.5">
        <!-- 文件操作组（聚合 write_file 为毛玻璃卡片组） -->
        <AiFileOpsGroup
          v-if="fileOperations.length > 0"
          :operations="fileOperations"
          :session-id="sessionId"
        />

        <!-- 只读工具胶囊条（聚合连续同名调用） -->
        <div v-if="pillGroups.length" class="flex flex-wrap gap-2 mt-0.5">
          <template v-for="group in pillGroups" :key="group.name + group.calls[0]?.id">
            <!-- 多个同名：显示"工具 ×N"的第一个胶囊 + 数量徽章 -->
            <div v-if="group.calls.length > 1" class="flex items-center gap-0.5">
              <AiContextPill
                :tool-call="group.calls[0]!"
                :count="group.calls.length"
                @open="group.calls.forEach(c => expandPill(c.id))"
              />
            </div>
            <!-- 单个正常渲染 -->
            <AiContextPill
              v-else
              :tool-call="group.calls[0]!"
              @open="expandPill(group.calls[0]!.id)"
            />
          </template>
        </div>

        <!-- 被点开的胶囊 → 完整卡片 -->
        <div v-if="promotedPillCalls.length" class="space-y-1">
          <AiToolCallBlock
            v-for="tc in promotedPillCalls"
            :key="tc.id"
            :tool-call="tc"
            :session-id="sessionId"
          />
        </div>

        <!-- 其他工具调用（审批等待 / bash / todo_write 等，始终完整卡片） -->
        <div v-if="fullToolCalls.length" class="space-y-1">
          <AiToolCallBlock
            v-for="tc in fullToolCalls"
            :key="tc.id"
            :tool-call="tc"
            :session-id="sessionId"
          />
        </div>
      </div>

      <!-- 系统提示横幅（工具超限 / 流被中断等） -->
      <div
        v-if="message.notice"
        class="mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] leading-relaxed"
        :class="{
          'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300': message.notice.kind === 'warn',
          'border-destructive/30 bg-destructive/8 text-destructive': message.notice.kind === 'error',
          'border-sky-500/30 bg-sky-500/8 text-sky-700 dark:text-sky-300': message.notice.kind === 'info',
        }"
      >
        <component
          :is="message.notice.kind === 'warn' ? AlertTriangle : message.notice.kind === 'error' ? AlertCircle : Info"
          class="h-3.5 w-3.5 shrink-0 mt-0.5"
        />
        <span class="select-text">{{ message.notice.text }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 流式看门狗圆点跳动 */
.thinking-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: oklch(0.696 0.17 162.48 / 0.75); /* emerald-500 */
  animation: thinking-bounce 1s ease-in-out infinite;
}

@keyframes thinking-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40%           { transform: translateY(-4px); opacity: 1; }
}

/* 左侧隐形轨道线 */
.timeline-track {
  position: absolute;
  left: calc(1rem + 2px); /* 16px + 圆点中轴对齐 */
  top: 14px;              /* 从圆点底部开始 */
  bottom: -4px;           /* 延伸连接下一条 */
  width: 1px;
  background: rgba(255, 255, 255, 0.08);
  z-index: 1;
}

/* 最后一条：轨道线稍短，不要穿出去 */
.timeline-track--end {
  bottom: 4px;
}

/* 状态节点圆点 */
.timeline-dot {
  position: absolute;
  left: calc(1rem - 1px); /* 圆点中心在 16px 处 */
  top: 5px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  z-index: 2;
}

/* 已完成：极暗灰 */
.timeline-dot--done {
  background: rgba(255, 255, 255, 0.12);
}

/* 流式中：亮绿色呼吸发光 */
.timeline-dot--streaming {
  background: oklch(0.696 0.17 162.48); /* emerald-500 */
  box-shadow: 0 0 0 3px oklch(0.696 0.17 162.48 / 0.2);
  animation: dot-pulse 1.6s ease-in-out infinite;
}

@keyframes dot-pulse {
  0%, 100% { box-shadow: 0 0 0 2px oklch(0.696 0.17 162.48 / 0.15); }
  50%       { box-shadow: 0 0 0 5px oklch(0.696 0.17 162.48 / 0.25); }
}
</style>
