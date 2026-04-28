/**
 * Provider 适配层
 *
 * 导出 ProviderAdapter 接口和标准流式事件工具函数。
 */

export {
  type ProviderAdapter,
  GenericProviderAdapter,
  registerProviderAdapter,
  getProviderAdapter,
} from './ProviderAdapter'

export {
  isTextDelta,
  isThinkingDelta,
  isToolCall,
  isToolCallDelta,
  isUsage,
  isDone,
  isError,
  isContentEvent,
  isToolEvent,
  isTerminalEvent,
  extractText,
  extractThinking,
  extractUsage,
  extractFinishReason,
  summarizeEvents,
} from './streamEvents'
