import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearApprovalStateForTests,
  clearTrustedKeys,
  getPermissionMode,
  requestApproval,
  resolveApproval,
  setActiveSessionId,
  setPermissionMode,
  useApprovalMode,
  usePendingApproval,
  usePendingToolRiskLevel,
  usePermissionMode,
  useTrustedKeys,
} from '@/composables/useToolApproval'

describe('useToolApproval', () => {
  const sessionId = 'test-session'

  beforeEach(() => {
    clearApprovalStateForTests()
    localStorage.clear()
    setActiveSessionId(sessionId)
  })

  it('allow 单次放行不进入信任集合', async () => {
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

  it('trust 后同 session 同 key 自动放行', async () => {
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

  it('清空信任集合后同 key 重新审批', async () => {
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

  it('trustKey 区分 bash 命令与路径', async () => {
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

  it('dangerous_bypass 模式下所有工具自动放行', async () => {
    setPermissionMode('dangerous_bypass', sessionId)

    const decision = await requestApproval({
      toolName: 'delete_file',
      path: 'D:/workspace/x.txt',
      sessionId,
    })

    expect(decision).toBe('allow')
    expect(useApprovalMode().value).toBe('auto')
  })

  it('read_only 模式下只允许只读工具', async () => {
    setPermissionMode('read_only', sessionId)

    await expect(requestApproval({
      toolName: 'read_file',
      path: 'D:/workspace/x.txt',
      sessionId,
    })).resolves.toBe('allow')

    await expect(requestApproval({
      toolName: 'write_file',
      path: 'D:/workspace/x.txt',
      newContent: 'a',
      sessionId,
    })).resolves.toBe('deny')
  })

  it('accept_edits 模式下 read/write 自动放行，bash 仍需确认', async () => {
    setPermissionMode('accept_edits', sessionId)

    await expect(requestApproval({
      toolName: 'write_file',
      path: 'D:/workspace/x.txt',
      newContent: 'a',
      sessionId,
    })).resolves.toBe('allow')

    const pending = usePendingApproval(sessionId)
    const p = requestApproval({
      toolName: 'bash',
      command: 'cargo test',
      sessionId,
    })

    await Promise.resolve()
    expect(pending.value?.toolName).toBe('bash')
    resolveApproval('deny', sessionId)
    await expect(p).resolves.toBe('deny')
  })

  it('暴露 PermissionMode 与 pending 风险等级', async () => {
    setPermissionMode('safe_auto', sessionId)
    expect(usePermissionMode().value).toBe('safe_auto')
    expect(getPermissionMode(sessionId)).toBe('safe_auto')

    setPermissionMode('default', sessionId)
    const riskLevel = usePendingToolRiskLevel(sessionId)
    const p = requestApproval({
      toolName: 'web_fetch',
      url: 'https://example.com',
      sessionId,
    })

    await Promise.resolve()
    expect(riskLevel.value).toBe('network')
    resolveApproval('allow', sessionId)
    await p
    expect(riskLevel.value).toBeNull()
  })
})
