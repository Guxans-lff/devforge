import { describe, it, expect, beforeEach } from 'vitest'
import {
  requestApproval,
  resolveApproval,
  usePendingApproval,
  useTrustedKeys,
  clearTrustedKeys,
} from '@/composables/useToolApproval'

/**
 * useToolApproval 关键语义测试：
 * - 允许一次 / 拒绝 / 信任
 * - 信任后同 key 自动放行（不再进入 pending）
 * - 清空信任集合能恢复弹窗
 */
describe('useToolApproval', () => {
  beforeEach(() => {
    // 每个用例起跑前清空信任集合
    clearTrustedKeys()
    localStorage.clear()
  })

  it('allow 单次放行，不进入信任集合', async () => {
    const pending = usePendingApproval()
    const trusted = useTrustedKeys()

    const p = requestApproval({
      toolName: 'write_file',
      path: 'D:/workspace/a.txt',
      newContent: 'hello',
    })

    // 下一 tick pending 就有值
    await Promise.resolve()
    expect(pending.value).not.toBeNull()
    expect(pending.value?.toolName).toBe('write_file')

    resolveApproval('allow')
    const decision = await p
    expect(decision).toBe('allow')
    expect(trusted.value.has('D:/workspace/a.txt')).toBe(false)
  })

  it('deny 返回 deny', async () => {
    const p = requestApproval({
      toolName: 'bash',
      command: 'cargo check',
    })
    await Promise.resolve()
    resolveApproval('deny')
    await expect(p).resolves.toBe('deny')
  })

  it('trust 一次后，同 key 下次自动放行', async () => {
    const pending = usePendingApproval()
    const trusted = useTrustedKeys()

    const p1 = requestApproval({
      toolName: 'edit_file',
      path: 'D:/workspace/b.ts',
      newContent: 'x',
    })
    await Promise.resolve()
    resolveApproval('trust')
    expect(await p1).toBe('allow')
    expect(trusted.value.has('D:/workspace/b.ts')).toBe(true)

    // 第二次同路径 — 应立即 allow，不触发 pending
    const p2 = requestApproval({
      toolName: 'edit_file',
      path: 'D:/workspace/b.ts',
      newContent: 'y',
    })
    expect(pending.value).toBeNull()
    expect(await p2).toBe('allow')
  })

  it('清空信任集合后，同 key 重新要求审批', async () => {
    const pending = usePendingApproval()
    const p1 = requestApproval({
      toolName: 'write_file',
      path: 'D:/workspace/c.txt',
      newContent: 'c',
    })
    await Promise.resolve()
    resolveApproval('trust')
    await p1

    clearTrustedKeys()

    const p2 = requestApproval({
      toolName: 'write_file',
      path: 'D:/workspace/c.txt',
      newContent: 'c2',
    })
    await Promise.resolve()
    expect(pending.value).not.toBeNull()
    resolveApproval('deny')
    await p2
  })

  it('信任的 trustKey 区分 bash 命令与路径', async () => {
    const trusted = useTrustedKeys()

    const pBash = requestApproval({
      toolName: 'bash',
      command: 'cargo test',
    })
    await Promise.resolve()
    resolveApproval('trust')
    await pBash

    expect(trusted.value.has('cargo test')).toBe(true)
    expect(trusted.value.has('D:/workspace/x.txt')).toBe(false)
  })
})
