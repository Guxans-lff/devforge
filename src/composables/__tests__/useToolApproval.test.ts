import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearApprovalStateForTests,
  clearTrustedKeys,
  requestApproval,
  resolveApproval,
  setActiveSessionId,
  usePendingApproval,
  useTrustedKeys,
} from '@/composables/useToolApproval'

describe('useToolApproval', () => {
  const sessionId = 'test-session'

  beforeEach(() => {
    clearApprovalStateForTests()
    localStorage.clear()
    setActiveSessionId(sessionId)
  })

  it('allow 单次放行，不进入信任集合', async () => {
    const pending = usePendingApproval(sessionId)
    const trusted = useTrustedKeys(sessionId)

    const p = requestApproval({
      toolName: 'write_file',
      path: 'D:/workspace/a.txt',
      newContent: 'hello',
      sessionId,
    })

    await Promise.resolve()
    expect(pending.value).not.toBeNull()
    expect(pending.value?.toolName).toBe('write_file')

    resolveApproval('allow', sessionId)
    const decision = await p
    expect(decision).toBe('allow')
    expect(trusted.value.has('D:/workspace/a.txt')).toBe(false)
  })

  it('deny 返回 deny', async () => {
    const p = requestApproval({
      toolName: 'bash',
      command: 'cargo check',
      sessionId,
    })
    await Promise.resolve()
    resolveApproval('deny', sessionId)
    await expect(p).resolves.toBe('deny')
  })

  it('trust 一次后，同 session 同 key 下次自动放行', async () => {
    const pending = usePendingApproval(sessionId)
    const trusted = useTrustedKeys(sessionId)

    const p1 = requestApproval({
      toolName: 'edit_file',
      path: 'D:/workspace/b.ts',
      newContent: 'x',
      sessionId,
    })
    await Promise.resolve()
    resolveApproval('trust', sessionId)
    expect(await p1).toBe('allow')
    expect(trusted.value.has('D:/workspace/b.ts')).toBe(true)

    const p2 = requestApproval({
      toolName: 'edit_file',
      path: 'D:/workspace/b.ts',
      newContent: 'y',
      sessionId,
    })
    expect(pending.value).toBeNull()
    expect(await p2).toBe('allow')
  })

  it('信任集合按 session 隔离', async () => {
    const otherSessionId = 'other-session'
    const trusted = useTrustedKeys(sessionId)
    const otherTrusted = useTrustedKeys(otherSessionId)

    const p1 = requestApproval({
      toolName: 'write_file',
      path: 'D:/workspace/scoped.txt',
      newContent: 'a',
      sessionId,
    })
    await Promise.resolve()
    resolveApproval('trust', sessionId)
    await p1

    expect(trusted.value.has('D:/workspace/scoped.txt')).toBe(true)
    expect(otherTrusted.value.has('D:/workspace/scoped.txt')).toBe(false)

    const p2 = requestApproval({
      toolName: 'write_file',
      path: 'D:/workspace/scoped.txt',
      newContent: 'b',
      sessionId: otherSessionId,
    })
    await Promise.resolve()
    expect(usePendingApproval(otherSessionId).value).not.toBeNull()
    resolveApproval('deny', otherSessionId)
    await expect(p2).resolves.toBe('deny')
  })

  it('清空信任集合后，同 key 重新要求审批', async () => {
    const pending = usePendingApproval(sessionId)
    const p1 = requestApproval({
      toolName: 'write_file',
      path: 'D:/workspace/c.txt',
      newContent: 'c',
      sessionId,
    })
    await Promise.resolve()
    resolveApproval('trust', sessionId)
    await p1

    clearTrustedKeys()

    const p2 = requestApproval({
      toolName: 'write_file',
      path: 'D:/workspace/c.txt',
      newContent: 'c2',
      sessionId,
    })
    await Promise.resolve()
    expect(pending.value).not.toBeNull()
    resolveApproval('deny', sessionId)
    await p2
  })

  it('信任的 trustKey 区分 bash 命令与路径', async () => {
    const trusted = useTrustedKeys(sessionId)

    const pBash = requestApproval({
      toolName: 'bash',
      command: 'cargo test',
      sessionId,
    })
    await Promise.resolve()
    resolveApproval('trust', sessionId)
    await pBash

    expect(trusted.value.has('cargo test')).toBe(true)
    expect(trusted.value.has('D:/workspace/x.txt')).toBe(false)
  })
})
