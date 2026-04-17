<script setup lang="ts">
/**
 * AI 工具写操作审批对话框
 *
 * 全局挂载一份；监听 `useToolApproval` 的 pending 状态自动弹出。
 * 按钮："允许一次" / "信任此路径（会话内）" / "拒绝"
 */
import { computed } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { FileText, Terminal, Pencil, ShieldCheck, ShieldX, Shield, Globe } from 'lucide-vue-next'
import { usePendingApproval, resolveApproval } from '@/composables/useToolApproval'

const pending = usePendingApproval()

const open = computed({
  get: () => pending.value !== null,
  // DialogContent 背景点击或 ESC 会触发 false；一律当拒绝处理
  set: (v: boolean) => {
    if (!v && pending.value) resolveApproval('deny')
  },
})

const toolLabel = computed(() => {
  switch (pending.value?.toolName) {
    case 'write_file': return '写入文件'
    case 'edit_file': return '编辑文件'
    case 'bash': return '执行命令'
    case 'web_fetch': return '抓取网页'
    default: return '工具调用'
  }
})

const ToolIcon = computed(() => {
  switch (pending.value?.toolName) {
    case 'bash': return Terminal
    case 'edit_file': return Pencil
    case 'web_fetch': return Globe
    default: return FileText
  }
})

const previewLines = computed(() => {
  const txt = pending.value?.preview ?? ''
  const lines = txt.split('\n')
  if (lines.length > 40) {
    return lines.slice(0, 40).join('\n') + `\n… (共 ${lines.length} 行，已截断)`
  }
  return txt
})

const oldPreviewLines = computed(() => {
  const txt = pending.value?.oldPreview ?? ''
  if (!txt) return ''
  const lines = txt.split('\n')
  if (lines.length > 20) return lines.slice(0, 20).join('\n') + `\n… (共 ${lines.length} 行)`
  return txt
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-2xl" @interact-outside.prevent>
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 text-base">
          <component :is="ToolIcon" class="h-4 w-4 text-amber-500" />
          {{ toolLabel }} — 需要确认
        </DialogTitle>
        <DialogDescription class="text-xs">
          AI 即将执行以下操作，请大哥过目后决定是否放行
        </DialogDescription>
      </DialogHeader>

      <div v-if="pending" class="space-y-3">
        <div class="rounded border border-border/50 bg-muted/20 px-3 py-2">
          <div class="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
            {{ pending.targetLabel }}
          </div>
          <code class="break-all font-mono text-xs">{{ pending.target }}</code>
        </div>

        <div v-if="pending.oldPreview" class="rounded border border-border/50">
          <div class="border-b border-border/50 bg-rose-500/5 px-3 py-1 text-[10px] font-medium text-rose-500">
            原内容（被替换）
          </div>
          <pre class="max-h-[120px] overflow-auto px-3 py-2 text-[11px] font-mono whitespace-pre-wrap text-foreground/70">{{ oldPreviewLines }}</pre>
        </div>

        <div class="rounded border border-border/50">
          <div class="border-b border-border/50 bg-emerald-500/5 px-3 py-1 text-[10px] font-medium text-emerald-500">
            {{ pending.toolName === 'bash' ? '命令' : pending.toolName === 'web_fetch' ? 'URL' : (pending.oldPreview ? '新内容' : '新文件内容') }}
          </div>
          <pre class="max-h-[260px] overflow-auto px-3 py-2 text-[11px] font-mono whitespace-pre-wrap text-foreground/80">{{ previewLines }}</pre>
        </div>
      </div>

      <div class="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" @click="resolveApproval('deny')">
          <ShieldX class="mr-1 h-3.5 w-3.5" /> 拒绝
        </Button>
        <Button variant="secondary" size="sm" @click="resolveApproval('trust')">
          <Shield class="mr-1 h-3.5 w-3.5" /> 信任并允许
        </Button>
        <Button size="sm" @click="resolveApproval('allow')">
          <ShieldCheck class="mr-1 h-3.5 w-3.5" /> 允许一次
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
