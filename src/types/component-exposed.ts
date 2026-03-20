/**
 * 组件 exposed 接口定义
 *
 * 用于替代 async component / Lazy wrapper 中的 `as any` 类型断言，
 * 为透传方法提供类型安全。
 */

import type { DatabaseTreeNode, DatabaseInfo } from './database'

/** 终端搜索选项 */
export interface TerminalSearchOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

/** TerminalPanel / TerminalPanelLazy 暴露的方法 */
export interface TerminalPanelExposed {
  sendData(data: string): void
  getSessionInfo(): { sessionId: string; cols: number; rows: number }
  reconnect(): void
  handleResize(): void
  searchFind(query: string, options?: TerminalSearchOptions): boolean
  searchFindNext(query: string, options?: TerminalSearchOptions): boolean
  searchFindPrevious(query: string, options?: TerminalSearchOptions): boolean
  searchClear(): void
  getCwd(): string
  requestCwd(): Promise<string>
}

/** SqlEditor / SqlEditorLazy 暴露的方法 */
export interface SqlEditorExposed {
  getSelectedText(): string
  focus(): void
  insertText(text: string): void
  formatDocument(): void
}

/** ObjectTree 暴露的方法 */
export interface ObjectTreeExposed {
  loadDatabases(preloaded?: DatabaseInfo[]): Promise<void>
  treeNodes: DatabaseTreeNode[]
  clearTree(): void
  forceRefresh(): Promise<void>
  silentRefresh(): Promise<void>
}
