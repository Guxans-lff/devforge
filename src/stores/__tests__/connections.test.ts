import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useConnectionStore } from '@/stores/connections'

describe('connections store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('recognizes Windows idle disconnect errors', () => {
    const store = useConnectionStore()

    expect(store.isDisconnectError('error communicating with database: 远程主机强迫关闭了一个现有的连接。(os error 10054)')).toBe(true)
    expect(store.isDisconnectError('An existing connection was forcibly closed by the remote host.')).toBe(true)
  })
})
