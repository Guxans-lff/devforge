import { invokeAiCommand } from './errors'
import type { ProviderConfig, AiProviderHealth } from '@/types/ai'

export function aiListProviders(): Promise<ProviderConfig[]> {
  return invokeAiCommand('ai_list_providers', undefined, { source: 'AI' })
}

export function aiSaveProvider(config: ProviderConfig): Promise<void> {
  return invokeAiCommand('ai_save_provider', { config }, { source: 'AI' })
}

export function aiDeleteProvider(id: string): Promise<void> {
  return invokeAiCommand('ai_delete_provider', { id }, { source: 'AI' })
}

export interface TestProviderParams {
  providerType: string
  endpoint: string
  model: string
  apiKey: string
}

export function aiTestProvider(params: TestProviderParams): Promise<AiProviderHealth> {
  return invokeAiCommand('ai_test_provider', { ...params }, { source: 'AI' })
}
