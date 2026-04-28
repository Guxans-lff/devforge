export type AiInputSendMode = 'enter' | 'cmd'

export type AiInputIntent =
  | { type: 'noop' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'close_popover' }
  | { type: 'history_up' }
  | { type: 'history_down' }
  | { type: 'insert_newline' }
  | { type: 'submit_message' }

export interface AiInputIntentContext {
  isComposing: boolean
  slashPopoverOpen: boolean
  atPopoverOpen: boolean
  popoverHasHighlight: boolean
  sendMode: AiInputSendMode
  cursorAtStart: boolean
  cursorAtEnd: boolean
}

export function resolveInputIntent(
  event: KeyboardEvent,
  context: AiInputIntentContext,
): AiInputIntent {
  if (context.isComposing) return { type: 'noop' }

  if (event.key === 'Escape' && (context.slashPopoverOpen || context.atPopoverOpen)) {
    return { type: 'close_popover' }
  }

  if (event.key === 'z' && (event.ctrlKey || event.metaKey)) {
    return event.shiftKey ? { type: 'redo' } : { type: 'undo' }
  }

  if (event.key === 'y' && (event.ctrlKey || event.metaKey)) {
    return { type: 'redo' }
  }

  if (event.key === 'ArrowUp' && !event.shiftKey && context.cursorAtStart) {
    return { type: 'history_up' }
  }

  if (event.key === 'ArrowDown' && !event.shiftKey && context.cursorAtEnd) {
    return { type: 'history_down' }
  }

  if (event.key !== 'Enter') return { type: 'noop' }

  if (context.slashPopoverOpen || context.atPopoverOpen || context.popoverHasHighlight) {
    return { type: 'noop' }
  }

  if (event.shiftKey) return { type: 'insert_newline' }

  if (context.sendMode === 'enter') {
    return { type: 'submit_message' }
  }

  if (event.ctrlKey || event.metaKey) {
    return { type: 'submit_message' }
  }

  return { type: 'insert_newline' }
}
