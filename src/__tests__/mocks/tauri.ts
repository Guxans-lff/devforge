/**
 * Tauri invoke mock 工具
 * 用于在测试中模拟 Tauri 命令的响应
 */
import { vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'

/** 获取被 mock 的 invoke 函数 */
export function getMockedInvoke() {
  return vi.mocked(invoke)
}

/**
 * 注册单个命令的 mock 响应
 * @param command Tauri 命令名
 * @param response 模拟返回值
 */
export function mockCommand<T>(command: string, response: T) {
  const mockedInvoke = getMockedInvoke()
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === command) return response
    throw new Error(`未 mock 的 Tauri 命令: ${cmd}`)
  })
}

/**
 * 注册多个命令的 mock 响应
 * @param commands 命令名到响应值的映射
 */
export function mockCommands(commands: Record<string, unknown>) {
  const mockedInvoke = getMockedInvoke()
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd in commands) return commands[cmd]
    throw new Error(`未 mock 的 Tauri 命令: ${cmd}`)
  })
}

/**
 * 注册单个命令返回错误
 * @param command Tauri 命令名
 * @param error 错误信息
 */
export function mockCommandError(command: string, error: string) {
  const mockedInvoke = getMockedInvoke()
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === command) throw error
    throw new Error(`未 mock 的 Tauri 命令: ${cmd}`)
  })
}

/** 重置所有 invoke mock */
export function resetInvokeMock() {
  getMockedInvoke().mockReset()
}
