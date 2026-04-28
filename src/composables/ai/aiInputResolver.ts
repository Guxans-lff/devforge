/**
 * AI 输入 Intent Resolver
 *
 * 统一仲裁 Enter / Shift+Enter / Slash / @ / IME / Esc 等输入事件，
 * 消除多个弹层和状态分支对输入事件的抢占。
 */

export type AiInputIntent =
  | { type: 'noop' }
  | { type: 'submit_message' }
  | { type: 'accept_slash_command'; commandId: string }
  | { type: 'accept_at_mention'; targetId: string }
  | { type: 'insert_newline' }
  | { type: 'close_popover' }
  | { type: 'navigate_popover'; direction: 'up' | 'down' }
  | { type: 'history_up' }
  | { type: 'history_down' }
  | { type: 'undo' }
  | { type: 'redo' }

export interface InputResolverContext {
  /** IME 是否正在组合输入 */
  isComposing: boolean
  /** Slash 命令浮层是否打开 */
  slashPopoverOpen: boolean
  /** @ 提及浮层是否打开 */
  atPopoverOpen: boolean
  /** 浮层中是否有高亮项（用于决定 Enter 是选择还是关闭） */
  popoverHasHighlight: boolean
  /** 当前发送模式：enter = Enter 发送，cmd = Cmd/Ctrl+Enter 发送 */
  sendMode: 'enter' | 'cmd'
  /** 光标是否在输入框开头（用于 ↑ 历史导航） */
  cursorAtStart: boolean
  /** 光标是否在输入框末尾（用于 ↓ 历史导航） */
  cursorAtEnd: boolean
}

/**
 * 解析键盘事件为统一的输入意图
 *
 * 仲裁优先级（从高到低）：
 * 1. IME 组合中 → noop
 * 2. Ctrl+Z → undo
 * 3. Ctrl+Y / Ctrl+Shift+Z → redo
 * 4. Esc → close_popover（如果有浮层）
 * 5. 浮层打开时：
 *    - Enter + 有高亮 → accept（根据浮层类型）
 *    - Enter + 无高亮 → close_popover
 *    - ArrowUp / ArrowDown → navigate_popover
 * 6. ArrowUp + 光标在开头 → history_up
 * 7. ArrowDown + 光标在末尾 → history_down
 * 8. Shift+Enter → insert_newline
 * 9. Enter + sendMode='enter' → submit_message
 * 10. Enter + sendMode='cmd' + meta/ctrl → submit_message
 */
export function resolveInputIntent(
  event: KeyboardEvent,
  context: InputResolverContext,
): AiInputIntent {
  const { key, shiftKey, ctrlKey, metaKey } = event

  // 1. IME 组合中
  if (context.isComposing) {
    return { type: 'noop' }
  }

  // 2. Ctrl+Z undo
  if (key === 'z' && (ctrlKey || metaKey) && !shiftKey) {
    return { type: 'undo' }
  }

  // 3. Ctrl+Y / Ctrl+Shift+Z redo
  if ((key === 'y' && (ctrlKey || metaKey)) || (key === 'z' && (ctrlKey || metaKey) && shiftKey)) {
    return { type: 'redo' }
  }

  // 4. Esc 关闭浮层
  if (key === 'Escape') {
    if (context.slashPopoverOpen || context.atPopoverOpen) {
      return { type: 'close_popover' }
    }
  }

  // 5. 浮层打开时的导航和选择
  if (context.slashPopoverOpen || context.atPopoverOpen) {
    if (key === 'Enter') {
      if (context.popoverHasHighlight) {
        return context.slashPopoverOpen
          ? { type: 'accept_slash_command', commandId: '' }
          : { type: 'accept_at_mention', targetId: '' }
      }
      return { type: 'close_popover' }
    }
    if (key === 'ArrowUp') {
      return { type: 'navigate_popover', direction: 'up' }
    }
    if (key === 'ArrowDown') {
      return { type: 'navigate_popover', direction: 'down' }
    }
    if (key === 'Tab') {
      return { type: 'navigate_popover', direction: shiftKey ? 'up' : 'down' }
    }
  }

  // 6. 历史导航
  if (key === 'ArrowUp' && !shiftKey && context.cursorAtStart) {
    return { type: 'history_up' }
  }
  if (key === 'ArrowDown' && !shiftKey && context.cursorAtEnd) {
    return { type: 'history_down' }
  }

  // 7. Shift+Enter 换行
  if (key === 'Enter' && shiftKey) {
    return { type: 'insert_newline' }
  }

  // 8. Enter 发送
  if (key === 'Enter' && !shiftKey) {
    if (context.sendMode === 'enter') {
      return { type: 'submit_message' }
    }
    if (context.sendMode === 'cmd' && (metaKey || ctrlKey)) {
      return { type: 'submit_message' }
    }
  }

  return { type: 'noop' }
}
