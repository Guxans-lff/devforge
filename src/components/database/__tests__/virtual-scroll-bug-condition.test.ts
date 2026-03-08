/**
 * Bug 条件探索属性测试 - 快速滚动白屏复现
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.5**
 *
 * 此测试在未修复代码上预期失败，失败即确认 bug 存在。
 * 修复后测试通过即验证修复正确。
 *
 * 测试策略：
 * - 从源代码中读取实际的 overscan、CSS class、will-change 配置
 * - 用属性测试生成随机快速滚动场景
 * - 验证虚拟行缓冲区是否足以覆盖快速滚动距离
 * - 验证是否存在影响渲染性能的 CSS transition
 * - 验证是否缺少 GPU 合成层提示
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ============================================================
// 常量定义
// ============================================================

/** 行高（像素），与源代码中 ROW_HEIGHT = 28 一致 */
const ROW_HEIGHT = 28

/** 帧时间（毫秒），假设 60fps */
const FRAME_TIME_MS = 16

// ============================================================
// 源代码解析工具函数
// ============================================================

/**
 * 从 Vue 组件源代码中提取 maxOverscan 配置值
 * 自适应 overscan 模式下，快速滚动时 overscan 会提升到 maxOverscan，
 * 因此 bug 条件测试应使用 maxOverscan 计算缓冲区上限。
 * @param source - Vue 组件源代码字符串
 * @returns maxOverscan 数值
 */
