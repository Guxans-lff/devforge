/**
 * 文件附件管理 composable
 *
 * 处理文件选择（dialog）、拖拽、读取、预览列表状态。
 * 复用已有的 localReadFileContent 命令读取文件。
 */

import { ref, computed } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { localReadFileContent } from '@/api/file-editor'
import { isTextFile, MAX_FILE_SIZE, estimateTokens } from '@/utils/file-markers'
import type { FileAttachment } from '@/types/ai'
import { ensureErrorString } from '@/types/error'

/** 生成唯一 ID */
function genId(): string {
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function useFileAttachment() {
  const attachments = ref<FileAttachment[]>([])

  /** 是否有附件 */
  const hasAttachments = computed(() => attachments.value.length > 0)

  /** 所有附件是否已就绪 */
  const allReady = computed(() =>
    attachments.value.every(f => f.status === 'ready'),
  )

  /** 估算所有附件的 token 总量 */
  const totalAttachmentTokens = computed(() =>
    attachments.value.reduce((sum, f) => sum + estimateTokens(f.content ?? ''), 0),
  )

  /**
   * 通过 Tauri dialog 选择文件
   */
  async function selectFiles(): Promise<void> {
    const result = await open({
      multiple: true,
      filters: [{ name: '文本文件', extensions: ['*'] }],
    })
    if (!result) return

    const paths = Array.isArray(result) ? result : [result]
    for (const filePath of paths) {
      await addFile(filePath)
    }
  }

  /**
   * 处理拖拽放入的文件路径列表
   */
  async function handleDrop(paths: string[]): Promise<void> {
    for (const filePath of paths) {
      await addFile(filePath)
    }
  }

  /**
   * 添加单个文件附件
   */
  async function addFile(filePath: string): Promise<void> {
    const name = filePath.split(/[\\/]/).pop() ?? filePath

    // 检查扩展名
    if (!isTextFile(name)) {
      attachments.value = [...attachments.value, {
        id: genId(),
        name,
        path: filePath,
        size: 0,
        status: 'error',
        error: '不支持的文件类型，仅支持文本文件',
      }]
      return
    }

    // 检查重复
    if (attachments.value.some(f => f.path === filePath && f.status !== 'error')) {
      return
    }

    const attachment: FileAttachment = {
      id: genId(),
      name,
      path: filePath,
      size: 0,
      status: 'reading',
    }
    attachments.value = [...attachments.value, attachment]

    // 异步读取文件内容
    try {
      const content = await localReadFileContent(filePath, MAX_FILE_SIZE)
      const size = new TextEncoder().encode(content).length

      if (size > MAX_FILE_SIZE) {
        updateAttachment(attachment.id, {
          status: 'error',
          error: `文件过大（${formatSize(size)}），上限 10MB`,
          size,
        })
        return
      }

      const lines = content.split('\n').length
      updateAttachment(attachment.id, {
        status: 'ready',
        content,
        size,
        lines,
      })
    } catch (e) {
      updateAttachment(attachment.id, {
        status: 'error',
        error: ensureErrorString(e),
      })
    }
  }

  /** 更新单个附件状态 */
  function updateAttachment(id: string, patch: Partial<FileAttachment>): void {
    attachments.value = attachments.value.map(f =>
      f.id === id ? { ...f, ...patch } : f,
    )
  }

  /** 移除附件 */
  function removeAttachment(id: string): void {
    attachments.value = attachments.value.filter(f => f.id !== id)
  }

  /** 清空所有附件 */
  function clearAttachments(): void {
    attachments.value = []
  }

  /** 获取已就绪的附件列表（用于发送） */
  function getReadyAttachments(): FileAttachment[] {
    return attachments.value.filter(f => f.status === 'ready')
  }

  return {
    attachments,
    hasAttachments,
    allReady,
    totalAttachmentTokens,
    selectFiles,
    handleDrop,
    removeAttachment,
    clearAttachments,
    getReadyAttachments,
  }
}

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
