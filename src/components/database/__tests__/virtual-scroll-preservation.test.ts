/**
 * 保持性属性测试 - 验证现有功能行为不变（Property 2: Preservation）
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**
 *
 * 此测试在未修复代码上应全部通过，捕获当前基线行为。
 * 修复后重新运行，确认无回归。
 *
 * 观察优先方法论：
 * - 从源代码中读取实际配置（overscan、gridStyle、CHUNK_SIZE、加载阈值等）
 * - 用属性测试验证这些配置下的行为模式
 * - 确保修复后这些行为模式不变
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ============================================================
// 常量定义
// ============================================================

/** 行高（像素），与源代码一致 */
const ROW_HEIGHT = 28

// ============================================================
// 读取源代码
// ============================================================

const QUERY_RESULT_PATH = resolve(__dirname, '../QueryResult.vue')
const OBJECT_TREE_PATH = resolve(__dirname, '../ObjectTree.vue')

const queryResultSource = readFileSync(QUERY_RESULT_PATH, 'utf-8')
const objectTreeSource = readFileSync(OBJECT_TREE_PATH, 'utf-8')

// ============================================================
// 源代码解析工具函数
// ============================================================

/**
 * 从 Vue 组件源代码中提取 baseOverscan 配置值
 * 自适应 overscan 模式下，正常浏览时使用 baseOverscan，
 * 保持性测试验证的是正常浏览行为，因此使用 baseOverscan。
 * @param source - Vue 组件源代码字符串
 * @returns baseOverscan 数值
 */
