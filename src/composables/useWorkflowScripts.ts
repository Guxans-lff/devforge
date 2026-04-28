/**
 * Workflow Scripts 加载器
 *
 * 加载内置/项目/用户级 YAML 工作流定义，供 AI 输入区使用。
 * 加载优先级：项目级 > 用户级 > 内置级
 */
import type { AiWorkflowScript, AiWorkflowStep } from '@/types/ai'

const BUILTIN_WORKFLOW_MODULES = import.meta.glob<string>(
  '@/ai/workflows/*.yaml',
  { query: '?raw', import: 'default', eager: true },
)

function parseWorkflowYaml(raw: string, id: string): AiWorkflowScript | null {
  const lines = raw.split('\n')
  let name = id
  let description = ''
  const steps: AiWorkflowStep[] = []

  let currentStep: Partial<AiWorkflowStep> & { promptLines?: string[] } | null = null
  let inPrompt = false
  let promptIndent = 0

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('name:')) {
      name = trimmed.slice('name:'.length).trim()
      continue
    }
    if (trimmed.startsWith('description:')) {
      description = trimmed.slice('description:'.length).trim()
      continue
    }

    // 步骤开始
    const stepMatch = trimmed.match(/^- type:\s*(\w+)$/)
    if (stepMatch) {
      if (currentStep) {
        if (currentStep.promptLines) {
          currentStep.prompt = currentStep.promptLines.join('\n').trim()
          delete currentStep.promptLines
        }
        steps.push(currentStep as AiWorkflowStep)
      }
      currentStep = { type: stepMatch[1] as AiWorkflowStep['type'] }
      inPrompt = false
      continue
    }

    // prompt: 开始（内联或块）
    if (trimmed.startsWith('prompt:') && currentStep) {
      const inline = trimmed.slice('prompt:'.length).trim()
      if (inline === '|') {
        inPrompt = true
        promptIndent = line.indexOf('prompt:')
        currentStep.promptLines = []
      } else {
        currentStep.prompt = inline
        inPrompt = false
      }
      continue
    }

    // command:
    if (trimmed.startsWith('command:') && currentStep) {
      currentStep.command = trimmed.slice('command:'.length).trim()
      continue
    }

    // 块级 prompt 内容
    if (inPrompt && currentStep && currentStep.promptLines) {
      if (trimmed === '' || line.startsWith(' '.repeat(promptIndent + 2)) || line.startsWith('\t')) {
        currentStep.promptLines.push(line)
      } else if (trimmed.startsWith('- type:') || trimmed.startsWith('command:')) {
        // 下一个字段，结束 prompt
        inPrompt = false
        // 回退处理这个字段
        if (trimmed.startsWith('command:')) {
          currentStep.command = trimmed.slice('command:'.length).trim()
        }
      } else {
        currentStep.promptLines.push(line)
      }
    }
  }

  if (currentStep) {
    if (currentStep.promptLines) {
      currentStep.prompt = currentStep.promptLines.join('\n').trim()
      delete currentStep.promptLines
    }
    steps.push(currentStep as AiWorkflowStep)
  }

  if (steps.length === 0) return null

  return { id, name, description, steps }
}

/** 加载内置工作流 */
export function loadBuiltinWorkflows(): AiWorkflowScript[] {
  const results: AiWorkflowScript[] = []
  for (const [path, raw] of Object.entries(BUILTIN_WORKFLOW_MODULES)) {
    const id = path.replace(/^.*\//, '').replace(/\.yaml$/, '')
    const workflow = parseWorkflowYaml(raw, id)
    if (workflow) results.push(workflow)
  }
  return results.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

/** 按 ID 查找工作流 */
export function findWorkflowById(
  workflows: AiWorkflowScript[],
  id: string,
): AiWorkflowScript | undefined {
  return workflows.find(w => w.id === id)
}

/** 获取工作流第一步的可用提示词（用于插入输入框） */
export function getWorkflowFirstPrompt(workflow: AiWorkflowScript): string {
  const first = workflow.steps[0]
  return first?.prompt ?? `开始执行工作流「${workflow.name}」`
}

/** 生成工作流执行摘要（用于显示在会话列表中） */
export function summarizeWorkflow(workflow: AiWorkflowScript): string {
  return `${workflow.name}（${workflow.steps.length} 步）`
}
