import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startInteractionRecoveryGuard } from '@/composables/useInteractionRecovery'

function mockViewportRect(element: HTMLElement): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    width: window.innerWidth,
    height: window.innerHeight,
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
}

describe('useInteractionRecovery', () => {
  let cleanup: (() => void) | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
    document.body.style.pointerEvents = ''
    document.documentElement.style.pointerEvents = ''
  })

  afterEach(() => {
    cleanup?.()
    cleanup = null
    document.body.innerHTML = ''
    document.body.style.pointerEvents = ''
    document.documentElement.style.pointerEvents = ''
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('启动时恢复没有打开弹层保护的 pointer lock', () => {
    document.body.style.pointerEvents = 'none'

    cleanup = startInteractionRecoveryGuard()

    expect(document.body.style.pointerEvents).toBe('')
  })

  it('只有打开态 overlay 但没有内容时会恢复 pointer lock', () => {
    const overlay = document.createElement('div')
    overlay.dataset.slot = 'dialog-overlay'
    overlay.dataset.state = 'open'
    overlay.style.position = 'fixed'
    overlay.style.inset = '0'
    overlay.style.pointerEvents = 'auto'
    mockViewportRect(overlay)
    document.body.appendChild(overlay)
    document.body.style.pointerEvents = 'none'

    cleanup = startInteractionRecoveryGuard()

    expect(overlay.style.pointerEvents).toBe('none')
    expect(document.body.style.pointerEvents).toBe('')
  })

  it('存在合法打开弹层内容时不恢复 pointer lock', () => {
    const content = document.createElement('div')
    content.dataset.slot = 'dialog-content'
    content.dataset.state = 'open'
    document.body.appendChild(content)
    document.body.style.pointerEvents = 'none'

    cleanup = startInteractionRecoveryGuard()

    expect(document.body.style.pointerEvents).toBe('none')
  })

  it('关闭态全屏遮罩会被禁用并恢复 pointer lock', async () => {
    const overlay = document.createElement('div')
    overlay.dataset.slot = 'dialog-overlay'
    overlay.dataset.state = 'closed'
    overlay.style.position = 'fixed'
    overlay.style.inset = '0'
    overlay.style.pointerEvents = 'auto'
    mockViewportRect(overlay)
    document.body.appendChild(overlay)
    document.body.style.pointerEvents = 'none'

    cleanup = startInteractionRecoveryGuard()
    await vi.runOnlyPendingTimersAsync()

    expect(overlay.style.pointerEvents).toBe('none')
    expect(overlay.getAttribute('aria-hidden')).toBe('true')
    expect(document.body.style.pointerEvents).toBe('')
  })

  it('合法业务遮罩不会被误禁用', () => {
    const overlay = document.createElement('div')
    overlay.dataset.devforgeBlockingLayer = 'true'
    overlay.style.position = 'fixed'
    overlay.style.inset = '0'
    overlay.style.pointerEvents = 'auto'
    mockViewportRect(overlay)
    document.body.appendChild(overlay)

    cleanup = startInteractionRecoveryGuard()

    expect(overlay.style.pointerEvents).toBe('auto')
  })

  it('业务遮罩存在时仍会恢复异常 pointer lock', () => {
    const overlay = document.createElement('div')
    overlay.dataset.devforgeBlockingLayer = 'true'
    overlay.style.position = 'fixed'
    overlay.style.inset = '0'
    overlay.style.pointerEvents = 'auto'
    mockViewportRect(overlay)
    document.body.appendChild(overlay)
    document.body.style.pointerEvents = 'none'

    cleanup = startInteractionRecoveryGuard()

    expect(overlay.style.pointerEvents).toBe('auto')
    expect(document.body.style.pointerEvents).toBe('')
  })

  it('按 Escape 会触发一次恢复检查', () => {
    document.body.style.pointerEvents = 'none'
    cleanup = startInteractionRecoveryGuard()
    document.body.style.pointerEvents = 'none'

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(document.body.style.pointerEvents).toBe('')
  })

  it('点击时会禁用全屏透明拦截层', () => {
    const interceptor = document.createElement('div')
    interceptor.style.position = 'fixed'
    interceptor.style.inset = '0'
    interceptor.style.pointerEvents = 'auto'
    interceptor.style.backgroundColor = 'rgba(0, 0, 0, 0)'
    mockViewportRect(interceptor)
    document.body.appendChild(interceptor)
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [interceptor, document.body]),
    })
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(interceptor)

    cleanup = startInteractionRecoveryGuard()
    window.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }))

    expect(interceptor.style.pointerEvents).toBe('none')
    expect(interceptor.getAttribute('aria-hidden')).toBe('true')
  })
})
