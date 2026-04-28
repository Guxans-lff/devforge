import { createLogger } from '@/utils/logger'

const log = createLogger('ui.interaction-recovery')

const OPEN_BLOCKING_SELECTOR = [
  '[data-slot="dialog-content"][data-state="open"]',
  '[data-slot="sheet-content"][data-state="open"]',
  '[role="dialog"][data-state="open"]',
].join(',')

const CLOSED_BLOCKING_SELECTOR = [
  '[data-slot="dialog-content"][data-state="closed"]',
  '[data-slot="sheet-content"][data-state="closed"]',
  '[data-slot="dialog-overlay"][data-state="closed"]',
  '[data-slot="sheet-overlay"][data-state="closed"]',
  '[role="dialog"][data-state="closed"]',
].join(',')

function hasOpenBlockingLayer(): boolean {
  return Boolean(document.querySelector(OPEN_BLOCKING_SELECTOR))
}

function hasPointerLock(): boolean {
  return document.body.style.pointerEvents === 'none'
    || document.documentElement.style.pointerEvents === 'none'
}

function isViewportBlockingElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element.dataset.devforgeBlockingLayer === 'true') return false

  const style = window.getComputedStyle(element)
  if (style.pointerEvents === 'none') return false
  if (style.display === 'none' || style.visibility === 'hidden') return false
  if (style.opacity === '0') return false

  const rect = element.getBoundingClientRect()
  return rect.width >= window.innerWidth * 0.92
    && rect.height >= window.innerHeight * 0.92
    && rect.left <= window.innerWidth * 0.04
    && rect.top <= window.innerHeight * 0.04
}

function describeElement(element: Element | null): Record<string, unknown> | null {
  if (!(element instanceof HTMLElement)) return null
  const style = window.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || undefined,
    className: typeof element.className === 'string' ? element.className.slice(0, 180) : undefined,
    role: element.getAttribute('role') ?? undefined,
    dataSlot: element.dataset.slot,
    dataState: element.dataset.state,
    pointerEvents: style.pointerEvents,
    webkitAppRegion: style.getPropertyValue('-webkit-app-region') || undefined,
    position: style.position,
    zIndex: style.zIndex,
    opacity: style.opacity,
    rect: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  }
}

function isSuspiciousViewportInterceptor(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false
  if (element === document.body || element === document.documentElement) return false
  if (element.id === 'app' || element.closest('[data-devforge-diag]')) return false
  if (element.dataset.devforgeBlockingLayer === 'true') return false
  if (element.matches(OPEN_BLOCKING_SELECTOR)) return false

  const style = window.getComputedStyle(element)
  if (style.pointerEvents === 'none') return false
  if (style.position !== 'fixed') return false
  if (style.display === 'none' || style.visibility === 'hidden') return false

  const rect = element.getBoundingClientRect()
  const coversViewport = rect.width >= window.innerWidth * 0.92
    && rect.height >= window.innerHeight * 0.92
    && rect.left <= window.innerWidth * 0.04
    && rect.top <= window.innerHeight * 0.04
  if (!coversViewport) return false

  const className = typeof element.className === 'string' ? element.className : ''
  const transparentBackground = style.backgroundColor === 'rgba(0, 0, 0, 0)'
    || style.backgroundColor === 'transparent'
  const looksHidden = style.opacity === '0'
    || element.getAttribute('aria-hidden') === 'true'
    || className.includes('overlay')
    || className.includes('backdrop')

  return transparentBackground || looksHidden
}

function disableSuspiciousInterceptor(element: Element | null, reason: string): boolean {
  if (!isSuspiciousViewportInterceptor(element)) return false
  element.style.pointerEvents = 'none'
  element.setAttribute('aria-hidden', 'true')
  log.warn('suspicious_interceptor_disabled', {
    reason,
    target: describeElement(element),
  })
  return true
}

function getElementsFromPoint(x: number, y: number): Element[] {
  if (typeof document.elementsFromPoint === 'function') {
    return document.elementsFromPoint(x, y)
  }

  const target = document.elementFromPoint(x, y)
  return target ? [target] : []
}

function logHitTest(x = window.innerWidth / 2, y = window.innerHeight / 2): void {
  const stack = getElementsFromPoint(x, y)
    .slice(0, 12)
    .map(describeElement)

  log.warn('manual_hit_test', {
    x: Math.round(x),
    y: Math.round(y),
    bodyPointerEvents: document.body.style.pointerEvents,
    htmlPointerEvents: document.documentElement.style.pointerEvents,
    stack,
  })
}

function disableClosedBlockingLayers(reason: string): number {
  let count = 0
  for (const element of Array.from(document.querySelectorAll(CLOSED_BLOCKING_SELECTOR))) {
    if (!(element instanceof HTMLElement)) continue
    if (element.style.pointerEvents === 'none') continue
    element.style.pointerEvents = 'none'
    element.setAttribute('aria-hidden', 'true')
    count += 1
  }
  if (count > 0) {
    log.warn('closed_blocking_layers_disabled', { reason, count })
  }
  return count
}

