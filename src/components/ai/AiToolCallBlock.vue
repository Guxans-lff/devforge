<script setup lang="ts">
/**
 * AI 工具调用展示组件
 *
 * 折叠卡片样式，显示工具名 + 参数摘要 + 执行状态 + 结果预览。
 */
import { ref, computed, watch } from 'vue'
import type { ToolCallInfo, FileOperation } from '@/types/ai'
import { ChevronRight, Loader2, CheckCircle2, XCircle, Wrench, ExternalLink, Eye, Copy, Maximize2 } from 'lucide-vue-next'
import AiCodeBlock from './AiCodeBlock.vue'
import AiFileOpCard from './AiFileOpCard.vue'
import AiTodoPanel from './AiTodoPanel.vue'
import AiApprovalDialog from './AiApprovalDialog.vue'
import { inferLanguageFromPath } from '@/utils/file-markers'
import { openPath } from '@tauri-apps/plugin-opener'
import { aiReadToolResultFile } from '@/api/ai'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  toolCall: ToolCallInfo
  sessionId?: string
}>()

const expanded = ref(
  props.toolCall.name === 'todo_write' ||
  props.toolCall.approvalState === 'awaiting',
)

/** write_file 成功时自动展开；read_file 保持收起（用户点开或直接点"打开文件"） */
watch(
  () => props.toolCall.status,
  (newStatus, oldStatus) => {
    if (
      oldStatus === 'running' &&
      newStatus === 'success' &&
      props.toolCall.name === 'write_file'
    ) {
      expanded.value = true
    }
  },
)

/** 动作动词（语义化） */
const actionLabel = computed(() => {
  const map: Record<string, string> = {
    read_file: 'Read',
    write_file: 'Write',
    edit_file: 'Edit',
    bash: 'Bash',
    search_files: 'Search',
    list_directory: 'List',
    web_search: 'Search',
    web_fetch: 'Fetch',
    todo_write: 'Todo',
  }
  return map[props.toolCall.name] ?? props.toolCall.name
})

/** 动作语义色 */
const actionColor = computed(() => {
  switch (props.toolCall.name) {
    case 'write_file': return 'text-emerald-400'
    case 'edit_file':  return 'text-amber-400'
    case 'bash':       return 'text-blue-400'
    case 'todo_write': return 'text-purple-400'
    default:           return 'text-foreground/75'
  }
})

/** 操作目标（文件名 / 命令 / 查询词） */
const targetLabel = computed(() => {
  const args = props.toolCall.parsedArgs
  if (!args) return props.toolCall.arguments.slice(0, 60)
  switch (props.toolCall.name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'list_directory': {
      const p = (args.path as string) ?? ''
      return p.split(/[/\\]/).pop() || p || '…'
    }
    case 'bash': {
      const cmd = (args.command as string) ?? ''
      return cmd.length > 60 ? cmd.slice(0, 60) + '…' : cmd
    }
    case 'search_files':
      return `"${args.pattern}" in ${args.directory ?? '.'}`
    case 'web_search':
      return String(args.query ?? '').slice(0, 50) || '…'
    case 'web_fetch': {
      const u = String(args.url ?? '')
      try { return new URL(u).hostname }
      catch { return u.slice(0, 50) || '…' }
    }
    case 'todo_write': {
      const todos = (args.todos as Array<{ status: string }> | undefined) ?? []
      const done = todos.filter(t => t.status === 'completed').length
      return `${done}/${todos.length} 已完成`
    }
    default:
      return JSON.stringify(args).slice(0, 60)
  }
})

/** 附加元信息（行数范围等） */
const metaLabel = computed(() => {
  if (props.toolCall.name === 'read_file') {
    const args = props.toolCall.parsedArgs
    if (args?.offset !== undefined || args?.limit !== undefined) {
      const offset = Number(args?.offset ?? 0)
      const limit = Number(args?.limit ?? '?')
      return `(${offset + 1}–${typeof args?.limit !== 'undefined' ? offset + limit : '…'})`
    }
    // 从结果首行提取行数
    const result = props.toolCall.result ?? ''
    const m = result.match(/\|\s*(\d+)\s*行\s*\|/)
    if (m) return `(${m[1]} 行)`
  }
  return ''
})


