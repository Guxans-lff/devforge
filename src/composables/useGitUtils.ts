/**
 * Git 模块共享工具函数
 * 提取自 GitFileList / GitDiffViewer / GitView 中的重复逻辑
 */
import { FilePlus, FileX, FileEdit, AlertTriangle } from 'lucide-vue-next'
import type { FunctionalComponent } from 'vue'

/** 文件变更状态 → Tailwind 颜色 class */
export function gitStatusColor(status: string): string {
  switch (status) {
    case 'added': return 'text-df-success'
    case 'deleted': return 'text-destructive'
    case 'modified': return 'text-df-warning'
    case 'conflicted': return 'text-df-warning'
    default: return 'text-muted-foreground'
  }
}

/** 文件变更状态 → lucide 图标组件 */
export function gitStatusIcon(status: string): FunctionalComponent {
  switch (status) {
    case 'added': return FilePlus as unknown as FunctionalComponent
    case 'deleted': return FileX as unknown as FunctionalComponent
    case 'modified': return FileEdit as unknown as FunctionalComponent
    case 'conflicted': return AlertTriangle as unknown as FunctionalComponent
    default: return FileEdit as unknown as FunctionalComponent
  }
}

/** Unix 时间戳（秒）→ 本地完整时间字符串 */
export function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

/** Unix 时间戳（秒）→ 相对时间（Xm / Xh / Xd / 日期） */
export function formatRelativeTime(ts: number): string {
  const d = new Date(ts * 1000)
  const diff = Date.now() - d.getTime()
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`
  if (diff < 2592000000) return `${Math.floor(diff / 86400000)}d`
  return d.toLocaleDateString()
}

/** Unix 时间戳（秒）→ YYYY-MM-DD 日期格式 */
export function formatDate(ts: number): string {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
