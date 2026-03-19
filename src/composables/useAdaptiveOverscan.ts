/**
 * 自适应 overscan composable
 *
 * 根据滚动速度动态调整虚拟滚动的 overscan 值：
 * - 慢速滚动（正常浏览）：使用较小的 overscan，减少 DOM 节点数
 * - 快速滚动（拖动滚动条）：自动增大 overscan，确保缓冲区覆盖滚动距离
 * - 停止滚动后：阶梯式回落到基础值，避免 DOM 大批量卸载导致帧率跌落
 *
 * @module useAdaptiveOverscan
 */
import { ref, onBeforeUnmount, type Ref } from 'vue'

/** 配置参数 */
export interface AdaptiveOverscanOptions {
  /** 基础 overscan 值（慢速滚动时使用） */
  baseOverscan?: number
  /** 最大 overscan 值（快速滚动时上限） */
  maxOverscan?: number
  /** 行高（像素），用于计算速度阈值 */
  rowHeight?: number
  /** 速度阈值（px/ms），超过此值开始增大 overscan */
  velocityThreshold?: number
  /** 回落延迟（ms），停止快速滚动后多久开始回落 */
  decayDelay?: number
}

/** 默认配置 */
const DEFAULTS = {
  baseOverscan: 20,
  maxOverscan: 80,
  rowHeight: 28,
  velocityThreshold: 15,
  decayDelay: 600,
} as const

/**
 * 自适应 overscan composable
 *
 * @param scrollElementRef - 滚动容器的 ref 引用
 * @param options - 配置参数
 * @returns overscan ref（响应式，可直接绑定到 useVirtualizer 的 overscan 选项）
 */
export function useAdaptiveOverscan(
  scrollElementRef: Ref<HTMLElement | null>,
  options: AdaptiveOverscanOptions = {},
) {
  const {
    baseOverscan = DEFAULTS.baseOverscan,
    maxOverscan = DEFAULTS.maxOverscan,
    velocityThreshold = DEFAULTS.velocityThreshold,
    decayDelay = DEFAULTS.decayDelay,
  } = options

  /** 当前动态 overscan 值 */
  const overscan = ref(baseOverscan)

  /** 上一次滚动位置 */
  let lastScrollTop = 0
  /** 上一次滚动时间戳 */
  let lastScrollTime = 0
  /** 回落定时器 */
  let decayTimer: ReturnType<typeof setTimeout> | null = null
  /** rAF 节流 ID */
  let rafId: number | null = null

  /**
   * 滚动事件处理：用 rAF 节流，保证每帧最多处理一次
   */
  function handleScroll() {
    if (rafId !== null) return
    rafId = requestAnimationFrame(processScroll)
  }

  /**
   * 实际滚动处理：计算滚动速度并动态调整 overscan
   */
  function processScroll() {
    rafId = null
    const el = scrollElementRef.value
    if (!el) return

    const now = performance.now()
    const currentScrollTop = el.scrollTop
    const timeDelta = now - lastScrollTime

    // 避免除零和首次调用
    if (timeDelta > 0 && lastScrollTime > 0) {
      // 计算滚动速度（px/ms）
      const velocity = Math.abs(currentScrollTop - lastScrollTop) / timeDelta

      if (velocity > velocityThreshold) {
        // 快速滚动：根据速度线性插值 overscan
        const speedRatio = Math.min(velocity / (velocityThreshold * 4), 1)
        const targetOverscan = Math.round(
          baseOverscan + (maxOverscan - baseOverscan) * speedRatio,
        )
        overscan.value = targetOverscan

        // 清除回落定时器（持续快速滚动时不回落）
        if (decayTimer) {
          clearTimeout(decayTimer)
          decayTimer = null
        }

        // 阶梯式回落：分 2 步回到 base，避免 DOM 大批量卸载
        decayTimer = setTimeout(() => {
          const mid = Math.round((overscan.value + baseOverscan) / 2)
          overscan.value = Math.max(mid, baseOverscan)
          decayTimer = setTimeout(() => {
            overscan.value = baseOverscan
            decayTimer = null
          }, 200)
        }, decayDelay)
      }
    }

    lastScrollTop = currentScrollTop
    lastScrollTime = now
  }

  /** 绑定滚动监听 */
  let boundElement: HTMLElement | null = null

  function bind(el: HTMLElement | null) {
    if (boundElement) {
      boundElement.removeEventListener('scroll', handleScroll)
    }
    boundElement = el
    if (el) {
      el.addEventListener('scroll', handleScroll, { passive: true })
    }
  }

  /** 手动绑定（供 watch scrollElementRef 使用） */
  function attach() {
    bind(scrollElementRef.value)
  }

  /** 手动解绑 */
  function detach() {
    bind(null)
    if (decayTimer) {
      clearTimeout(decayTimer)
      decayTimer = null
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  // 安全注册生命周期钩子（在非组件上下文中优雅降级）
  try {
    onBeforeUnmount(detach)
  } catch {
    // 在非组件上下文中调用时忽略（如单元测试）
  }

  return {
    /** 动态 overscan 值（响应式） */
    overscan,
    /** 绑定到滚动容器 */
    attach,
    /** 解绑滚动容器 */
    detach,
  }
}
