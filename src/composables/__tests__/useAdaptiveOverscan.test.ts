/**
 * useAdaptiveOverscan composable 单元测试
 *
 * 验证动态 overscan 的核心逻辑：
 * - 初始值为 baseOverscan
 * - 快速滚动时 overscan 增大
 * - 停止滚动后 overscan 回落
 * - 速度越快 overscan 越大（线性插值）
 * - 不超过 maxOverscan 上限
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import * as fc from 'fast-check'
import { useAdaptiveOverscan } from '../useAdaptiveOverscan'

// 模拟 DOM 元素的滚动行为
function createMockScrollElement() {
  let scrollTop = 0
  const listeners: Record<string, Function[]> = {}

  const el = {
    get scrollTop() { return scrollTop },
    set scrollTop(val: number) { scrollTop = val },
    addEventListener(event: string, handler: Function, _opts?: any) {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(handler)
    },
    removeEventListener(event: string, handler: Function) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(h => h !== handler)
      }
    },
    /** 模拟滚动：设置 scrollTop 并触发 scroll 事件，然后 flush rAF */
    simulateScroll(newScrollTop: number) {
      scrollTop = newScrollTop
      listeners['scroll']?.forEach(h => h())
      ;(globalThis as any).__flushRaf?.()
    },
  }

  return el as unknown as HTMLElement & { simulateScroll: (v: number) => void }
}

