import { describe, expect, it } from 'vitest'
import { resolveInputIntent } from '@/composables/ai/aiInputResolver'

function makeEvent(key: string, options?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; isComposing?: boolean }): KeyboardEvent {
  return {
    key,
    shiftKey: options?.shiftKey ?? false,
    ctrlKey: options?.ctrlKey ?? false,
    metaKey: options?.metaKey ?? false,
    isComposing: options?.isComposing ?? false,
  } as KeyboardEvent
}

const baseContext = {
  isComposing: false,
  slashPopoverOpen: false,
  atPopoverOpen: false,
  popoverHasHighlight: false,
  sendMode: 'enter' as const,
  cursorAtStart: false,
  cursorAtEnd: false,
}

describe('aiInputResolver', () => {
  it('returns noop during IME composing', () => {
    const intent = resolveInputIntent(
      makeEvent('Enter'),
      { ...baseContext, isComposing: true },
    )
    expect(intent.type).toBe('noop')
  })

  it('returns undo for Ctrl+Z', () => {
    const intent = resolveInputIntent(
      makeEvent('z', { ctrlKey: true }),
      baseContext,
    )
    expect(intent.type).toBe('undo')
  })

  it('returns redo for Ctrl+Y', () => {
    const intent = resolveInputIntent(
      makeEvent('y', { ctrlKey: true }),
      baseContext,
    )
    expect(intent.type).toBe('redo')
  })

  it('returns close_popover on Esc when popover is open', () => {
    const intent = resolveInputIntent(
      makeEvent('Escape'),
      { ...baseContext, slashPopoverOpen: true },
    )
    expect(intent.type).toBe('close_popover')
  })

  it('returns noop on Esc when no popover', () => {
    const intent = resolveInputIntent(
      makeEvent('Escape'),
      baseContext,
    )
    expect(intent.type).toBe('noop')
  })

  it('returns navigate_popover when popover is open and ArrowUp is pressed', () => {
    const intent = resolveInputIntent(
      makeEvent('ArrowUp'),
      { ...baseContext, slashPopoverOpen: true },
    )
    expect(intent.type).toBe('navigate_popover')
    expect((intent as { direction: string }).direction).toBe('up')
  })

  it('returns history_up on ArrowUp at cursor start', () => {
    const intent = resolveInputIntent(
      makeEvent('ArrowUp'),
      { ...baseContext, cursorAtStart: true },
    )
    expect(intent.type).toBe('history_up')
  })

  it('returns history_down on ArrowDown at cursor end', () => {
    const intent = resolveInputIntent(
      makeEvent('ArrowDown'),
      { ...baseContext, cursorAtEnd: true },
    )
    expect(intent.type).toBe('history_down')
  })

  it('returns insert_newline for Shift+Enter', () => {
    const intent = resolveInputIntent(
      makeEvent('Enter', { shiftKey: true }),
      baseContext,
    )
    expect(intent.type).toBe('insert_newline')
  })

  it('returns submit_message for Enter in enter mode', () => {
    const intent = resolveInputIntent(
      makeEvent('Enter'),
      { ...baseContext, sendMode: 'enter' },
    )
    expect(intent.type).toBe('submit_message')
  })

  it('returns noop for plain Enter in cmd mode', () => {
    const intent = resolveInputIntent(
      makeEvent('Enter'),
      { ...baseContext, sendMode: 'cmd' },
    )
    expect(intent.type).toBe('noop')
  })

  it('returns submit_message for Cmd+Enter in cmd mode', () => {
    const intent = resolveInputIntent(
      makeEvent('Enter', { metaKey: true }),
      { ...baseContext, sendMode: 'cmd' },
    )
    expect(intent.type).toBe('submit_message')
  })

  it('returns submit_message for Ctrl+Enter in cmd mode', () => {
    const intent = resolveInputIntent(
      makeEvent('Enter', { ctrlKey: true }),
      { ...baseContext, sendMode: 'cmd' },
    )
    expect(intent.type).toBe('submit_message')
  })
})
