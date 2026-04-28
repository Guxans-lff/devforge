/**
 * Plan Parser — 从 AI 输出的 markdown 文本解析结构化 Plan
 *
 * 支持多种步骤列表格式，失败时回退到单步骤 Plan。
 */

import type { AiPlanStep, CreateAiPlanOptions } from '@/types/plan'

export interface ParsedPlan {
  title: string
  description?: string
  steps: Omit<AiPlanStep, 'id'>[]
  relatedFiles: string[]
}

// ─────────────────────────── 正则模式 ───────────────────────────

/** 步骤标题模式（按优先级排序） */
const STEP_PATTERNS = [
  // ### Step 1: Title
  // ### 1. Title
  { regex: /^#{3,4}\s*(?:Step\s*)?(\d+)[\.:\)]\s*(.+)$/i, extract: (m: RegExpExecArray) => ({ index: Number(m[1]) - 1, title: m[2]!.trim() }) },
  // **1. Title** (whole line bold)
  { regex: /^\*\*\s*(?:Step\s*)?(\d+)[\.:\)]\s*(.+?)\*\*$/, extract: (m: RegExpExecArray) => ({ index: Number(m[1]) - 1, title: m[2]!.trim() }) },
  // **Step 1:** Title
  { regex: /^\*\*\s*(?:Step\s*)?(\d+)[\.:\)]\s*\*\*\s*(.+)$/, extract: (m: RegExpExecArray) => ({ index: Number(m[1]) - 1, title: m[2]!.trim() }) },
  // - Step 1: Title
  // - Step 1. Title
  // - 1. Title
  { regex: /^[-*]\s*(?:Step\s*)?(\d+)[\.:\)]\s*(.+)$/, extract: (m: RegExpExecArray) => ({ index: Number(m[1]) - 1, title: m[2]!.trim() }) },
  // 1. Title
  // 1) Title
  { regex: /^(\d+)[\.\)]\s*(.+)$/, extract: (m: RegExpExecArray) => ({ index: Number(m[1]) - 1, title: m[2]!.trim() }) },
  // - Title（无序号，按出现顺序编号）
  { regex: /^[-*]\s*(.+)$/, extract: (m: RegExpExecArray, fallbackIndex: number) => ({ index: fallbackIndex, title: m[1]!.trim() }) },
]

/** 提取标题行（第一行非空文本） */
function extractTitle(lines: string[]): string {
  const firstNonEmpty = lines.find(line => line.trim().length > 0)
  if (!firstNonEmpty) return 'Untitled Plan'
  // 去掉 markdown 标题标记
  return firstNonEmpty.trim().replace(/^#+\s*/, '').replace(/\*\*/g, '').slice(0, 100)
}

/** 提取描述（标题后的段落，直到步骤列表开始） */
function extractDescription(lines: string[]): string | undefined {
  const titleIndex = lines.findIndex(line => line.trim().length > 0)
  if (titleIndex === -1) return undefined

  const descLines: string[] = []
  for (let i = titleIndex + 1; i < lines.length; i++) {
    const line = lines[i]!
    // 遇到步骤列表开始，停止
    if (isStepLine(line)) break
    // 跳过空行，但如果已经收集到内容则保留空行
    if (line.trim().length === 0 && descLines.length > 0) {
      descLines.push(line)
      continue
    }
    if (line.trim().length > 0) {
      descLines.push(line)
    }
  }

  const result = descLines.join('\n').trim()
  return result.length > 0 ? result : undefined
}

/** 判断一行是否是步骤标题 */
function isStepLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0) return false
  return STEP_PATTERNS.some(p => p.regex.test(trimmed))
}

/** 匹配步骤标题 */
function matchStepLine(line: string, fallbackIndex: number): { index: number; title: string } | null {
  const trimmed = line.trim()
  for (const pattern of STEP_PATTERNS) {
    const match = pattern.regex.exec(trimmed)
    if (match) {
      return pattern.extract(match, fallbackIndex)
    }
  }
  return null
}

/** 提取相关文件路径 */
function extractRelatedFiles(text: string): string[] {
  const files: string[] = []
  // 匹配 `path/to/file.ext` 或 "path/to/file.ext" 或 'path/to/file.ext'
  const codeBlockPattern = /`([^`]+\.[a-zA-Z0-9]+)`/g
  const quotePattern = /["']([^"']+\.[a-zA-Z0-9]+)["']/g

  let m: RegExpExecArray | null
  while ((m = codeBlockPattern.exec(text)) !== null) {
    const path = m[1]!
    if (path.includes('/') || path.includes('\\')) {
      files.push(path)
    }
  }
  while ((m = quotePattern.exec(text)) !== null) {
    const path = m[1]!
    if (path.includes('/') || path.includes('\\')) {
      files.push(path)
    }
  }

  return [...new Set(files)]
}

// ─────────────────────────── 核心解析 ───────────────────────────

/**
 * 从 markdown 文本解析 Plan
 *
 * @param text AI 输出的计划文本
 * @returns 解析结果，失败时返回单步骤回退
 */
export function parsePlanFromText(text: string): ParsedPlan {
  const lines = text.split('\n')
  const title = extractTitle(lines)
  const description = extractDescription(lines)

  const steps: Omit<AiPlanStep, 'id'>[] = []
  let currentStep: Omit<AiPlanStep, 'id'> | null = null
  let currentDescriptionLines: string[] = []
  let stepCounter = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const stepMatch = matchStepLine(line, stepCounter)

    if (stepMatch) {
      // 保存上一个步骤的描述
      if (currentStep) {
        const desc = currentDescriptionLines.join('\n').trim()
        if (desc.length > 0) {
          currentStep.description = desc
        }
        steps.push(currentStep)
      }

      currentStep = {
        index: stepMatch.index,
        title: stepMatch.title,
        status: 'pending',
      }
      currentDescriptionLines = []
      stepCounter = stepMatch.index + 1
    } else if (currentStep && line.trim().length > 0) {
      // 收集步骤描述（缩进的正文）
      currentDescriptionLines.push(line.trimStart())
    }
  }

  // 保存最后一个步骤
  if (currentStep) {
    const desc = currentDescriptionLines.join('\n').trim()
    if (desc.length > 0) {
      currentStep.description = desc
    }
    steps.push(currentStep)
  }

  // 若未解析到任何步骤，回退到单步骤
  if (steps.length === 0) {
    steps.push({
      index: 0,
      title: title,
      status: 'pending',
    })
  }

  // 按 index 排序并重新编号
  steps.sort((a, b) => a.index - b.index)
  steps.forEach((step, i) => { step.index = i })

  return {
    title,
    description,
    steps,
    relatedFiles: extractRelatedFiles(text),
  }
}

/**
 * 将 ParsedPlan 转换为 CreateAiPlanOptions
 */
export function toCreatePlanOptions(parsed: ParsedPlan, sessionId: string): CreateAiPlanOptions {
  return {
    sessionId,
    title: parsed.title,
    description: parsed.description,
    steps: parsed.steps,
    relatedFiles: parsed.relatedFiles,
  }
}