function disableOrphanOverlays(reason: string): number {
  if (hasOpenBlockingLayer()) return 0

  let count = 0
  const selector = [
    '[data-slot="dialog-overlay"][data-state="open"]',
    '[data-slot="sheet-overlay"][data-state="open"]',
  ].join(',')

  for (const element of Array.from(document.querySelectorAll(selector))) {
    if (!(element instanceof HTMLElement)) continue
    if (!isViewportBlockingElement(element)) continue
    element.style.pointerEvents = 'none'
    element.setAttribute('aria-hidden', 'true')
    count += 1
  }

  if (count > 0) {
    log.warn('orphan_overlays_disabled', { reason, count })
  }
  return count
}

function restoreStalePointerLock(reason = 'unknown'): boolean {
  if (!hasPointerLock()) return false
  if (hasOpenBlockingLayer()) return false

  document.body.style.pointerEvents = ''
  document.documentElement.style.pointerEvents = ''
  log.warn('stale_pointer_lock_restored', { reason })
  return true
}

function recoverInteraction(reason: string): void {
  disableClosedBlockingLayers(reason)
  disableOrphanOverlays(reason)
  restoreStalePointerLock(reason)
}

export function startInteractionRecoveryGuard(): () => void {
  let disposed = false
  let remainingChecks = 12
  let timer: number | null = null
  let observerTimer: number | null = null
  let pendingObserverRun = false

  const run = (reason: string) => {
    if (disposed) return
    recoverInteraction(reason)
  }

  const scheduleNextCheck = () => {
    if (remainingChecks <= 0) return
    remainingChecks -= 1
    timer = window.setTimeout(() => {
      run('startup_window')
      scheduleNextCheck()
    }, 250)
  }

  const observer = typeof MutationObserver === 'undefined'
    ? null
    : new MutationObserver(() => {
        if (pendingObserverRun) return
        pendingObserverRun = true
        window.setTimeout(() => {
          pendingObserverRun = false
          run('dom_changed')
        }, 100)
      })

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      run('escape')
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    const target = document.elementFromPoint(event.clientX, event.clientY)
    if (import.meta.env.DEV) {
      const stack = getElementsFromPoint(event.clientX, event.clientY)
        .slice(0, 8)
        .map(describeElement)
      log.debug('pointer_hit_test', {
        x: Math.round(event.clientX),
        y: Math.round(event.clientY),
        target: describeElement(target),
        stack,
      })
    }
    disableSuspiciousInterceptor(target, 'pointer_down')
    restoreStalePointerLock('pointer_down')
  }

  if (import.meta.env.DEV) {
    ;(window as typeof window & {
      __DEVFORGE_HIT_TEST__?: (x?: number, y?: number) => void
      __DEVFORGE_UNLOCK_UI__?: () => void
      __DEVFORGE_FOCUS_TEST__?: () => void
    }).__DEVFORGE_HIT_TEST__ = logHitTest
    ;(window as typeof window & {
      __DEVFORGE_HIT_TEST__?: (x?: number, y?: number) => void
      __DEVFORGE_UNLOCK_UI__?: () => void
      __DEVFORGE_FOCUS_TEST__?: () => void
    }).__DEVFORGE_UNLOCK_UI__ = () => {
      restoreStalePointerLock('manual_unlock')
      logHitTest()
    }
    ;(window as typeof window & {
      __DEVFORGE_FOCUS_TEST__?: () => void
    }).__DEVFORGE_FOCUS_TEST__ = () => {
      log.warn('manual_focus_test', {
        activeElement: describeElement(document.activeElement),
        hasFocus: document.hasFocus(),
        visibilityState: document.visibilityState,
        bodyPointerEvents: document.body.style.pointerEvents,
        htmlPointerEvents: document.documentElement.style.pointerEvents,
      })
    }
  }

  run('mounted')
  scheduleNextCheck()
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('pointerdown', onPointerDown, true)
  observer?.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-slot', 'data-state', 'style', 'aria-hidden'],
    childList: true,
    subtree: true,
  })
  observerTimer = window.setTimeout(() => {
    observer?.disconnect()
    observerTimer = null
  }, 4000)

  return () => {
    disposed = true
    if (timer !== null) {
      window.clearTimeout(timer)
    }
    if (observerTimer !== null) {
      window.clearTimeout(observerTimer)
    }
    window.removeEventListener('keydown', onKeydown, true)
    window.removeEventListener('pointerdown', onPointerDown, true)
    if (import.meta.env.DEV) {
      delete (window as typeof window & { __DEVFORGE_HIT_TEST__?: unknown }).__DEVFORGE_HIT_TEST__
      delete (window as typeof window & { __DEVFORGE_UNLOCK_UI__?: unknown }).__DEVFORGE_UNLOCK_UI__
      delete (window as typeof window & { __DEVFORGE_FOCUS_TEST__?: unknown }).__DEVFORGE_FOCUS_TEST__
    }
    observer?.disconnect()
  }
}
