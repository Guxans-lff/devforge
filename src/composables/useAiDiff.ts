/**
 * AI Diff 计算 — 基于 jsdiff
 *
 * 提供行级对齐 + 字符级差异高亮数据
 */
import { diffLines, diffChars, type Change } from 'diff'

/** 单行 diff 信息 */
export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed' | 'empty'
  content: string
  lineNumber: number | null
  /** 字符级差异片段（仅 added/removed 行） */
  charDiffs?: CharDiff[]
}

/** 字符级差异 */
export interface CharDiff {
  value: string
  type: 'unchanged' | 'added' | 'removed'
}

/** 并排 Diff 结果 */
export interface SideBySideDiff {
  left: DiffLine[]
  right: DiffLine[]
  stats: { added: number; removed: number }
}

/**
 * 计算并排 Diff（左旧右新，行对齐）
 */
export function computeSideBySideDiff(oldText: string, newText: string): SideBySideDiff {
  const changes = diffLines(oldText, newText)
  const left: DiffLine[] = []
  const right: DiffLine[] = []
  let leftLineNum = 1
  let rightLineNum = 1
  let added = 0
  let removed = 0

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    const lines = change.value.replace(/\n$/, '').split('\n')

    if (!change.added && !change.removed) {
      for (const line of lines) {
        left.push({ type: 'unchanged', content: line, lineNumber: leftLineNum++ })
        right.push({ type: 'unchanged', content: line, lineNumber: rightLineNum++ })
      }
    } else if (change.removed) {
      const next = changes[i + 1]
      if (next?.added) {
        const removedLines = lines
        const addedLines = next.value.replace(/\n$/, '').split('\n')
        const maxLen = Math.max(removedLines.length, addedLines.length)

        for (let j = 0; j < maxLen; j++) {
          if (j < removedLines.length && j < addedLines.length) {
            const charChanges = diffChars(removedLines[j], addedLines[j])
            const leftChars = charChanges.filter(c => !c.added).map(c => ({
              value: c.value, type: (c.removed ? 'removed' : 'unchanged') as CharDiff['type'],
            }))
            const rightChars = charChanges.filter(c => !c.removed).map(c => ({
              value: c.value, type: (c.added ? 'added' : 'unchanged') as CharDiff['type'],
            }))
            left.push({ type: 'removed', content: removedLines[j], lineNumber: leftLineNum++, charDiffs: leftChars })
            right.push({ type: 'added', content: addedLines[j], lineNumber: rightLineNum++, charDiffs: rightChars })
          } else if (j < removedLines.length) {
            left.push({ type: 'removed', content: removedLines[j], lineNumber: leftLineNum++ })
            right.push({ type: 'empty', content: '', lineNumber: null })
          } else {
            left.push({ type: 'empty', content: '', lineNumber: null })
            right.push({ type: 'added', content: addedLines[j], lineNumber: rightLineNum++ })
          }
        }
        removed += removedLines.length
        added += addedLines.length
        i++
      } else {
        for (const line of lines) {
          left.push({ type: 'removed', content: line, lineNumber: leftLineNum++ })
          right.push({ type: 'empty', content: '', lineNumber: null })
          removed++
        }
      }
    } else if (change.added) {
      for (const line of lines) {
        left.push({ type: 'empty', content: '', lineNumber: null })
        right.push({ type: 'added', content: line, lineNumber: rightLineNum++ })
        added++
      }
    }
  }

  return { left, right, stats: { added, removed } }
}

/**
 * 计算 mini diff（简化的增删行列表，限制行数）
 */
export function computeMiniDiff(
  oldText: string,
  newText: string,
  maxLines = 10,
): { lines: { type: 'added' | 'removed'; content: string }[]; truncated: number } {
  const changes = diffLines(oldText, newText)
  const lines: { type: 'added' | 'removed'; content: string }[] = []

  for (const change of changes) {
    if (change.added || change.removed) {
      const type = change.added ? 'added' as const : 'removed' as const
      const changeLines = change.value.replace(/\n$/, '').split('\n')
      for (const line of changeLines) {
        lines.push({ type, content: line })
      }
    }
  }

  if (lines.length <= maxLines) return { lines, truncated: 0 }
  return { lines: lines.slice(0, maxLines), truncated: lines.length - maxLines }
}
