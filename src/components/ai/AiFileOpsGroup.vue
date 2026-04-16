<script setup lang="ts">
/**
 * AI 文件操作卡片组 — Accept All / Reject All
 *
 * 将多个文件操作卡片聚合展示，提供批量确认/拒绝按钮。
 * @props operations - FileOperation 列表
 * @emits update:operations - 更新操作状态
 */
import { computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { FileOperation } from '@/types/ai'
import AiFileOpCard from './AiFileOpCard.vue'
import { Check } from 'lucide-vue-next'

const props = defineProps<{
  operations: FileOperation[]
}>()

const emit = defineEmits<{
  'update:operations': [ops: FileOperation[]]
}>()

/** 是否还有待确认的操作 */
const hasPending = computed(() =>
  props.operations.some(op => op.status === 'pending')
)

/**
 * 是否自动展开 mini diff
 * - 新建文件：自动展开
 * - 删除文件：自动展开
 * - 行数变化 ≥ 3：自动展开
 */
function shouldAutoExpand(op: FileOperation): boolean {
  if (op.op === 'create') return true
  if (!op.oldContent || !op.newContent) return false
  const oldLines = op.oldContent.split('\n').length
  const newLines = op.newContent.split('\n').length
  return Math.abs(newLines - oldLines) >= 3 || op.op === 'delete'
}

/**
 * 应用单个文件操作（写入/删除文件）
 * @param op 文件操作对象
 */
async function handleApply(op: FileOperation) {
  try {
    if (op.op === 'modify' && op.oldContent) {
      try {
        const currentContent: string = await invoke('local_read_file_content', { path: op.path })
        if (currentContent !== op.oldContent) {
          const ok = confirm(`文件 ${op.fileName} 已被外部修改，是否强制覆盖？`)
          if (!ok) return
        }
      } catch {
        // 文件可能不存在（新建场景），继续执行
      }
    }

    if (op.op !== 'delete' && op.newContent !== undefined) {
      await invoke('ws_create_file', { path: op.path, content: op.newContent })
    } else if (op.op === 'delete') {
      await invoke('ws_delete_entry', { path: op.path, permanent: false })
    }

    updateOpStatus(op.toolCallId, 'applied')
  } catch (e) {
    updateOpStatus(op.toolCallId, 'error', String(e))
  }
}

/**
 * 拒绝单个文件操作（还原文件内容）
 * @param op 文件操作对象
 */
async function handleReject(op: FileOperation) {
  try {
    if (op.op === 'modify' && op.oldContent) {
      // 还原旧内容
      await invoke('ws_create_file', { path: op.path, content: op.oldContent })
    } else if (op.op === 'create') {
      try {
        // 新建文件被拒绝则删除
        await invoke('ws_delete_entry', { path: op.path, permanent: false })
      } catch {
        // 文件可能已不存在，忽略错误
      }
    }
    updateOpStatus(op.toolCallId, 'rejected')
  } catch (e) {
    updateOpStatus(op.toolCallId, 'error', String(e))
  }
}

/**
 * 更新操作状态并通知父组件
 * @param toolCallId 工具调用 ID
 * @param status 新状态
 * @param errorMessage 错误信息（可选）
 */
function updateOpStatus(toolCallId: string, status: FileOperation['status'], errorMessage?: string) {
  const updated = props.operations.map(op =>
    op.toolCallId === toolCallId ? { ...op, status, errorMessage } : op
  )
  emit('update:operations', updated)
}

/** 批量确认所有待处理操作 */
async function acceptAll() {
  for (const op of props.operations) {
    if (op.status === 'pending') {
      await handleApply(op)
    }
  }
}

/** 批量拒绝所有待处理操作 */
async function rejectAll() {
  for (const op of props.operations) {
    if (op.status === 'pending') {
      await handleReject(op)
    }
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
