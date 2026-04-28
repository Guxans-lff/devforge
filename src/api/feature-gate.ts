import { invokeCommand } from '@/api/base'

export interface FeatureGateEntry {
  key: string
  enabled: boolean
}

export function readFeatureGates(): Promise<FeatureGateEntry[]> {
  return invokeCommand('read_feature_gates', undefined, { source: 'AI' })
}

export function writeFeatureGate(key: string, enabled: boolean): Promise<void> {
  return invokeCommand('write_feature_gate', { key, enabled }, { source: 'AI' })
}

export function deleteFeatureGate(key: string): Promise<void> {
  return invokeCommand('delete_feature_gate', { key }, { source: 'AI' })
}
