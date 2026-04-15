<script setup lang="ts">
/**
 * AI 工具调用展示组件
 *
 * 折叠卡片样式，显示工具名 + 参数摘要 + 执行状态 + 结果预览。
 */
import { ref, computed, watch } from 'vue'
import type { ToolCallInfo } from '@/types/ai'
import { ChevronRight, Loader2, CheckCircle2, XCircle, Wrench, ExternalLink } from 'lucide-vue-next'
import AiCodeBlock from './AiCodeBlock.vue'
import { inferLanguageFromPath } from '@/utils/file-markers'
import { openPath } from '@tauri-apps/plugin-opener'

const props = defineProps<{
  toolCall: ToolCallInfo
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
      <!-- ===== write_file / read_file 专属展示 ===== -->
      <template v-if="isFileOp && toolCall.status === 'success'">
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
            <pre
              class="text-[11px] font-mono whitespace-pre-wrap overflow-x-auto max-h-[200px] overflow-y-auto"
              :class="toolCall.error ? 'text-destructive/70' : 'text-foreground/60'"
            >{{ resultPreview }}</pre>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
