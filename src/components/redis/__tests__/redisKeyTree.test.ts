import { describe, expect, it } from 'vitest'
import { buildRedisKeyTree, removeRedisKeys } from '../redisKeyTree'

describe('redisKeyTree', () => {
  it('builds collapsed tree and preserves expanded state', () => {
    const first = buildRedisKeyTree(['user:1:name', 'user:1:email', 'order:1'])
    first[0]!.expanded = true

    const second = buildRedisKeyTree(['user:1:name', 'user:2:name', 'order:1'], { previousTree: first })

    expect(second.some(node => node.name.startsWith('user'))).toBe(true)
    expect(second.find(node => node.fullKey === first[0]!.fullKey)?.expanded).toBe(true)
  })

  it('removes deleted keys without rebuilding from server', () => {
    expect(removeRedisKeys(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c'])
  })
})