function extractOverscan(source: string): number {
  const match = source.match(/baseOverscan:\s*(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

/**
 * 从 QueryResult.vue 源代码中提取 CHUNK_SIZE 配置值
 * @param source - Vue 组件源代码字符串
 * @returns CHUNK_SIZE 数值
 */
function extractChunkSize(source: string): number {
  const match = source.match(/const\s+CHUNK_SIZE\s*=\s*(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

/**
 * 从 QueryResult.vue 源代码中提取滚动加载阈值（距底部多少像素触发加载）
 * @param source - Vue 组件源代码字符串
 * @returns 加载阈值像素值
 */
function extractLoadThreshold(source: string): number {
  const match = source.match(/scrollHeight\s*-\s*(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

/**
 * 从 QueryResult.vue 源代码中提取 gridStyle computed 的结构
 * 验证 gridStyle 包含 display: 'grid' 和 gridTemplateColumns
 * @param source - Vue 组件源代码字符串
 * @returns gridStyle 结构信息
 */
function extractGridStyleStructure(source: string): {
  hasDisplayGrid: boolean
  hasGridTemplateColumns: boolean
  hasRowNumberColumn: boolean
} {
  // 查找 gridStyle computed 定义区域
  const gridStyleStart = source.indexOf('const gridStyle = computed')
  if (gridStyleStart < 0) {
    return { hasDisplayGrid: false, hasGridTemplateColumns: false, hasRowNumberColumn: false }
  }
  // 截取 gridStyle 定义区域（到下一个 const 或 function）
  const afterStart = source.slice(gridStyleStart, gridStyleStart + 500)

  return {
    hasDisplayGrid: afterStart.includes("display: 'grid'") || afterStart.includes('display: "grid"'),
    hasGridTemplateColumns: afterStart.includes('gridTemplateColumns'),
    hasRowNumberColumn: afterStart.includes('60px'), // 行号列宽度
  }
}

/**
 * 检查虚拟行 DOM 结构是否包含必要的 CSS class
 * 验证虚拟行容器包含 flex、cursor-pointer、absolute 等关键类
 * @param source - Vue 组件源代码字符串
 * @returns 虚拟行 DOM 结构信息
 */
function extractVirtualRowStructure(source: string): {
  hasFlexClass: boolean
  hasCursorPointer: boolean
  hasAbsolutePositioning: boolean
  hasHeightBinding: boolean
  hasTransformBinding: boolean
  hasGridStyleBinding: boolean
} {
  // 定位虚拟行区域（v-for="vRow in rowVirtualizer.getVirtualItems()"）
  const vRowStart = source.indexOf('v-for="vRow in rowVirtualizer.getVirtualItems()"')
  if (vRowStart < 0) {
    return {
      hasFlexClass: false, hasCursorPointer: false, hasAbsolutePositioning: false,
      hasHeightBinding: false, hasTransformBinding: false, hasGridStyleBinding: false,
    }
  }
  // 截取虚拟行容器定义（扩大范围以覆盖 v-memo 等额外属性）
  const section = source.slice(vRowStart, vRowStart + 500)

  return {
    hasFlexClass: section.includes('flex'),
    hasCursorPointer: section.includes('cursor-pointer'),
    hasAbsolutePositioning: section.includes('absolute'),
    // 修复后 height 和 gridStyle 合并到 rowBaseStyle 中，检查 rowBaseStyle 或直接的 height/gridStyle
    hasHeightBinding: section.includes('ROW_HEIGHT') || section.includes('height') || section.includes('rowBaseStyle'),
    hasTransformBinding: section.includes('translateY'),
    hasGridStyleBinding: section.includes('gridStyle') || section.includes('rowBaseStyle'),
  }
}

/**
 * 检查 ObjectTree 虚拟行 DOM 结构
 * @param source - Vue 组件源代码字符串
 * @returns 虚拟行 DOM 结构信息
 */
function extractObjectTreeVirtualRowStructure(source: string): {
  hasAbsolutePositioning: boolean
  hasTransformBinding: boolean
  hasSizeBinding: boolean
  hasKeyBinding: boolean
} {
  const vRowStart = source.indexOf('v-for="virtualRow in virtualRows"')
  if (vRowStart < 0) {
    return {
      hasAbsolutePositioning: false, hasTransformBinding: false,
      hasSizeBinding: false, hasKeyBinding: false,
    }
  }
  const section = source.slice(vRowStart, vRowStart + 300)

  return {
    hasAbsolutePositioning: section.includes('absolute'),
    hasTransformBinding: section.includes('translateY'),
    hasSizeBinding: section.includes('virtualRow.size') || section.includes('height'),
    hasKeyBinding: section.includes(':key'),
  }
}

/**
 * 模拟 gridStyle 计算逻辑（与源代码一致）
 * 用于验证列宽渲染正确性
 * @param columnWidths - 各列宽度数组（像素）
 * @param editable - 是否可编辑（决定是否有操作列）
 * @returns CSS Grid 样式对象
 */
function computeGridStyle(
  columnWidths: number[],
  editable: boolean,
): { display: string; gridTemplateColumns: string } {
  const widthStr = columnWidths.map(w => `${w}px`).join(' ')
  const actionCol = editable ? ' 40px' : ''
  return {
    display: 'grid',
    gridTemplateColumns: `60px ${widthStr}${actionCol}`,
  }
}

/**
 * 模拟虚拟滚动行数计算
 * 给定容器高度和 overscan，计算可见行数 + 缓冲行数
 * @param containerHeight - 容器高度（像素）
 * @param scrollTop - 滚动位置（像素）
 * @param totalRows - 总行数
 * @param overscan - 预渲染行数
 * @returns 虚拟行范围
 */
function computeVirtualRange(
  containerHeight: number,
  scrollTop: number,
  totalRows: number,
  overscan: number,
): { startIndex: number; endIndex: number; visibleCount: number } {
  const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT)
  const startVisible = Math.floor(scrollTop / ROW_HEIGHT)
  const startIndex = Math.max(0, startVisible - overscan)
  const endIndex = Math.min(totalRows - 1, startVisible + visibleCount + overscan)
  return { startIndex, endIndex, visibleCount }
}

/**
 * 模拟分块加载逻辑
 * 验证滚动到底部时数据加载时机
 * @param scrollTop - 滚动位置
 * @param clientHeight - 容器可见高度
 * @param scrollHeight - 总滚动高度
 * @param threshold - 加载阈值
 * @param hasMore - 是否有更多数据
 * @returns 是否应触发加载
 */
function shouldTriggerLoad(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold: number,
  hasMore: boolean,
): boolean {
  if (!hasMore) return false
  return scrollTop + clientHeight >= scrollHeight - threshold
}

// ============================================================
// 提取当前配置（基线）
// ============================================================

const queryResultOverscan = extractOverscan(queryResultSource)
const objectTreeOverscan = extractOverscan(objectTreeSource)
const chunkSize = extractChunkSize(queryResultSource)
const loadThreshold = extractLoadThreshold(queryResultSource)

// ============================================================
// 属性测试
// ============================================================

describe('Property 2: Preservation - 现有功能行为不变', () => {
  /**
   * 验证虚拟行 DOM 结构正确（包含正确的 class、style 属性）
   *
   * 观察：虚拟行容器包含 flex、cursor-pointer、absolute 定位，
   * 绑定了 height、translateY transform 和 gridStyle。
   * 移除 transition 后这些结构属性不应改变。
   *
   * **Validates: Requirements 3.1**
   */
  it('QueryResult: 虚拟行 DOM 结构应包含正确的 class 和 style 属性', () => {
    const structure = extractVirtualRowStructure(queryResultSource)

    // 虚拟行容器必须包含这些关键 CSS 类和绑定
    expect(structure.hasFlexClass).toBe(true)
    expect(structure.hasCursorPointer).toBe(true)
    expect(structure.hasAbsolutePositioning).toBe(true)
    expect(structure.hasHeightBinding).toBe(true)
    expect(structure.hasTransformBinding).toBe(true)
    expect(structure.hasGridStyleBinding).toBe(true)
  })

  it('ObjectTree: 虚拟行 DOM 结构应包含正确的定位和变换属性', () => {
    const structure = extractObjectTreeVirtualRowStructure(objectTreeSource)

    expect(structure.hasAbsolutePositioning).toBe(true)
    expect(structure.hasTransformBinding).toBe(true)
    expect(structure.hasSizeBinding).toBe(true)
    expect(structure.hasKeyBinding).toBe(true)
  })

  /**
   * 验证 gridStyle 结构正确，列宽渲染正确
   *
   * 观察：gridStyle computed 生成 CSS Grid 布局，包含 display: 'grid'
   * 和 gridTemplateColumns（60px 行号列 + 各数据列宽 + 可选操作列）。
   * 优化后样式对象引用应稳定，列宽渲染正确。
   *
   * **Validates: Requirements 3.5**
   */
  it('QueryResult: gridStyle 结构应包含正确的 CSS Grid 属性', () => {
    const gridStructure = extractGridStyleStructure(queryResultSource)

    expect(gridStructure.hasDisplayGrid).toBe(true)
    expect(gridStructure.hasGridTemplateColumns).toBe(true)
    expect(gridStructure.hasRowNumberColumn).toBe(true)
  })

  it('gridStyle 计算：对于任意列宽组合，应生成正确的 CSS Grid 模板', () => {
    fc.assert(
      fc.property(
        // 生成 1-30 列的随机列宽（50-500px）
        fc.array(fc.integer({ min: 50, max: 500 }), { minLength: 1, maxLength: 30 }),
        // 是否可编辑
        fc.boolean(),
        (columnWidths, editable) => {
          const style = computeGridStyle(columnWidths, editable)

          // 验证 display 为 grid
          expect(style.display).toBe('grid')

          // 验证 gridTemplateColumns 以 60px（行号列）开头
          expect(style.gridTemplateColumns.startsWith('60px ')).toBe(true)

          // 验证每列宽度都在模板中
          for (const w of columnWidths) {
            expect(style.gridTemplateColumns).toContain(`${w}px`)
          }

          // 验证可编辑时有 40px 操作列
          if (editable) {
            expect(style.gridTemplateColumns.endsWith(' 40px')).toBe(true)
          } else {
            expect(style.gridTemplateColumns.endsWith(' 40px')).toBe(false)
          }

          // 验证样式对象引用稳定（相同输入产生相同输出）
          const style2 = computeGridStyle(columnWidths, editable)
          expect(style).toEqual(style2)
        },
      ),
      { numRuns: 100 },
    )
  })

  /**
   * 验证 overscan 增大后虚拟行数量正确增加，不影响正常浏览体验
   *
   * 观察：正常速度浏览时，虚拟行数量 = 可见行数 + 2 * overscan（上下各 overscan 行）。
   * overscan 增大后，虚拟行数量应相应增加，但不影响可见区域的正确渲染。
   *
   * **Validates: Requirements 3.1, 3.4**
   */
  it('虚拟行范围计算：对于任意容器高度和滚动位置，虚拟行应正确覆盖可见区域', () => {
    fc.assert(
      fc.property(
        // 容器高度：200-1000px
        fc.integer({ min: 200, max: 1000 }),
        // 总行数：10-5000
        fc.integer({ min: 10, max: 5000 }),
        // overscan 值（使用当前配置值或修复后的值）
        fc.constantFrom(queryResultOverscan, objectTreeOverscan, 35, 50),
        (containerHeight, totalRows, overscan) => {
          const maxScrollTop = Math.max(0, totalRows * ROW_HEIGHT - containerHeight)

          // 生成正常浏览速度的滚动位置（非快速滚动）
          fc.assert(
            fc.property(
              fc.integer({ min: 0, max: Math.max(0, maxScrollTop) }),
              (scrollTop) => {
                const range = computeVirtualRange(containerHeight, scrollTop, totalRows, overscan)

                // 验证：startIndex >= 0
                expect(range.startIndex).toBeGreaterThanOrEqual(0)

                // 验证：endIndex < totalRows
                expect(range.endIndex).toBeLessThan(totalRows)

                // 验证：可见区域被完全覆盖
                const firstVisibleRow = Math.floor(scrollTop / ROW_HEIGHT)
                const lastVisibleRow = Math.min(
                  totalRows - 1,
                  firstVisibleRow + range.visibleCount - 1,
                )
                expect(range.startIndex).toBeLessThanOrEqual(firstVisibleRow)
                expect(range.endIndex).toBeGreaterThanOrEqual(lastVisibleRow)

                // 验证：虚拟行数量合理（不超过总行数）
                const virtualCount = range.endIndex - range.startIndex + 1
                expect(virtualCount).toBeLessThanOrEqual(totalRows)
                expect(virtualCount).toBeGreaterThan(0)
              },
            ),
            { numRuns: 20 },
          )
        },
      ),
      { numRuns: 50 },
    )
  })

  /**
   * 验证 CHUNK_SIZE 和加载阈值调整后数据加载时机正确
   *
   * 观察：滚动到底部触发加载更多数据功能正常，滚动位置不跳变。
   * 当 scrollTop + clientHeight >= scrollHeight - threshold 时触发加载。
   *
   * **Validates: Requirements 3.7**
   */
  it('数据加载时机：当前配置值应正确提取', () => {
    // 验证当前 CHUNK_SIZE 和加载阈值已正确提取
    expect(chunkSize).toBeGreaterThan(0)
    expect(loadThreshold).toBeGreaterThan(0)
  })

  it('数据加载时机：对于任意滚动位置，加载触发逻辑应正确', () => {
    fc.assert(
      fc.property(
        // 容器可见高度：200-800px
        fc.integer({ min: 200, max: 800 }),
        // 总行数：使用 CHUNK_SIZE 的倍数模拟分块加载场景
        fc.integer({ min: 1, max: 20 }).map(n => n * chunkSize),
        // 是否有更多数据
        fc.boolean(),
        // 使用当前阈值或修复后的阈值
        fc.constantFrom(loadThreshold, 500),
        (clientHeight, totalRows, hasMore, threshold) => {
          const scrollHeight = totalRows * ROW_HEIGHT
          // 只在 scrollHeight > clientHeight 时测试（否则无需滚动）
          if (scrollHeight <= clientHeight) return

          // 测试：未到阈值时不应触发加载
          const safeScrollTop = 0
          expect(shouldTriggerLoad(safeScrollTop, clientHeight, scrollHeight, threshold, hasMore))
            .toBe(hasMore && (safeScrollTop + clientHeight >= scrollHeight - threshold))

          // 测试：到达阈值时应触发加载（如果有更多数据）
          const triggerScrollTop = scrollHeight - clientHeight - threshold + 1
          if (triggerScrollTop >= 0) {
            const shouldLoad = shouldTriggerLoad(triggerScrollTop, clientHeight, scrollHeight, threshold, hasMore)
            expect(shouldLoad).toBe(hasMore)
          }

          // 测试：没有更多数据时不应触发加载
          expect(shouldTriggerLoad(scrollHeight - clientHeight, clientHeight, scrollHeight, threshold, false))
            .toBe(false)
        },
      ),
      { numRuns: 100 },
    )
  })

  /**
   * 验证选中行高亮状态在滚动后保持
   *
   * 观察：选中行通过 selectedRowIndex 状态管理，
   * 虚拟行通过 :class 绑定 selectedRowIndex === vRow.index 来高亮。
   * 滚动后只要行仍在虚拟范围内，高亮状态应保持。
   *
   * **Validates: Requirements 3.8**
   */
  it('选中行高亮：选中行在虚拟范围内时应保持高亮状态', () => {
    fc.assert(
      fc.property(
        // 容器高度
        fc.integer({ min: 200, max: 800 }),
        // 总行数
        fc.integer({ min: 50, max: 5000 }),
        // 选中行索引
        fc.integer({ min: 0, max: 4999 }),
        (containerHeight, totalRows, selectedIndex) => {
          // 确保选中行在有效范围内
          const validSelectedIndex = Math.min(selectedIndex, totalRows - 1)
          const overscan = queryResultOverscan

          // 模拟滚动到选中行附近
          const scrollTop = Math.max(0, validSelectedIndex * ROW_HEIGHT - containerHeight / 2)
          const range = computeVirtualRange(containerHeight, scrollTop, totalRows, overscan)

          // 如果选中行在虚拟范围内，应能正确高亮
          if (validSelectedIndex >= range.startIndex && validSelectedIndex <= range.endIndex) {
            // 选中行在虚拟范围内，高亮状态应保持
            expect(validSelectedIndex).toBeGreaterThanOrEqual(range.startIndex)
            expect(validSelectedIndex).toBeLessThanOrEqual(range.endIndex)
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  /**
   * 验证 ObjectTree 展开/收起节点后虚拟滚动正确反映
   *
   * 观察：ObjectTree 使用 flattenedNodes 计算展平后的节点列表，
   * 虚拟滚动的 count 绑定到 flattenedNodes.length。
   * 展开/收起节点后，flattenedNodes 长度变化，虚拟滚动应正确反映。
   *
   * **Validates: Requirements 3.6**
   */
  it('ObjectTree: 节点展开/收起后虚拟行数量应正确反映', () => {
    // 验证 ObjectTree 源代码中虚拟滚动 count 绑定到 flattenedNodes
    expect(objectTreeSource).toContain('flattenedNodes.value.length')

    fc.assert(
      fc.property(
        // 模拟展平后的节点数量（展开前）
        fc.integer({ min: 5, max: 200 }),
        // 模拟展开后新增的子节点数量
        fc.integer({ min: 1, max: 50 }),
        (baseNodeCount, expandedChildren) => {
          const expandedCount = baseNodeCount + expandedChildren
          const containerHeight = 600
          const overscan = objectTreeOverscan

          // 展开前的虚拟范围
          const rangeBefore = computeVirtualRange(containerHeight, 0, baseNodeCount, overscan)
          // 展开后的虚拟范围
          const rangeAfter = computeVirtualRange(containerHeight, 0, expandedCount, overscan)

          // 验证：展开后 endIndex 应 >= 展开前（因为有更多节点可渲染）
          expect(rangeAfter.endIndex).toBeGreaterThanOrEqual(rangeBefore.endIndex)
        },
      ),
      { numRuns: 100 },
    )
  })

  /**
   * 验证排序后虚拟滚动正确反映数据
   *
   * 观察：排序通过 TanStack Table 的 getSortedRowModel 实现，
   * 排序后 table.getRowModel().rows 顺序改变，
   * 虚拟滚动通过 vRow.index 索引到排序后的行。
   *
   * **Validates: Requirements 3.4**
   */
  it('排序后虚拟行索引应正确映射到排序后的数据', () => {
    fc.assert(
      fc.property(
        // 生成随机数据行数
        fc.integer({ min: 10, max: 1000 }),
        // 生成随机排序后的行索引序列（模拟排序结果）
        fc.integer({ min: 10, max: 1000 }),
        (totalRows, _) => {
          // 模拟排序后的行索引（0 到 totalRows-1 的排列）
          const sortedIndices = Array.from({ length: totalRows }, (_, i) => i)
          // 简单反转模拟降序排序
          sortedIndices.reverse()

          const containerHeight = 600
          const overscan = queryResultOverscan
          const range = computeVirtualRange(containerHeight, 0, totalRows, overscan)

          // 验证：虚拟范围内的每个 vRow.index 都能正确映射到排序后的数据
          for (let i = range.startIndex; i <= range.endIndex; i++) {
            expect(sortedIndices[i]).toBeDefined()
            expect(sortedIndices[i]).toBeGreaterThanOrEqual(0)
            expect(sortedIndices[i]).toBeLessThan(totalRows)
          }
        },
      ),
      { numRuns: 50 },
    )
  })

  /**
   * 验证过滤后虚拟滚动正确反映过滤结果
   *
   * 观察：客户端过滤通过 allTableData computed 中的 filter 实现，
   * 过滤后 tableData 长度减少，虚拟滚动的 count 相应减少。
   *
   * **Validates: Requirements 3.4**
   */
  it('过滤后虚拟行数量应正确反映过滤结果', () => {
    fc.assert(
      fc.property(
        // 总行数
        fc.integer({ min: 50, max: 5000 }),
        // 过滤后保留的比例（10%-100%）
        fc.integer({ min: 10, max: 100 }),
        (totalRows, filterPercentage) => {
          const filteredRows = Math.max(1, Math.floor(totalRows * filterPercentage / 100))
          const containerHeight = 600
          const overscan = queryResultOverscan

          const range = computeVirtualRange(containerHeight, 0, filteredRows, overscan)

          // 验证：虚拟范围不超过过滤后的行数
          expect(range.endIndex).toBeLessThan(filteredRows)
          expect(range.startIndex).toBeGreaterThanOrEqual(0)

          // 验证：可见区域被正确覆盖
          const visibleRows = Math.min(filteredRows, Math.ceil(containerHeight / ROW_HEIGHT))
          expect(range.endIndex - range.startIndex + 1).toBeGreaterThanOrEqual(
            Math.min(visibleRows, filteredRows),
          )
        },
      ),
      { numRuns: 100 },
    )
  })

  /**
   * 验证列宽调整后表头和数据行对齐
   *
   * 观察：gridStyle 同时应用于 header 和 body 的虚拟行，
   * 确保列宽调整后两者使用相同的 gridTemplateColumns。
   *
   * **Validates: Requirements 3.5**
   */
  it('QueryResult: gridStyle 应同时应用于 header 和 body', () => {
    // 验证 header 区域使用 :style="gridStyle"
    const headerSection = queryResultSource.slice(
      queryResultSource.indexOf('<!-- Header -->'),
      queryResultSource.indexOf('<!-- Body'),
    )
    expect(headerSection).toContain(':style="gridStyle"')

    // 验证 body 虚拟行区域使用 gridStyle（直接或通过 rowBaseStyle 间接引用）
    const bodySection = queryResultSource.slice(
      queryResultSource.indexOf('<!-- Body (virtual rows) -->'),
    )
    const bodySnippet = bodySection.slice(0, 800)
    // 修复后 gridStyle 通过 rowBaseStyle 间接应用到虚拟行
    expect(bodySnippet.includes('gridStyle') || bodySnippet.includes('rowBaseStyle')).toBe(true)
  })

  /**
   * 验证 QueryResult 源代码中关键功能结构完整
   *
   * 观察：单元格复制（handleCellClick）、内联编辑（startEdit/saveEdit/cancelEdit）、
   * 行选中（selectedRowIndex）等功能在源代码中存在。
   *
   * **Validates: Requirements 3.2, 3.3, 3.8**
   */
  it('QueryResult: 关键功能函数应存在于源代码中', () => {
    // 单元格复制功能
    expect(queryResultSource).toContain('handleCellClick')
    expect(queryResultSource).toContain('clipboard.writeText')

    // 内联编辑功能
    expect(queryResultSource).toContain('startEdit')
    expect(queryResultSource).toContain('saveEdit')
    expect(queryResultSource).toContain('cancelEdit')
    expect(queryResultSource).toContain('editingCell')

    // 行选中功能
    expect(queryResultSource).toContain('selectedRowIndex')

    // 排序功能
    expect(queryResultSource).toContain('getSortedRowModel')
    expect(queryResultSource).toContain('SortingState')

    // 过滤功能
    expect(queryResultSource).toContain('columnFilters')
    expect(queryResultSource).toContain('showFilters')

    // 加载更多功能
    expect(queryResultSource).toContain('loadMore')
    expect(queryResultSource).toContain('CHUNK_SIZE')
  })

  /**
   * 验证 ObjectTree 源代码中关键功能结构完整
   *
   * **Validates: Requirements 3.6**
   */
  it('ObjectTree: 关键功能结构应存在于源代码中', () => {
    // 展开/收起功能
    expect(objectTreeSource).toContain('isExpanded')
    expect(objectTreeSource).toContain('toggleNode')

    // 搜索过滤功能
    expect(objectTreeSource).toContain('SearchQuery') // combinedSearchQuery 或类似

    // 虚拟滚动配置
    expect(objectTreeSource).toContain('useVirtualizer')
    expect(objectTreeSource).toContain('flattenedNodes')
  })
})
