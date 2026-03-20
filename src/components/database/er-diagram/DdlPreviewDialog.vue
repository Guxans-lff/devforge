<script setup lang="ts">
/**
 * DDL 预览对话框 — 建模模式
 *
 * 展示生成的 MySQL DDL SQL，支持复制到剪贴板。
 */
import { ref, computed } from 'vue'
import { Copy, Check } from 'lucide-vue-next'
import type { ModelProject } from '@/types/er-modeling'
import { generateProjectDdl } from '@/composables/useModelDdlGenerator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  /** 是否打开 */
  open: boolean
  /** 当前项目 */
  project: ModelProject
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

/** 复制成功状态 */
const copied = ref(false)

/** 生成的 DDL */
const ddl = computed(() => generateProjectDdl(props.project))

/** 复制到剪贴板 */
async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(ddl.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // 降级方案
    const textarea = document.createElement('textarea')
    textarea.value = ddl.value
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
}

function handleOpenChange(val: boolean) {
  emit('update:open', val)
}
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent class="max-w-3xl max-h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>DDL 预览</DialogTitle>
        <DialogDescription>
          {{ project.name }} — MySQL DDL 脚本（共 {{ project.tables.length }} 张表）
        </DialogDescription>
      </DialogHeader>

      <!-- DDL 代码区 -->
      <div class="flex-1 min-h-0 overflow-auto rounded-md border border-border bg-muted/20 p-4">
        <pre class="text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">{{ ddl }}</pre>
      </div>

      <DialogFooter class="gap-2">
        <Button variant="outline" size="sm" @click="handleOpenChange(false)">
          关闭
        </Button>
        <Button size="sm" class="gap-1.5" @click="copyToClipboard">
          <component :is="copied ? Check : Copy" class="h-3.5 w-3.5" />
          {{ copied ? '已复制' : '复制到剪贴板' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
