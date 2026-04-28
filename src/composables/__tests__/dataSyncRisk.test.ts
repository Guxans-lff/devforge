import { describe, expect, it, vi } from 'vitest'
import { confirmDataSyncRisk, summarizeDataSyncRisk } from '../dataSyncRisk'
import type { SyncConfig, SyncPreview } from '@/types/data-sync'

const baseConfig: SyncConfig = {
  sourceConnectionId: 'source',
  sourceDatabase: 'app',
  targetConnectionId: 'target',
  targetDatabase: 'app_copy',
  tables: ['users'],
  syncMode: 'upsert',
}

const basePreview: SyncPreview[] = [
  {
    table: 'users',
    sourceRows: 10,
    targetRows: 5,
    columns: ['id', 'name'],
    primaryKeys: ['id'],
  },
]

describe('dataSyncRisk', () => {
  it('marks full sync as destructive', () => {
    const risk = summarizeDataSyncRisk({ ...baseConfig, syncMode: 'full' }, basePreview)
    expect(risk.destructive).toBe(true)
    expect(risk.level).toBe('critical')
    expect(risk.message).toContain('目标端现有')
  })

  it('warns when upsert tables have no primary key', () => {
    const risk = summarizeDataSyncRisk(baseConfig, [{ ...basePreview[0]!, primaryKeys: [] }])
    expect(risk.level).toBe('high')
    expect(risk.message).toContain('未检测到主键')
  })

  it('delegates confirmation to window.confirm', () => {
    window.confirm = vi.fn()
    const spy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    expect(confirmDataSyncRisk(baseConfig, basePreview)).toBe(true)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
