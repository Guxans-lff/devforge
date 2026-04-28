import type { ProviderConfig } from '@/types/ai'

export type CapabilityState = 'full' | 'partial' | 'none'

export interface ProviderCapabilityRow {
  providerId: string
  providerName: string
  providerType: string
  modelCount: number
  streaming: CapabilityState
  vision: CapabilityState
  thinking: CapabilityState
  toolUse: CapabilityState
  maxContext: number
  maxOutput: number
  permissionMode: 'strict' | 'normal'
  notes: string[]
}

function summarizeBool(values: boolean[]): CapabilityState {
  if (values.length === 0) return 'none'
  if (values.every(Boolean)) return 'full'
  if (values.some(Boolean)) return 'partial'
  return 'none'
}

export function buildProviderCapabilityMatrix(
  providers: ProviderConfig[],
  options?: { strictPermission?: boolean },
): ProviderCapabilityRow[] {
  const strictPermission = options?.strictPermission ?? false

  return providers.map((provider) => {
    const models = provider.models ?? []
    const toolUse = summarizeBool(models.map(model => model.capabilities.toolUse))
    const thinking = summarizeBool(models.map(model => model.capabilities.thinking))
    const vision = summarizeBool(models.map(model => model.capabilities.vision))
    const streaming = summarizeBool(models.map(model => model.capabilities.streaming))
    const maxContext = models.reduce((max, model) => Math.max(max, model.capabilities.maxContext || 0), 0)
    const maxOutput = models.reduce((max, model) => Math.max(max, model.capabilities.maxOutput || 0), 0)
    const notes: string[] = []

    if (models.length === 0) notes.push('未配置模型')
    if (toolUse === 'none') notes.push('不支持工具调用')
    if (thinking === 'none') notes.push('不支持 Thinking')
    if (vision === 'none') notes.push('不支持图片输入')
    if (strictPermission && toolUse !== 'none') notes.push('工具调用会受严格权限确认约束')
    if (maxContext > 0 && maxContext < 32000) notes.push('上下文窗口偏小')

    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.providerType,
      modelCount: models.length,
      streaming,
      vision,
      thinking,
      toolUse,
      maxContext,
      maxOutput,
      permissionMode: strictPermission ? 'strict' : 'normal',
      notes,
    }
  })
}

export function capabilityStateLabel(state: CapabilityState): string {
  switch (state) {
    case 'full': return '全部支持'
    case 'partial': return '部分支持'
    default: return '不支持'
  }
}
