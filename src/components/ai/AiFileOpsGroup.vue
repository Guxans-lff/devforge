<script setup lang="ts">
/**
 * AI 文件操作卡片组 — Apply / Reject
 *
 * write_file 已在工具执行时写入磁盘，并保存了写入前快照。
 * - Apply  → 用 plugin-opener 唤起外部编辑器查看文件（不再重复写盘）
 * - Reject → 调 ai_revert_write_file 通过快照回滚（删除新建 / 写回原文）
 */
import { computed } from 'vue'
import { openPath } from '@tauri-apps/plugin-opener'
import type { FileOperation } from '@/types/ai'
import AiFileOpCard from './AiFileOpCard.vue'
import { aiRevertWriteFile } from '@/api/ai'
import { Check } from 'lucide-vue-next'

const props = defineProps<{
  operations: FileOperation[]
  sessionId?: string
}>()

const emit = defineEmits<{
  'update:operations': [ops: FileOperation[]]
}>()

const hasPending = computed(() =>
  props.operations.some(op => op.status === 'pending')
)

function shouldAutoExpand(op: FileOperation): boolean {
  if (op.op === 'create') return true
  if (!op.oldContent || !op.newContent) return false
  const oldLines = op.oldContent.split('\n').length
  const newLines = op.newContent.split('\n').length
  return Math.abs(newLines - oldLines) >= 3 || op.op === 'delete'
}

/** Apply：唤起系统默认编辑器（VSCode 等）查看文件 */
async function handleApply(op: FileOperation) {
  try {
    await openPath(op.path)
    updateOpStatus(op.toolCallId, 'applied')
  } catch (e) {
    updateOpStatus(op.toolCallId, 'error', String(e))
  }
}

/** Reject：通过写入前快照回滚 */
async function handleReject(op: FileOperation) {
  if (!props.sessionId) {
    updateOpStatus(op.toolCallId, 'error', '缺少 sessionId，无法回滚')
    return
  }
  try {
    await aiRevertWriteFile(props.sessionId, op.toolCallId, op.path)
    updateOpStatus(op.toolCallId, 'rejected')
  } catch (e) {
    updateOpStatus(op.toolCallId, 'error', String(e))
  }
}

function updateOpStatus(toolCallId: string, status: FileOperation['status'], errorMessage?: string) {
  const updated = props.operations.map(op =>
    op.toolCallId === toolCallId ? { ...op, status, errorMessage } : op
  )
  emit('update:operations', updated)
}

async function acceptAll() {
  for (const op of props.operations) {
    if (op.status === 'pending') await handleApply(op)
  }
}

async function rejectAll() {
  for (const op of props.operations) {
    if (op.status === 'pending') await handleReject(op)
  }
}
</script>

<template>
  <div class="space-y-2">
    <AiFileOpCard
      v-for="op in operations"
      :key="op.toolCallId"
      :op="op"
      :auto-expand="shouldAutoExpand(op)"
      @apply="handleApply"
      @reject="handleReject"
    />

    <!-- 多文件时显示批量操作按钮 -->
    <div v-if="hasPending && operations.length > 1" class="flex gap-2 pt-1">
      <button
        class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[10px] text-[11px] font-medium transition-colors"
        style="background: linear-gradient(135deg, rgba(74,222,128,0.12), rgba(74,222,128,0.06)); border: 1px solid rgba(74,222,128,0.15); color: #4ade80;"
        @click="acceptAll"
      >
        <Check class="w-3 h-3" />
        Accept All
      </button>
      <button
        class="px-4 py-2 rounded-[10px] text-[11px] text-muted-foreground/40 transition-colors"
        style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);"
        @click="rejectAll"
      >Reject All</button>
    </div>
  </div>
</template>