function extractMaxOverscan(source: string): number {
  const match = source.match(/maxOverscan:\s*(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

/**
 * 检查虚拟行元素上是否存在 transition-colors CSS 类
 * 只检查虚拟行容器和单元格，不检查 header 等非虚拟行元素
 * @param source - Vue 组件源代码字符串
 * @param component - 组件名称
 * @returns 是否存在 transition-colors
 */
function hasTransitionOnVirtualRows(source: string, component: 'QueryResult' | 'ObjectTree'): boolean {
  if (component === 'QueryResult') {
    // 检查虚拟行容器（v-for="vRow in rowVirtualizer.getVirtualItems()" 附近）
    // 和单元格（v-for="cell in ..." 附近）是否有 transition-colors
    const virtualRowSection = source.slice(
      source.indexOf('v-for="vRow in rowVirtualizer.getVirtualItems()"'),
    )
    if (!virtualRowSection) return false
    // 截取虚拟行区域（到下一个主要 section）
    const sectionEnd = virtualRowSection.indexOf('<!-- Error state')
    const section = sectionEnd > 0 ? virtualRowSection.slice(0, sectionEnd) : virtualRowSection.slice(0, 2000)
    return section.includes('transition-colors')
  }

  if (component === 'ObjectTree') {
    // 检查虚拟行节点上的 transition-colors
    const virtualRowSection = source.slice(
      source.indexOf('v-for="virtualRow in virtualRows"'),
    )
    if (!virtualRowSection) return false
    const section = virtualRowSection.slice(0, 3000)
    return section.includes('transition-colors')
  }

  return false
}

/**
 * 检查虚拟滚动容器是否缺少 will-change: transform GPU 提示
 * @param source - Vue 组件源代码字符串
 * @param component - 组件名称
 * @returns 是否缺少 GPU 合成层提示
 */
function lacksGPUCompositing(source: string, component: 'QueryResult' | 'ObjectTree'): boolean {
  if (component === 'QueryResult') {
    // 检查虚拟滚动容器（Body 区域）是否有 will-change
    const bodySection = source.slice(source.indexOf('<!-- Body (virtual rows) -->'))
    if (!bodySection) return true
    const section = bodySection.slice(0, 500)
    return !section.includes('will-change')
  }

  if (component === 'ObjectTree') {
    // 检查虚拟滚动容器是否有 will-change
    const treeSection = source.slice(source.indexOf('ref="parentRef"'))
    if (!treeSection) return true
    const section = treeSection.slice(0, 500)
    return !section.includes('will-change')
  }

  return true
}


/**
 * Bug 条件判定函数（来自设计文档 Fault Condition）
 *
 * 当以下条件同时满足时，判定为 bug 条件：
 * 1. 单帧滚动距离 > 缓冲区像素距离
 * 2. 组件为 QueryResult 或 ObjectTree
 * 3. 虚拟行上存在 transition-colors / 缺少 will-change GPU 提示
 *
 * @param input - 滚动事件参数
 * @param source - 组件源代码
 * @returns 是否触发 bug 条件
 */
function isBugCondition(
  input: { scrollVelocity: number; component: 'QueryResult' | 'ObjectTree'; overscan: number },
  source: string,
): boolean {
  const bufferPixels = input.overscan * ROW_HEIGHT
  const frameScrollDistance = input.scrollVelocity * FRAME_TIME_MS

  return (
    frameScrollDistance > bufferPixels &&
    ['QueryResult', 'ObjectTree'].includes(input.component) &&
    (hasTransitionOnVirtualRows(source, input.component) ||
      lacksGPUCompositing(source, input.component))
  )
}

// ============================================================
// 读取源代码
// ============================================================

const QUERY_RESULT_PATH = resolve(__dirname, '../QueryResult.vue')
const OBJECT_TREE_PATH = resolve(__dirname, '../ObjectTree.vue')

const queryResultSource = readFileSync(QUERY_RESULT_PATH, 'utf-8')
const objectTreeSource = readFileSync(OBJECT_TREE_PATH, 'utf-8')

// 提取当前配置（使用 maxOverscan，因为快速滚动时自适应系统会提升到此值）
const queryResultOverscan = extractMaxOverscan(queryResultSource)
const objectTreeOverscan = extractMaxOverscan(objectTreeSource)

// ============================================================
// 属性测试
// ============================================================

describe('Property 1: Fault Condition - 快速滚动白屏复现', () => {
  /**
   * 属性测试：QueryResult 快速滚动时缓冲区应覆盖可视区域
   *
   * 生成随机快速滚动速度（超过当前 overscan 缓冲区能覆盖的范围），
   * 验证缓冲区像素距离是否 >= 单帧滚动距离。
   *
   * 在未修复代码上（overscan=15，缓冲区=420px），当滚动速度超过
   * 420/16 ≈ 26.25 px/ms 时，此测试将失败。
   */
  it('QueryResult: overscan 缓冲区应足以覆盖快速滚动距离（1000行数据）', () => {
    const overscan = queryResultOverscan
    const bufferPixels = overscan * ROW_HEIGHT

    fc.assert(
      fc.property(
        // 生成快速滚动速度：27-80 px/ms（超过 overscan=15 的 26.25 px/ms 阈值）
        fc.integer({ min: 27, max: 80 }),
        // 生成数据行数：100-5000 行
        fc.integer({ min: 100, max: 5000 }),
        (scrollVelocityPxPerMs, totalRows) => {
          const frameScrollDistance = scrollVelocityPxPerMs * FRAME_TIME_MS

          // 断言：缓冲区像素距离应 >= 单帧滚动距离
          // 即 overscan * ROW_HEIGHT >= scrollVelocity * FRAME_TIME_MS
          expect(bufferPixels).toBeGreaterThanOrEqual(frameScrollDistance)
        },
      ),
      { numRuns: 100 },
    )
  })

  /**
   * 属性测试：ObjectTree 快速滚动时缓冲区应覆盖可视区域
   *
   * 在未修复代码上（overscan=20，缓冲区=560px），当滚动速度超过
   * 560/16 = 35 px/ms 时，此测试将失败。
   */
  it('ObjectTree: overscan 缓冲区应足以覆盖快速滚动距离（500+节点）', () => {
    const overscan = objectTreeOverscan
    const bufferPixels = overscan * ROW_HEIGHT

    fc.assert(
      fc.property(
        // 生成快速滚动速度：36-80 px/ms（超过 overscan=20 的 35 px/ms 阈值）
        fc.integer({ min: 36, max: 80 }),
        // 生成节点数：100-2000
        fc.integer({ min: 100, max: 2000 }),
        (scrollVelocityPxPerMs, totalNodes) => {
          const frameScrollDistance = scrollVelocityPxPerMs * FRAME_TIME_MS

          // 断言：缓冲区像素距离应 >= 单帧滚动距离
          expect(bufferPixels).toBeGreaterThanOrEqual(frameScrollDistance)
        },
      ),
      { numRuns: 100 },
    )
  })

  /**
   * 属性测试：虚拟行上不应存在 transition-colors CSS 类
   *
   * transition-colors 在快速滚动时会导致大量行同时触发过渡动画，
   * 造成 GPU 压力和渲染延迟。
   *
   * 在未修复代码上，QueryResult 虚拟行容器和单元格都有 transition-colors，
   * 此测试将失败。
   */
  it('QueryResult: 虚拟行上不应存在 transition-colors（增加渲染开销）', () => {
    const hasTransition = hasTransitionOnVirtualRows(queryResultSource, 'QueryResult')
    expect(hasTransition).toBe(false)
  })

  it('ObjectTree: 虚拟行上不应存在 transition-colors（增加渲染开销）', () => {
    const hasTransition = hasTransitionOnVirtualRows(objectTreeSource, 'ObjectTree')
    expect(hasTransition).toBe(false)
  })

  /**
   * 属性测试：虚拟滚动容器应有 will-change: transform GPU 提示
   *
   * 缺少 will-change 提示时，浏览器无法提前创建 GPU 合成层，
   * 每次滚动都需要重新布局和绘制。
   *
   * 在未修复代码上，两个组件都缺少 will-change，此测试将失败。
   */
  it('QueryResult: 虚拟滚动容器应有 will-change GPU 提示', () => {
    const lacksGPU = lacksGPUCompositing(queryResultSource, 'QueryResult')
    expect(lacksGPU).toBe(false)
  })

  it('ObjectTree: 虚拟滚动容器应有 will-change GPU 提示', () => {
    const lacksGPU = lacksGPUCompositing(objectTreeSource, 'ObjectTree')
    expect(lacksGPU).toBe(false)
  })

  /**
   * 综合属性测试：Bug 条件判定
   *
   * 对于任意快速滚动场景，isBugCondition 应返回 false（即不触发 bug）。
   * 在未修复代码上，由于 overscan 不足 + transition-colors + 缺少 will-change，
   * isBugCondition 将返回 true，此测试将失败。
   */
  it('综合验证：快速滚动时不应触发 bug 条件', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('QueryResult' as const),
          fc.constant('ObjectTree' as const),
        ),
        // 生成快速滚动速度
        fc.integer({ min: 36, max: 100 }),
        (component, scrollVelocityPxPerMs) => {
          const source = component === 'QueryResult' ? queryResultSource : objectTreeSource
          const overscan = component === 'QueryResult' ? queryResultOverscan : objectTreeOverscan

          const bugTriggered = isBugCondition(
            { scrollVelocity: scrollVelocityPxPerMs, component, overscan },
            source,
          )

          // 断言：不应触发 bug 条件
          expect(bugTriggered).toBe(false)
        },
      ),
      { numRuns: 200 },
    )
  })
})
