<script setup lang="ts">
/**
 * 文件附件预览条 — 输入框上方的文件芯片列表
 *
 * 显示已选文件的名称、大小、读取状态，支持移除操作。
 */
import type { FileAttachment } from '@/types/ai'
import { File, X, Loader2, AlertCircle, Image } from 'lucide-vue-next'

defineProps<{
  attachments: FileAttachment[]
}>()

const emit = defineEmits<{
  remove: [id: string]
}>()

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes === 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div v-if="attachments.length > 0" class="flex flex-wrap gap-1.5 px-3 pt-2 pb-1">
    <div
      v-for="file in attachments"
      :key="file.id"
      class="group relative flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors"
      :class="{
        'border-border/50 bg-muted/30 text-foreground/80': file.status === 'ready',
        'border-amber-500/30 bg-amber-500/5 text-amber-600': file.status === 'reading',
        'border-destructive/30 bg-destructive/5 text-destructive': file.status === 'error',
      }"
    >
      <!-- 图片预览或图标 -->
      <div class="relative">
        <Loader2
          v-if="file.status === 'reading'"
          class="h-3 w-3 shrink-0 animate-spin text-amber-500"
        />
        <AlertCircle
          v-else-if="file.status === 'error'"
          class="h-3 w-3 shrink-0 text-destructive"
        />
        <div
          v-else-if="file.type === 'image' && file.content"
          class="h-6 w-6 shrink-0 rounded overflow-hidden border border-border/50"
          :title="file.name"
        >
          <img
            :src="file.content"
            :alt="file.name"
            class="h-full w-full object-cover"
          />
        </div>
        <Image
          v-else-if="file.type === 'image'"
          class="h-3 w-3 shrink-0 text-blue-500"
        />
        <File v-else class="h-3 w-3 shrink-0 text-muted-foreground" />
      </div>

      <!-- 文件名 -->
      <span class="max-w-[140px] truncate" :title="file.path">{{ file.name }}</span>

      <!-- 大小 -->
      <span v-if="file.size > 0" class="text-[10px] text-muted-foreground/60">
        {{ formatSize(file.size) }}
      </span>

      <!-- 错误提示 -->
      <span v-if="file.error" class="text-[10px] text-destructive/80 max-w-[120px] truncate" :title="file.error">
        {{ file.error }}
      </span>

      <!-- 删除按钮 -->
      <button
        class="ml-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted/50 transition-all"
        title="移除"
        @click="emit('remove', file.id)"
      >
        <X class="h-2.5 w-2.5" />
      </button>
    </div>
  </div>
</template>
