/**
 * Provider Adapter 统一接口
 *
 * 前端侧的 Provider 适配层，负责：
 * 1. Provider 配置解析和验证
 * 2. 模型能力查询
 * 3. 请求参数构建（不同 Provider 可能有差异）
 * 4. 流式事件归一化（后端已标准化，前端做二次校验）
 *
 * 注意：实际的协议转换在 Rust 后端完成（openai_compat.rs / anthropic.rs），
 * 前端 ProviderAdapter 主要提供配置和能力查询。
 */

import type { ChatMessage, ChatStreamParams } from '@/api/ai'
import type { ProviderConfig, ModelConfig, ModelCapabilities, AiStreamEvent } from '@/types/ai'

export interface BuildStreamParamsInput {
  sessionId: string
  messages: ChatMessage[]
  provider: ProviderConfig
  model: ModelConfig
  apiKey: string
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  enableTools?: boolean
  thinkingBudget?: number
  responseFormat?: 'json_object'
  prefixCompletion?: boolean
  prefixContent?: string
}

/** Provider 适配器接口 */
export interface ProviderAdapter {
  /** Provider 类型标识 */
  readonly providerType: string

  /** 获取指定模型的配置 */
  getModelConfig(provider: ProviderConfig, modelId: string): ModelConfig | null

  /** 获取指定模型的能力 */
  getCapabilities(provider: ProviderConfig, modelId: string): ModelCapabilities | null

  /** 验证 Provider 配置是否有效 */
  validateConfig(provider: ProviderConfig): string[]

  /** 获取默认模型 ID */
  getDefaultModel(provider: ProviderConfig): string | null

  /** 构建标准流式请求参数 */
  buildChatStreamParams(input: BuildStreamParamsInput): ChatStreamParams

  /** 归一化/校验流式事件 */
  normalizeStreamEvent(event: AiStreamEvent): AiStreamEvent | null
}

/**
 * 通用 Provider 适配器（适用于所有类型）
 *
 * 因为协议转换在后端完成，前端适配器主要提供配置查询。
 */
export class GenericProviderAdapter implements ProviderAdapter {
  readonly providerType: string

  constructor(providerType: string) {
    this.providerType = providerType
  }

  getModelConfig(provider: ProviderConfig, modelId: string): ModelConfig | null {
    return provider.models.find(m => m.id === modelId) ?? null
  }

  getCapabilities(provider: ProviderConfig, modelId: string): ModelCapabilities | null {
    return this.getModelConfig(provider, modelId)?.capabilities ?? null
  }

  validateConfig(provider: ProviderConfig): string[] {
    const errors: string[] = []
    if (!provider.id) errors.push('Provider ID is required')
    if (!provider.name) errors.push('Provider name is required')
    if (!provider.endpoint) errors.push('Endpoint is required')
    if (!provider.models.length) errors.push('At least one model is required')
    return errors
  }

  getDefaultModel(provider: ProviderConfig): string | null {
    return provider.models[0]?.id ?? null
  }

  buildChatStreamParams(input: BuildStreamParamsInput): ChatStreamParams {
    return {
      sessionId: input.sessionId,
      messages: input.messages,
      providerType: this.providerType,
      model: input.model.id,
      apiKey: input.apiKey,
      endpoint: input.provider.endpoint,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      systemPrompt: input.systemPrompt,
      enableTools: input.enableTools,
      thinkingBudget: input.thinkingBudget,
      responseFormat: input.responseFormat,
      prefixCompletion: input.prefixCompletion,
      prefixContent: input.prefixContent,
    }
  }

  normalizeStreamEvent(event: AiStreamEvent): AiStreamEvent | null {
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') return null

    switch (event.type) {
      case 'TextDelta':
        return typeof event.delta === 'string' ? event : null
      case 'ThinkingDelta':
        return typeof event.delta === 'string' ? event : null
      case 'ToolCall':
        return typeof event.id === 'string'
          && typeof event.name === 'string'
          && typeof event.arguments === 'string'
          ? event
          : null
      case 'ToolCallDelta':
        return typeof event.index === 'number' && typeof event.arguments_delta === 'string' ? event : null
      case 'Usage':
        return typeof event.prompt_tokens === 'number' && typeof event.completion_tokens === 'number' ? event : null
      case 'Done':
        return typeof event.finish_reason === 'string' ? event : null
      case 'Error':
        return typeof event.message === 'string' && typeof event.retryable === 'boolean' ? event : null
      default:
        return null
    }
  }
}

export function createProviderStreamEventHandler(
  adapter: ProviderAdapter,
  onEvent: (event: AiStreamEvent) => void,
  onInvalidEvent?: (event: AiStreamEvent) => void,
): (event: AiStreamEvent) => void {
  return (event) => {
    const normalized = adapter.normalizeStreamEvent(event)
    if (!normalized) {
      onInvalidEvent?.(event)
      return
    }
    onEvent(normalized)
  }
}

/** 已注册的适配器实例 */
const adapters = new Map<string, ProviderAdapter>()

/** 注册 Provider 适配器 */
export function registerProviderAdapter(adapter: ProviderAdapter): void {
  adapters.set(adapter.providerType, adapter)
}

/** 获取 Provider 适配器 */
export function getProviderAdapter(providerType: string): ProviderAdapter {
  return adapters.get(providerType) ?? new GenericProviderAdapter(providerType)
}

// 注册内置适配器
registerProviderAdapter(new GenericProviderAdapter('openai_compat'))
registerProviderAdapter(new GenericProviderAdapter('anthropic'))
