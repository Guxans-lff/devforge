import { describe, expect, it } from 'vitest'
import { checkWorkspaceWriteGuard, clearWriteScopesBySession, createWriteScope, decideWorkspaceIsolationPolicy, detectWriteScopeConflicts, loadWorkspaceIsolationPolicy, loadWriteScopes, pruneExpiredWriteScopes, registerWorkspaceWrite, saveWorkspaceIsolationPolicy, updateTouchedPaths } from '@/ai-gui/workspaceIsolation'

function createFakeStorage(): Storage {
  const storage = new Map<string, string>()
  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
    clear: () => { storage.clear() },
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() { return storage.size },
  } as Storage
}

describe('workspaceIsolation', () => {
  it('detects overlapping touched files', () => {
    const first = updateTouchedPaths(createWriteScope('a', 'Agent A', []), ['src/a.ts', 'src/shared.ts'], 2)
    const second = updateTouchedPaths(createWriteScope('b', 'Agent B', []), ['src/shared.ts'], 3)

    expect(detectWriteScopeConflicts([first, second])).toEqual([
      { path: 'src/shared.ts', owners: ['Agent A', 'Agent B'], ownerIds: ['a', 'b'] },
    ])
  })

  it('blocks write guard when another scope touched the same file', () => {
    const scope = updateTouchedPaths(createWriteScope('a', 'Agent A', []), ['src/shared.ts'], 2)
    const guard = checkWorkspaceWriteGuard('src/shared.ts', 'Agent B', [scope])

    expect(guard.allowed).toBe(false)
    expect(guard.conflicts[0]).toMatchObject({ path: 'src/shared.ts' })
  })

  it('registers successful writes into storage', () => {
    const fakeStorage = createFakeStorage()

    registerWorkspaceWrite('tool:s1:t1', 'write_file:t1', 'src/a.ts', fakeStorage)

    expect(loadWriteScopes(fakeStorage)[0]).toMatchObject({
      ownerId: 'tool:s1:t1',
      touchedPaths: ['src/a.ts'],
    })
  })

  it('prunes expired scopes by updated time', () => {
    const fresh = createWriteScope('fresh', 'Fresh', [], 100)
    const stale = createWriteScope('stale', 'Stale', [], 1)

    expect(pruneExpiredWriteScopes([fresh, stale], 101, 50).map(item => item.ownerId)).toEqual(['fresh'])
  })

  it('clears scopes for the current session only', () => {
    const current = createWriteScope('tool:s1:t1', 'write_file:t1', [], 1)
    const other = createWriteScope('tool:s2:t1', 'write_file:t1', [], 1)
    const manual = createWriteScope('patch-1', 'Current Patch Review', [], 1)

    expect(clearWriteScopesBySession([current, other, manual], 's1').map(item => item.ownerId)).toEqual(['tool:s2:t1', 'patch-1'])
  })

  it('stores workspace isolation policy', () => {
    const fakeStorage = createFakeStorage()
    expect(loadWorkspaceIsolationPolicy(fakeStorage)).toBe('warn')

    saveWorkspaceIsolationPolicy('deny', fakeStorage)

    expect(loadWorkspaceIsolationPolicy(fakeStorage)).toBe('deny')
  })

  it('uses smart policy to deny cross-session conflicts', () => {
    const first = updateTouchedPaths(createWriteScope('tool:s1:t1', 'Agent A', []), ['src/a.ts'], 1)
    const guard = checkWorkspaceWriteGuard('src/a.ts', 'tool:s2:t2', [first])

    expect(decideWorkspaceIsolationPolicy('smart', 'tool:s2:t2', guard.conflicts)).toMatchObject({ decision: 'deny' })
  })

  it('uses smart policy to warn same-session and manual conflicts', () => {
    const sameSession = updateTouchedPaths(createWriteScope('tool:s1:t1', 'Agent A', []), ['src/a.ts'], 1)
    const manual = updateTouchedPaths(createWriteScope('patch-1', 'Manual Patch', []), ['src/b.ts'], 1)

    expect(decideWorkspaceIsolationPolicy('smart', 'tool:s1:t2', checkWorkspaceWriteGuard('src/a.ts', 'tool:s1:t2', [sameSession]).conflicts)).toMatchObject({ decision: 'warn' })
    expect(decideWorkspaceIsolationPolicy('smart', 'tool:s1:t2', checkWorkspaceWriteGuard('src/b.ts', 'tool:s1:t2', [manual]).conflicts)).toMatchObject({ decision: 'warn', requiresDoubleConfirm: true })
  })
})