/** 状态颜色 */
const statusClass = computed(() => {
  switch (props.toolCall.status) {
    case 'pending': return 'text-muted-foreground/50'
    case 'streaming': return 'text-blue-500'
    case 'running': return 'text-blue-500'
    case 'success': return 'text-emerald-500'
    case 'error': return 'text-destructive'
    default: return 'text-muted-foreground/50'
  }
})

/** 结果预览（截断到前 20 行） */
const resultPreview = computed(() => {
  const content = props.toolCall.result ?? props.toolCall.error ?? ''
  const lines = content.split('\n')
  if (lines.length > 20) {
    return lines.slice(0, 20).join('\n') + `\n... (共 ${lines.length} 行)`
  }
  return content
})

/** 是否为已落盘的大型结果（含 <persisted-output> 包装标签） */
const isPersisted = computed(() => {
  const content = props.toolCall.result ?? ''
  return content.includes('<persisted-output>')
})

/** 从落盘包装中解析出总字符数和文件路径 */
const persistedInfo = computed(() => {
  const content = props.toolCall.result ?? ''
  const sizeMatch = content.match(/Output too large \((\d+) chars\)/)
  const pathMatch = content.match(/saved to:\s+(.+)/)
  return {
    totalChars: sizeMatch ? Number(sizeMatch[1]) : 0,
    filepath: pathMatch ? pathMatch[1].trim() : '',
  }
})

// ───────── 查看完整结果（弹窗） ─────────
const showFullDialog = ref(false)
const fullLoading = ref(false)
const fullContent = ref('')
const fullError = ref('')
const copiedFull = ref(false)
const fullSearchQuery = ref('')

async function openFullResult() {
  // 非落盘结果：直接把 result 放进 Dialog
  if (!isPersisted.value) {
    fullContent.value = props.toolCall.result ?? props.toolCall.error ?? ''
    fullError.value = ''
    showFullDialog.value = true
    return
  }
  if (!props.sessionId) {
    fullError.value = '会话上下文缺失，无法加载'
    showFullDialog.value = true
    return
  }
  showFullDialog.value = true
  fullLoading.value = true
  fullError.value = ''
  fullContent.value = ''
  try {
    fullContent.value = await aiReadToolResultFile(props.sessionId, props.toolCall.id)
  } catch (e: unknown) {
    fullError.value = e instanceof Error ? e.message : String(e)
  } finally {
    fullLoading.value = false
  }
}

async function copyFull() {
  try {
    await navigator.clipboard.writeText(fullContent.value)
    copiedFull.value = true
    setTimeout(() => (copiedFull.value = false), 1500)
  } catch (e) {
    console.warn('[AI] 复制失败:', e)
  }
}

/** 是否为文件操作工具（write_file / read_file） */
const isFileOp = computed(() =>
  props.toolCall.name === 'write_file' || props.toolCall.name === 'read_file',
)

/** 工具的文件路径（从 parsedArgs 中提取，可能是相对路径） */
const filePath = computed(() =>
  (props.toolCall.parsedArgs?.path as string) ?? '',
)

/** 推断的语言标识符 */
const inferredLang = computed(() =>
  filePath.value ? inferLanguageFromPath(filePath.value) : 'text',
)

/**
 * 文件操作的代码预览内容
 * - write_file: 直接取 parsedArgs.content
 * - read_file: 从 result 中剥离元数据头 `[文件: ... | N 行 | X KB]`
 */
const filePreviewContent = computed(() => {
  if (props.toolCall.name === 'write_file') {
    return (props.toolCall.parsedArgs?.content as string) ?? ''
  }
  if (props.toolCall.name === 'read_file' && props.toolCall.result) {
    // 剥离第一行元数据：[文件: path | N 行 | X KB]
    const result = props.toolCall.result
    const firstNewline = result.indexOf('\n')
    if (firstNewline > 0 && result.startsWith('[文件:')) {
      return result.slice(firstNewline + 1)
    }
    return result
  }
  return ''
})

/**
 * 将 write_file 成功态的 toolCall 转为 FileOperation 对象，供 AiFileOpCard 渲染
 * 仅在 write_file 成功时有值，其他工具或执行中时返回 null
 */
const fileOperation = computed<FileOperation | null>(() => {
  if (!isFileOp.value || props.toolCall.name !== 'write_file') return null
  if (props.toolCall.status !== 'success') return null
  const args = props.toolCall.parsedArgs
  return {
    op: 'modify',
    path: (args?.path as string) ?? '',
    fileName: ((args?.path as string) ?? '').split(/[/\\]/).pop() ?? '',
    newContent: (args?.content as string) ?? '',
    status: 'pending',
    toolCallId: props.toolCall.id,
  }
})