describe('useAdaptiveOverscan', () => {
  let rafCallbacks: Array<(time: number) => void> = []
  let rafIdCounter = 0
  const activeRafIds = new Set<number>()

  beforeEach(() => {
    vi.useFakeTimers()
    // 模拟 performance.now()
    let mockTime = 0
    vi.spyOn(performance, 'now').mockImplementation(() => mockTime)
    // 暴露给测试用的时间推进函数
    ;(globalThis as any).__advanceTime = (ms: number) => { mockTime += ms }
    // 模拟 requestAnimationFrame / cancelAnimationFrame
    rafCallbacks = []
    rafIdCounter = 0
    activeRafIds.clear()
    vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
      const id = ++rafIdCounter
      activeRafIds.add(id)
      rafCallbacks.push((time: number) => {
        if (activeRafIds.has(id)) {
          activeRafIds.delete(id)
          cb(time)
        }
      })
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      activeRafIds.delete(id)
    })
    ;(globalThis as any).__flushRaf = () => {
      const cbs = [...rafCallbacks]
      rafCallbacks = []
      cbs.forEach(cb => cb(mockTime))
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (globalThis as any).__advanceTime
    delete (globalThis as any).__flushRaf
  })

  const advanceTime = (ms: number) => (globalThis as any).__advanceTime(ms)

  it('初始 overscan 应为 baseOverscan', () => {
    const scrollRef = ref<HTMLElement | null>(null)
    const { overscan } = useAdaptiveOverscan(scrollRef, { baseOverscan: 25 })
    expect(overscan.value).toBe(25)
  })

  it('默认 baseOverscan 为 20', () => {
    const scrollRef = ref<HTMLElement | null>(null)
    const { overscan } = useAdaptiveOverscan(scrollRef)
    expect(overscan.value).toBe(20)
  })

  it('快速滚动时 overscan 应增大', () => {
    const mockEl = createMockScrollElement()
    const scrollRef = ref<HTMLElement | null>(mockEl)
    const { overscan, attach } = useAdaptiveOverscan(scrollRef, {
      baseOverscan: 20,
      maxOverscan: 80,
      velocityThreshold: 15,
    })
    attach()

    // 第一次滚动（建立基线）
    advanceTime(16)
    mockEl.simulateScroll(0)

    // 快速滚动：16ms 内滚动 500px = 31.25 px/ms（超过阈值 15）
    advanceTime(16)
    mockEl.simulateScroll(500)

    expect(overscan.value).toBeGreaterThan(20)
  })

  it('停止滚动后 overscan 应回落到 baseOverscan', () => {
    const mockEl = createMockScrollElement()
    const scrollRef = ref<HTMLElement | null>(mockEl)
    const { overscan, attach } = useAdaptiveOverscan(scrollRef, {
      baseOverscan: 20,
      maxOverscan: 80,
      velocityThreshold: 15,
      decayDelay: 300,
    })
    attach()

    // 建立基线
    advanceTime(16)
    mockEl.simulateScroll(0)

    // 快速滚动
    advanceTime(16)
    mockEl.simulateScroll(500)
    expect(overscan.value).toBeGreaterThan(20)

    // 等待回落（decayDelay + 第二次阶梯回落）
    vi.advanceTimersByTime(300 + 200 + 50)
    expect(overscan.value).toBe(20)
  })

  it('overscan 不应超过 maxOverscan', () => {
    const mockEl = createMockScrollElement()
    const scrollRef = ref<HTMLElement | null>(mockEl)
    const { overscan, attach } = useAdaptiveOverscan(scrollRef, {
      baseOverscan: 20,
      maxOverscan: 60,
      velocityThreshold: 15,
    })
    attach()

    // 建立基线
    advanceTime(16)
    mockEl.simulateScroll(0)

    // 极速滚动：16ms 内滚动 5000px
    advanceTime(16)
    mockEl.simulateScroll(5000)

    expect(overscan.value).toBeLessThanOrEqual(60)
  })

  it('慢速滚动时 overscan 应保持 baseOverscan', () => {
    const mockEl = createMockScrollElement()
    const scrollRef = ref<HTMLElement | null>(mockEl)
    const { overscan, attach } = useAdaptiveOverscan(scrollRef, {
      baseOverscan: 20,
      maxOverscan: 80,
      velocityThreshold: 15,
    })
    attach()

    // 建立基线
    advanceTime(16)
    mockEl.simulateScroll(0)

    // 慢速滚动：16ms 内滚动 100px = 6.25 px/ms（低于阈值 15）
    advanceTime(16)
    mockEl.simulateScroll(100)

    expect(overscan.value).toBe(20)
  })

  it('属性测试：速度越快 overscan 越大（单调递增）', () => {
    fc.assert(
      fc.property(
        // 两个不同的快速滚动速度（都超过阈值）
        fc.integer({ min: 300, max: 2000 }),
        fc.integer({ min: 300, max: 2000 }),
        (scrollDist1, scrollDist2) => {
          // 确保两个距离不同
          if (scrollDist1 === scrollDist2) return

          const mockEl1 = createMockScrollElement()
          const scrollRef1 = ref<HTMLElement | null>(mockEl1)
          const result1 = useAdaptiveOverscan(scrollRef1, {
            baseOverscan: 20, maxOverscan: 80, velocityThreshold: 15,
          })
          result1.attach()

          const mockEl2 = createMockScrollElement()
          const scrollRef2 = ref<HTMLElement | null>(mockEl2)
          const result2 = useAdaptiveOverscan(scrollRef2, {
            baseOverscan: 20, maxOverscan: 80, velocityThreshold: 15,
          })
          result2.attach()

          // 建立基线
          advanceTime(16)
          mockEl1.simulateScroll(0)
          mockEl2.simulateScroll(0)

          // 以不同速度滚动（相同时间间隔，不同距离）
          advanceTime(16)
          mockEl1.simulateScroll(Math.min(scrollDist1, scrollDist2))
          mockEl2.simulateScroll(Math.max(scrollDist1, scrollDist2))

          // 速度更快的 overscan 应 >= 速度更慢的
          expect(result2.overscan.value).toBeGreaterThanOrEqual(result1.overscan.value)
        },
      ),
      { numRuns: 50 },
    )
  })

  it('detach 后滚动不应影响 overscan', () => {
    const mockEl = createMockScrollElement()
    const scrollRef = ref<HTMLElement | null>(mockEl)
    const { overscan, attach, detach } = useAdaptiveOverscan(scrollRef, {
      baseOverscan: 20,
      maxOverscan: 80,
      velocityThreshold: 15,
    })
    attach()

    // 建立基线
    advanceTime(16)
    mockEl.simulateScroll(0)

    // 解绑
    detach()

    // 快速滚动（已解绑，不应响应）
    advanceTime(16)
    mockEl.simulateScroll(500)

    expect(overscan.value).toBe(20)
  })
})
