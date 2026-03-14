/**
 * completionFrequency.ts 单元测试
 *
 * 注意事项：
 * - 模块含有模块级变量 `cache` 和 `saveTimer`，每个测试用例前必须通过
 *   vi.resetModules() + 动态 import 重新加载模块，确保测试间状态完全隔离。
 * - happy-dom 提供了 localStorage，直接 spy/clear 即可。
 * - scheduleSave 使用 setTimeout(2000)，测试中使用 fake timers 控制时钟，
 *   避免真实异步等待，同时验证 localStorage 写入行为。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 每次重新加载被测模块，得到干净的模块级状态 */
async function freshModule() {
  vi.resetModules()
  return import('@/utils/completionFrequency')
}

const STORAGE_KEY = 'devforge:completion-frequency'

describe('completionFrequency', () => {
  beforeEach(() => {
    // 清理 localStorage，确保每个测试从空状态开始
    localStorage.clear()
    // 使用假计时器，防止 scheduleSave 的 2s setTimeout 泄漏到其他测试
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  // ─────────────────────────────────────────────
  // recordCompletionUsage
  // ─────────────────────────────────────────────

  describe('recordCompletionUsage', () => {
    it('首次记录时应创建新条目，count 为 1', async () => {
      const { recordCompletionUsage, getCompletionScore } = await freshModule()

      recordCompletionUsage('SELECT')

      // 通过 getCompletionScore 间接验证条目已写入内存缓存
      // 刚记录，recencyScore = 1.0，freqScore = log2(2)/6 ≈ 0.1667
      // 总分 ≈ 0.1667 * 0.6 + 1.0 * 0.4 = 0.5
      const score = getCompletionScore('SELECT')
      expect(score).toBeGreaterThan(0)

      // 推进计时器，让 scheduleSave 写入 localStorage
      vi.runAllTimers()
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      expect(stored['SELECT']).toBeDefined()
      expect(stored['SELECT'].count).toBe(1)
    })

    it('已有条目再次记录时 count 应递增', async () => {
      const { recordCompletionUsage } = await freshModule()

      recordCompletionUsage('INSERT')
      recordCompletionUsage('INSERT')
      recordCompletionUsage('INSERT')

      vi.runAllTimers()
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      expect(stored['INSERT'].count).toBe(3)
    })

    it('记录时 lastUsed 应更新为 Date.now() 当前时间戳', async () => {
      const fixedNow = 1_700_000_000_000
      vi.setSystemTime(fixedNow)

      const { recordCompletionUsage } = await freshModule()
      recordCompletionUsage('UPDATE')

      vi.runAllTimers()
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      expect(stored['UPDATE'].lastUsed).toBe(fixedNow)
    })

    it('多次调用 scheduleSave 时，只写一次 localStorage（节流保护）', async () => {
      // happy-dom 中 localStorage 实现直接绑在实例上，需 spy 实例方法
      const setItemSpy = vi.spyOn(localStorage, 'setItem')

      const { recordCompletionUsage } = await freshModule()

      // 快速连续记录 5 次
      for (let i = 0; i < 5; i++) {
        recordCompletionUsage('DELETE')
      }

      // 推进计时器，只应触发一次写入
      vi.runAllTimers()
      const callsForKey = setItemSpy.mock.calls.filter(([key]) => key === STORAGE_KEY)
      expect(callsForKey).toHaveLength(1)
    })
  })

  // ─────────────────────────────────────────────
  // getCompletionScore
  // ─────────────────────────────────────────────

  describe('getCompletionScore', () => {
    it('未记录过的 label 应返回 0', async () => {
      const { getCompletionScore } = await freshModule()
      expect(getCompletionScore('UNKNOWN_LABEL')).toBe(0)
    })

    it('刚记录的项 recencyScore 接近 1.0，总分应较高', async () => {
      const { recordCompletionUsage, getCompletionScore } = await freshModule()

      // 设定固定时间，避免浮点误差
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
      recordCompletionUsage('SELECT')

      // 不推进时间，daysSinceLastUse ≈ 0，recencyScore ≈ 1.0
      // freqScore = log2(2)/6 ≈ 0.1667
      // 期望分数 ≈ 0.1667*0.6 + 1.0*0.4 = 0.5
      const score = getCompletionScore('SELECT')
      expect(score).toBeGreaterThanOrEqual(0.49)
      expect(score).toBeLessThanOrEqual(0.51)
    })

    it('多次记录后 freqScore 增加，总分应高于仅记录一次时', async () => {
      const { recordCompletionUsage, getCompletionScore } = await freshModule()

      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))

      recordCompletionUsage('FROM')
      const scoreAfter1 = getCompletionScore('FROM')

      // 再记录 9 次，count = 10
      for (let i = 0; i < 9; i++) {
        recordCompletionUsage('FROM')
      }
      const scoreAfter10 = getCompletionScore('FROM')

      expect(scoreAfter10).toBeGreaterThan(scoreAfter1)
    })

    it('freqScore 应对数缩放且不超过 1.0', async () => {
      const { recordCompletionUsage, getCompletionScore } = await freshModule()

      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))

      // 记录 2^6 - 1 = 63 次，count = 63，log2(64)/6 = 1.0
      for (let i = 0; i < 63; i++) {
        recordCompletionUsage('WHERE')
      }

      // freqScore 应被 min 钳制到 1.0，总分 = 1.0*0.6 + 1.0*0.4 = 1.0
      const score = getCompletionScore('WHERE')
      expect(score).toBeCloseTo(1.0, 5)
    })

    it('30 天前使用的项 recencyScore 应为 0，总分仅含 freqScore', async () => {
      const { recordCompletionUsage, getCompletionScore } = await freshModule()

      // 固定记录时间
      const recordTime = new Date('2024-01-01T00:00:00Z').getTime()
      vi.setSystemTime(recordTime)
      recordCompletionUsage('JOIN')

      // 推进时间 30 天（精确 30 天后，daysSinceLastUse=30，min(30/30,1)=1，recencyScore=0）
      const thirtyDaysLater = recordTime + 30 * 24 * 60 * 60 * 1000
      vi.setSystemTime(thirtyDaysLater)

      // freqScore = log2(2)/6 ≈ 0.1667，recencyScore = 0
      // 总分 = 0.1667 * 0.6 + 0 * 0.4 ≈ 0.1
      const score = getCompletionScore('JOIN')
      const expectedFreqScore = Math.log2(2) / 6
      const expectedScore = expectedFreqScore * 0.6 + 0 * 0.4
      expect(score).toBeCloseTo(expectedScore, 5)
    })

    it('30 天以上的项 recencyScore 应被钳制到 0，不出现负分', async () => {
      const { recordCompletionUsage, getCompletionScore } = await freshModule()

      const recordTime = new Date('2024-01-01T00:00:00Z').getTime()
      vi.setSystemTime(recordTime)
      recordCompletionUsage('ORDER')

      // 推进 60 天，超过 30 天衰减上限
      const sixtyDaysLater = recordTime + 60 * 24 * 60 * 60 * 1000
      vi.setSystemTime(sixtyDaysLater)

      const score = getCompletionScore('ORDER')
      expect(score).toBeGreaterThanOrEqual(0)
      // recencyScore 应已被 min(60/30, 1.0) 钳制为 0
      // 总分仅来自 freqScore * 0.6
      const freqScore = Math.min(Math.log2(2) / 6, 1.0)
      expect(score).toBeCloseTo(freqScore * 0.6, 5)
    })

    it('从 localStorage 恢复的历史数据应正确计算分数', async () => {
      const fixedTime = new Date('2024-06-01T00:00:00Z').getTime()
      // 预先写入持久化数据（count=5，lastUsed=fixedTime）
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ HAVING: { count: 5, lastUsed: fixedTime } }),
      )

      vi.setSystemTime(fixedTime)
      const { getCompletionScore } = await freshModule()

      // freqScore = log2(6)/6 ≈ 0.431, recencyScore = 1.0
      const freqScore = Math.min(Math.log2(6) / 6, 1.0)
      const expected = freqScore * 0.6 + 1.0 * 0.4
      const score = getCompletionScore('HAVING')
      expect(score).toBeCloseTo(expected, 5)
    })
  })

  // ─────────────────────────────────────────────
  // 清理逻辑
  // ─────────────────────────────────────────────

  describe('清理逻辑（pruneEntries）', () => {
    it('超过 500 条时应自动清理，内存缓存应降至 350 条', async () => {
      const { recordCompletionUsage, getCompletionScore } = await freshModule()

      const fixedTime = new Date('2024-01-01T00:00:00Z').getTime()

      // 先写入 500 条旧记录到 localStorage（时间戳较旧）
      const initial: Record<string, { count: number; lastUsed: number }> = {}
      for (let i = 0; i < 500; i++) {
        // 旧时间：100 天前
        initial[`old_label_${i}`] = { count: 1, lastUsed: fixedTime - 100 * 86400_000 }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial))

      vi.setSystemTime(fixedTime)
      const { recordCompletionUsage: record2, getCompletionScore: score2 } = await freshModule()

      // 加入第 501 条（最新时间）——触发剪枝
      record2('new_hot_label')

      // 推进计时器，让 scheduleSave 将剪枝后的数据写入 localStorage
      vi.runAllTimers()

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      const count = Object.keys(stored).length
      // 剪枝后应保留 350 条（MAX_ENTRIES * 0.7）
      expect(count).toBe(350)
    })

    it('剪枝后应保留最近使用的条目，最旧的条目被淘汰', async () => {
      const baseTime = new Date('2024-01-01T00:00:00Z').getTime()

      // 写入 500 条旧条目（时间戳递增，label_0 最旧，label_499 最新）
      const initial: Record<string, { count: number; lastUsed: number }> = {}
      for (let i = 0; i < 500; i++) {
        initial[`label_${i}`] = { count: 1, lastUsed: baseTime + i * 1000 }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial))

      vi.setSystemTime(baseTime + 500 * 1000) // 比所有旧条目都新
      const { recordCompletionUsage } = await freshModule()

      // 新增第 501 条触发剪枝
      recordCompletionUsage('newest_label')
      vi.runAllTimers()

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      // newest_label 是最新的，应被保留
      expect(stored['newest_label']).toBeDefined()
      // label_0 是最旧的，应被淘汰
      expect(stored['label_0']).toBeUndefined()
      // label_499 是旧条目中最新的，应被保留
      expect(stored['label_499']).toBeDefined()
    })

    it('条目数未超过 500 时不触发清理', async () => {
      const { recordCompletionUsage } = await freshModule()

      // 只添加少量条目
      for (let i = 0; i < 10; i++) {
        recordCompletionUsage(`label_${i}`)
      }

      vi.runAllTimers()
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      // 10 条应全部保留
      expect(Object.keys(stored)).toHaveLength(10)
    })
  })
})