/**
 * 截断后的预览内容
 * - read_file：仅显示前 5 行摘要（对齐 Claude Code CLI 的 "Read N lines" 风格），
 *   用户想看完整内容点右上"打开文件"按钮
 * - 其他：保持前 100 行
 */
const truncatedPreview = computed(() => {
  const content = filePreviewContent.value
  if (!content) return { text: '', truncated: false, totalLines: 0 }
  const lines = content.split('\n')
  const headLines = props.toolCall.name === 'read_file' ? 5 : 100
  const threshold = props.toolCall.name === 'read_file' ? 5 : 200
  if (lines.length > threshold) {
    return {
      text: lines.slice(0, headLines).join('\n'),
      truncated: true,
      totalLines: lines.length,
    }
  }
  return { text: content, truncated: false, totalLines: lines.length }
})

/**
 * 从 write_file 结果中提取绝对路径
 * 后端返回格式: "已创建 D:\xxx\hello.ts (123 字节)" 或 "已更新 ..."
 */
const absoluteFilePath = computed(() => {
  const result = props.toolCall.result ?? ''
  const match = result.match(/^(?:已创建|已更新)\s+(.+?)\s+\(/)
  return match?.[1] ?? ''
})

/**
 * read_file 的绝对路径：从结果首行元信息 `[文件: <abs> | N 行 | ...]` 提取
 * 若提取失败（结果尚未到达），回落到参数里的 path（可能是相对路径）
 */
const readFileAbsPath = computed(() => {
  if (props.toolCall.name !== 'read_file') return ''
  const result = props.toolCall.result ?? ''
  const m = result.match(/^\[文件:\s+(.+?)\s+\|/)
  if (m?.[1]) return m[1]
  return (props.toolCall.parsedArgs?.path as string) ?? ''
})

/** 用系统默认程序打开 read_file 的目标文件 */
async function handleOpenReadFile() {
  const path = readFileAbsPath.value
  if (!path) return
  try {
    await openPath(path)
  } catch (e) {
    console.error('[AI] 打开文件失败:', e)
  }
}

/** 用系统默认程序打开文件 */
async function handleOpenFile() {
  const path = absoluteFilePath.value
  if (!path) return
  try {
    await openPath(path)
  } catch (e) {
    console.error('[AI] 打开文件失败:', e)
  }
}

/**
 * 审批匹配键：与 useToolApproval.requestApproval 的 trustKey 规则保持一致
 * - bash      → command 字面
 * - web_fetch → url
 * - 其他（write_file/edit_file） → path
 */
const approvalMatchKey = computed<string>(() => {
  // 兜底：流式累积期间 parsedArgs 可能尚未赋值，尝试解析 arguments 字符串
  const args = props.toolCall.parsedArgs
    ?? (() => {
      try { return JSON.parse(props.toolCall.arguments || '{}') as Record<string, unknown> }
      catch { return {} }
    })()
  if (props.toolCall.name === 'bash') return String(args.command ?? '').trim()
  if (props.toolCall.name === 'web_fetch') return String(args.url ?? '').trim()
  return String(args.path ?? '').trim()
})

/** 是否处于审批等待中（用于内嵌渲染 AiApprovalDialog） */
const isAwaitingApproval = computed(() => props.toolCall.approvalState === 'awaiting')
/** 审批已决策的留痕徽章 */
const approvalBadge = computed(() => {
  switch (props.toolCall.approvalState) {
    case 'allowed': return { text: '已允许', cls: 'text-emerald-500/80 bg-emerald-500/10' }
    case 'denied':  return { text: '已拒绝', cls: 'text-rose-500/80 bg-rose-500/10' }
    default: return null
  }
})

/** 有审批条要展示时，头部折叠箭头禁用（避免误折叠掩盖审批入口） */
watch(isAwaitingApproval, (v) => { if (v) expanded.value = true }, { immediate: true })
</script>

<template>
  <div class="my-1 rounded-md border border-border/25 bg-muted/8 overflow-hidden">
    <!-- 头部（点击展开） -->
    <button
      class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.03]"
      @click="expanded = !expanded"
    >
      <ChevronRight
        class="h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform duration-200"
        :class="{ 'rotate-90': expanded }"
      />

      <!-- 状态图标 -->
      <Loader2
        v-if="toolCall.status === 'running' || toolCall.status === 'streaming'"
        class="h-3.5 w-3.5 shrink-0 animate-spin"
        :class="statusClass"
      />
      <CheckCircle2
        v-else-if="toolCall.status === 'success'"
        class="h-3.5 w-3.5 shrink-0"
        :class="statusClass"
      />
      <XCircle
        v-else-if="toolCall.status === 'error'"
        class="h-3.5 w-3.5 shrink-0"
        :class="statusClass"
      />
      <Wrench
        v-else
        class="h-3.5 w-3.5 shrink-0 text-muted-foreground/40"
      />

      <!-- 动作动词：加粗语义色 -->
      <span class="text-[11px] font-bold font-mono shrink-0" :class="[actionColor]">{{ actionLabel }}</span>

      <!-- 文件名/目标：可点击打开（仅文件操作 + 有绝对路径时） -->
      <button
        v-if="(toolCall.name === 'write_file' && absoluteFilePath) || (toolCall.name === 'read_file' && readFileAbsPath)"
        class="text-[11px] font-mono text-foreground/70 hover:text-primary truncate max-w-[260px] transition-colors"
        :title="filePath"
        @click.stop="toolCall.name === 'write_file' ? handleOpenFile() : handleOpenReadFile()"
      >{{ targetLabel }}</button>
      <span v-else class="text-[11px] font-mono text-foreground/60 truncate flex-1">{{ targetLabel }}</span>

      <!-- 行数/元信息 -->
      <span v-if="metaLabel" class="text-[10px] font-mono text-muted-foreground/35 shrink-0">{{ metaLabel }}</span>

      <!-- 审批状态徽章（allowed / denied 留痕） -->
      <span
        v-if="approvalBadge"
        class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
        :class="approvalBadge.cls"
      >{{ approvalBadge.text }}</span>

      <!-- 审批等待提示 -->
      <span
        v-else-if="isAwaitingApproval"
        class="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500/80"
      >等待确认</span>

      <!-- 状态文字 -->
      <span
        v-if="toolCall.status === 'streaming'"
        class="text-[10px] text-blue-500/60 shrink-0"
      >生成参数中 {{ toolCall.streamingChars ?? 0 }} 字符…</span>
      <span
        v-else-if="toolCall.status === 'running'"
        class="text-[10px] text-blue-500/60 shrink-0"
      >执行中...</span>
    </button>

    <!-- 展开内容 -->
    <div v-if="expanded" class="border-t border-border/20">
      <!-- ===== 审批等待：独占渲染（不再与下方分支叠加） ===== -->
      <template v-if="isAwaitingApproval">
        <AiApprovalDialog embedded />
      </template>
      <!-- ===== todo_write：任务清单面板 ===== -->
      <template v-else-if="toolCall.name === 'todo_write' && Array.isArray(toolCall.parsedArgs?.todos)">
        <div class="px-1 pb-1 pt-1">
          <AiTodoPanel :todos="(toolCall.parsedArgs!.todos as any)" />
        </div>
      </template>

      <!-- ===== write_file 成功态：毛玻璃文件操作卡片 ===== -->
      <template v-else-if="toolCall.name === 'write_file' && toolCall.status === 'success' && fileOperation">
        <div class="px-1 pb-1 pt-1">
          <AiFileOpCard
            :op="fileOperation"
            :auto-expand="true"
            @apply="() => {}"
            @reject="() => {}"
          />
        </div>
      </template>

      <!-- ===== read_file 成功态：前 5 行摘要 + 打开文件按钮 ===== -->
      <template v-else-if="toolCall.name === 'read_file' && toolCall.status === 'success'">
        <!-- 打开文件按钮 -->
        <div v-if="readFileAbsPath" class="flex items-center justify-end px-3 py-1.5">
          <button
            class="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="用系统默认程序打开"
            @click.stop="handleOpenReadFile"
          >
            <ExternalLink class="h-3 w-3" />
            <span>打开文件</span>
          </button>
        </div>
        <!-- 代码摘要（前 5 行） -->
        <div v-if="truncatedPreview.text" class="px-1 pb-1">
          <AiCodeBlock
            :language="inferredLang"
            :code="truncatedPreview.text"
            :show-actions="false"
          />
          <div
            v-if="truncatedPreview.truncated"
            class="px-3 py-1 text-[10px] text-muted-foreground/50 text-center"
          >
            … 共 {{ truncatedPreview.totalLines }} 行，已折叠 — 点击"打开文件"查看完整
          </div>
        </div>
      </template>

      <!-- ===== 其他：只渲染结果/错误，不再渲染参数 JSON ===== -->
      <template v-else>
        <div v-if="toolCall.result || toolCall.error" class="px-3 py-2">
          <div class="flex items-center justify-between mb-0.5">
            <div class="text-[10px] font-medium" :class="toolCall.error ? 'text-destructive/60' : 'text-muted-foreground/40'">
              {{ toolCall.error ? '错误' : '结果' }}
            </div>
            <button
              v-if="toolCall.result || toolCall.error"
              class="text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors p-0.5 rounded"
              title="全屏查看"
              @click.stop="openFullResult"
            >
              <Maximize2 class="h-3 w-3" />
            </button>
          </div>
          <!-- 落盘提示 badge -->
          <div
            v-if="isPersisted"
            class="mb-1.5 flex items-center gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[10px] text-amber-600 dark:text-amber-400"
          >
            <span class="font-semibold">📦 结果过大已落盘</span>
            <span class="font-mono">{{ persistedInfo.totalChars.toLocaleString() }} 字符</span>
            <span
              v-if="persistedInfo.filepath"
              class="truncate font-mono text-muted-foreground/70"
              :title="persistedInfo.filepath"
            >· {{ persistedInfo.filepath }}</span>
            <button
              type="button"
              class="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium hover:bg-amber-500/10"
              @click.stop="openFullResult"
            >
              <Eye class="h-3 w-3" /> 查看完整
            </button>
          </div>
          <pre
            class="text-[11px] font-mono whitespace-pre-wrap overflow-x-auto max-h-[200px] overflow-y-auto"
            :class="toolCall.error ? 'text-destructive/70' : 'text-foreground/60'"
          >{{ resultPreview }}</pre>
        </div>
        <!-- streaming/running 且无结果：只显一行小提示 -->
        <div v-else class="px-3 py-2 text-[11px] text-muted-foreground/50">
          {{ toolCall.status === 'streaming' ? '参数生成中…' : '执行中…' }}
        </div>
      </template>
    </div>
  </div>

  <!-- 查看完整结果对话框 -->
  <Dialog v-model:open="showFullDialog">
    <DialogContent class="max-w-3xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 text-base">
          🔍 完整工具结果
          <span class="text-xs font-mono font-normal text-muted-foreground">{{ toolCall.name }} · {{ toolCall.id }}</span>
        </DialogTitle>
        <DialogDescription class="text-xs">
          <span v-if="persistedInfo.totalChars">落盘内容（{{ persistedInfo.totalChars.toLocaleString() }} 字符）</span>
          <span v-else>{{ fullContent.length.toLocaleString() }} 字符</span>
        </DialogDescription>
      </DialogHeader>
      <!-- 搜索框 -->
      <input
        v-model="fullSearchQuery"
        type="text"
        placeholder="搜索结果内容…"
        class="w-full rounded-md border border-border/60 bg-muted/20 px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
      />
      <div class="min-h-[200px]">
        <div v-if="fullLoading" class="flex items-center justify-center py-8 text-sm text-muted-foreground">
          <Loader2 class="mr-2 h-4 w-4 animate-spin" /> 加载中…
        </div>
        <div v-else-if="fullError" class="rounded border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {{ fullError }}
        </div>
        <pre
          v-else
          class="max-h-[60vh] overflow-auto rounded border border-border bg-muted/30 p-3 text-[11px] font-mono whitespace-pre-wrap"
        >{{ fullSearchQuery ? fullContent.split('\n').filter(l => l.toLowerCase().includes(fullSearchQuery.toLowerCase())).join('\n') : fullContent }}</pre>
      </div>
      <div class="flex items-center justify-between">
        <span v-if="fullSearchQuery" class="text-[10px] text-muted-foreground/60 font-mono">
          {{ fullContent.split('\n').filter(l => l.toLowerCase().includes(fullSearchQuery.toLowerCase())).length }} 行匹配
        </span>
        <div class="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" :disabled="!fullContent || fullLoading" @click="copyFull">
            <Copy class="mr-1 h-3.5 w-3.5" />
            {{ copiedFull ? '已复制' : '复制' }}
          </Button>
          <Button size="sm" @click="showFullDialog = false">关闭</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
