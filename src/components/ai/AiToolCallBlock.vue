<script setup lang="ts">
/**
 * AI 工具调用展示组件
 *
 * 折叠卡片样式，显示工具名 + 参数摘要 + 执行状态 + 结果预览。
 */
import { ref, computed, watch } from 'vue'
import type { ToolCallInfo, FileOperation } from '@/types/ai'
import { ChevronRight, Loader2, CheckCircle2, XCircle, Wrench, ExternalLink, Eye, Copy } from 'lucide-vue-next'
import AiCodeBlock from './AiCodeBlock.vue'
import AiFileOpCard from './AiFileOpCard.vue'
import AiTodoPanel from './AiTodoPanel.vue'
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

const expanded = ref(false)

/** write_file / read_file 成功时自动展开 */
watch(
  () => props.toolCall.status,
  (newStatus, oldStatus) => {
    if (
      oldStatus === 'running' &&
      newStatus === 'success' &&
      (props.toolCall.name === 'write_file' || props.toolCall.name === 'read_file')
    ) {
      expanded.value = true
    }
  },
)

/** 工具显示名称 */
const toolDisplayName = computed(() => {
  const map: Record<string, string> = {
    read_file: '读取文件',
    list_directory: '列出目录',
    search_files: '搜索文件',
    write_file: '写入文件',
    edit_file: '编辑文件',
    bash: '执行命令',
    web_search: '网页搜索',
    web_fetch: '抓取网页',
    todo_write: '任务清单',
  }
  return map[props.toolCall.name] ?? props.toolCall.name
})

/** 参数摘要（取第一个有意义的参数值） */
const argsSummary = computed(() => {
  const args = props.toolCall.parsedArgs
  if (!args) return props.toolCall.arguments.slice(0, 80)

  // 按工具类型提取关键参数
  switch (props.toolCall.name) {
    case 'read_file':
      return (args.path as string) ?? ''
    case 'list_directory':
      return (args.path as string) ?? ''
    case 'search_files':
      return `"${args.pattern}" in ${args.directory}`
    case 'write_file':
      return (args.path as string) ?? ''
    case 'edit_file':
      return (args.path as string) ?? ''
    case 'bash': {
      const cmd = (args.command as string) ?? ''
      return cmd.length > 80 ? cmd.slice(0, 80) + '…' : cmd
    }
    case 'todo_write': {
      const todos = (args.todos as Array<{ status: string }> | undefined) ?? []
      const done = todos.filter(t => t.status === 'completed').length
      return `${done}/${todos.length} 已完成`
    }
    case 'web_search':
      return (args.query as string) ?? ''
    case 'web_fetch':
      return (args.url as string) ?? ''
    default:
      return JSON.stringify(args).slice(0, 80)
  }
})

/** 状态颜色 */
const statusClass = computed(() => {
  switch (props.toolCall.status) {
    case 'pending': return 'text-muted-foreground/50'
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

async function openFullResult() {
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
 * 截断后的预览内容（大文件只显示前 100 行）
 */
const truncatedPreview = computed(() => {
  const content = filePreviewContent.value
  if (!content) return { text: '', truncated: false, totalLines: 0 }
  const lines = content.split('\n')
  if (lines.length > 200) {
    return {
      text: lines.slice(0, 100).join('\n'),
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
</script>

<template>
  <div class="my-1 rounded-md border border-border/30 bg-muted/10 overflow-hidden">
    <!-- 头部（点击展开） -->
    <button
      class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/20 transition-colors"
      @click="expanded = !expanded"
    >
      <ChevronRight
        class="h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform duration-200"
        :class="{ 'rotate-90': expanded }"
      />

      <!-- 状态图标 -->
      <Loader2
        v-if="toolCall.status === 'running'"
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

      <!-- 工具名 -->
      <span class="text-[11px] font-medium" :class="statusClass">
        {{ toolDisplayName }}
      </span>

      <!-- 参数摘要 -->
      <span class="text-[11px] text-muted-foreground/40 truncate flex-1">
        {{ argsSummary }}
      </span>

      <!-- 状态文字 -->
      <span
        v-if="toolCall.status === 'running'"
        class="text-[10px] text-blue-500/60 shrink-0"
      >执行中...</span>
    </button>

    <!-- 展开内容 -->
    <div v-if="expanded" class="border-t border-border/20">
      <!-- ===== todo_write：任务清单面板 ===== -->
      <template v-if="toolCall.name === 'todo_write' && Array.isArray(toolCall.parsedArgs?.todos)">
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

      <!-- ===== read_file 成功态：代码高亮预览 ===== -->
      <template v-else-if="toolCall.name === 'read_file' && toolCall.status === 'success'">
        <!-- 打开文件按钮（仅 write_file 且有绝对路径） -->
        <div v-if="toolCall.name === 'write_file' && absoluteFilePath" class="flex items-center justify-end px-3 py-1.5">
          <button
            class="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="用系统默认程序打开"
            @click.stop="handleOpenFile"
          >
            <ExternalLink class="h-3 w-3" />
            <span>打开文件</span>
          </button>
        </div>
        <!-- 代码高亮预览 -->
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
            ... 共 {{ truncatedPreview.totalLines }} 行，已截断显示前 100 行
          </div>
        </div>
      </template>

      <!-- ===== 其他工具 / 非成功状态：保持原有 <pre> 展示 ===== -->
      <template v-else>
        <div class="px-3 py-2">
          <!-- 参数 -->
          <div class="mb-1.5">
            <div class="text-[10px] font-medium text-muted-foreground/40 mb-0.5">参数</div>
            <pre class="text-[11px] text-foreground/60 font-mono whitespace-pre-wrap overflow-x-auto max-h-[120px] overflow-y-auto">{{ JSON.stringify(toolCall.parsedArgs ?? toolCall.arguments, null, 2) }}</pre>
          </div>
          <!-- 结果 -->
          <div v-if="toolCall.result || toolCall.error">
            <div class="text-[10px] font-medium mb-0.5" :class="toolCall.error ? 'text-destructive/60' : 'text-muted-foreground/40'">
              {{ toolCall.error ? '错误' : '结果' }}
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
        </div>
      </template>
    </div>
  </div>

  <!-- 查看完整落盘结果对话框 -->
  <Dialog v-model:open="showFullDialog">
    <DialogContent class="max-w-3xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 text-base">
          📦 完整工具结果
          <span class="text-xs font-mono font-normal text-muted-foreground">{{ toolCall.name }} · {{ toolCall.id }}</span>
        </DialogTitle>
        <DialogDescription class="text-xs">
          从磁盘读取完整落盘内容
          <span v-if="persistedInfo.totalChars">（{{ persistedInfo.totalChars.toLocaleString() }} 字符）</span>
        </DialogDescription>
      </DialogHeader>
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
        >{{ fullContent }}</pre>
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="outline" size="sm" :disabled="!fullContent || fullLoading" @click="copyFull">
          <Copy class="mr-1 h-3.5 w-3.5" />
          {{ copiedFull ? '已复制' : '复制' }}
        </Button>
        <Button size="sm" @click="showFullDialog = false">关闭</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
