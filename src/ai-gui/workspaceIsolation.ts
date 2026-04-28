export interface WorkspaceWriteScope {
  ownerId: string
  ownerLabel: string
  allowedPaths: string[]
  touchedPaths: string[]
  createdAt: number
  updatedAt: number
}

export interface WorkspaceIsolationConflict {
  path: string
  owners: string[]
  ownerIds: string[]
}

export interface WorkspaceWriteGuardResult {
  allowed: boolean
  normalizedPath: string
  conflicts: WorkspaceIsolationConflict[]
  reason?: string
}

export type WorkspaceIsolationPolicy = 'warn' | 'deny'
export type WorkspaceIsolationPolicyMode = WorkspaceIsolationPolicy | 'smart'
export type WorkspaceIsolationDecision = 'allow' | 'warn' | 'deny'

export interface WorkspaceIsolationPolicyDecision {
  decision: WorkspaceIsolationDecision
  reason?: string
  requiresDoubleConfirm?: boolean
}

const STORAGE_KEY = 'devforge.ai.workspace.isolation.v1'
const POLICY_STORAGE_KEY = 'devforge.ai.workspace.isolation.policy.v1'
export const DEFAULT_SCOPE_TTL_MS = 24 * 60 * 60 * 1000

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function createWriteScope(ownerId: string, ownerLabel: string, allowedPaths: string[] = [], now = Date.now()): WorkspaceWriteScope {
  return {
    ownerId,
    ownerLabel,
    allowedPaths: allowedPaths.map(normalizePath),
    touchedPaths: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function updateTouchedPaths(scope: WorkspaceWriteScope, paths: string[], now = Date.now()): WorkspaceWriteScope {
  const nextPaths = new Set([...scope.touchedPaths, ...paths.map(normalizePath)])
  return { ...scope, touchedPaths: [...nextPaths].sort(), updatedAt: now }
}

export function detectWriteScopeConflicts(scopes: WorkspaceWriteScope[]): WorkspaceIsolationConflict[] {
  const pathOwners = new Map<string, Array<{ id: string; label: string }>>()
  for (const scope of scopes) {
    for (const path of scope.touchedPaths) {
      pathOwners.set(path, [...(pathOwners.get(path) ?? []), { id: scope.ownerId, label: scope.ownerLabel }])
    }
  }
  return [...pathOwners.entries()]
    .filter(([, owners]) => new Set(owners.map(owner => owner.id)).size > 1)
    .map(([path, owners]) => ({
      path,
      owners: [...new Set(owners.map(owner => owner.label))],
      ownerIds: [...new Set(owners.map(owner => owner.id))],
    }))
}

export function checkWorkspaceWriteGuard(path: string, ownerId: string, scopes: WorkspaceWriteScope[]): WorkspaceWriteGuardResult {
  const normalizedPath = normalizePath(path)
  const conflicts = detectWriteScopeConflicts([
    ...scopes,
    updateTouchedPaths(createWriteScope(ownerId, ownerId), [normalizedPath]),
  ]).filter(conflict => conflict.path === normalizedPath)

  return {
    allowed: conflicts.length === 0,
    normalizedPath,
    conflicts,
    reason: conflicts.length > 0
      ? `workspace isolation conflict: ${normalizedPath} touched by ${conflicts[0]?.owners.join(' / ')}`
      : undefined,
  }
}

export function loadWorkspaceIsolationPolicy(storage: Storage | undefined = globalThis.localStorage): WorkspaceIsolationPolicyMode {
  if (!storage) return 'warn'
  const value = storage.getItem(POLICY_STORAGE_KEY)
  return value === 'deny' || value === 'smart' ? value : 'warn'
}

export function saveWorkspaceIsolationPolicy(policy: WorkspaceIsolationPolicyMode, storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) return
  storage.setItem(POLICY_STORAGE_KEY, policy)
}

function ownerSessionId(ownerId: string): string | null {
  const match = ownerId.match(/^tool:([^:]+):/)
  return match?.[1] ?? null
}

export function decideWorkspaceIsolationPolicy(
  policy: WorkspaceIsolationPolicyMode,
  ownerId: string,
  conflicts: WorkspaceIsolationConflict[],
): WorkspaceIsolationPolicyDecision {
  if (conflicts.length === 0) return { decision: 'allow' }
  if (policy === 'warn') return { decision: 'warn', reason: 'workspace isolation conflict requires approval' }
  if (policy === 'deny') return { decision: 'deny', reason: 'workspace isolation deny policy' }

  const currentSessionId = ownerSessionId(ownerId)
  const conflictOwnerIds = conflicts.flatMap(conflict => conflict.ownerIds).filter(id => id !== ownerId)
  const hasManualScope = conflictOwnerIds.some(id => !id.startsWith('tool:'))
  const hasCrossSession = conflictOwnerIds.some(id => {
    const sessionId = ownerSessionId(id)
    return sessionId && currentSessionId && sessionId !== currentSessionId
  })

  if (hasCrossSession) return { decision: 'deny', reason: 'cross-session workspace conflict' }
  if (hasManualScope) return { decision: 'warn', reason: 'manual patch scope conflict requires approval', requiresDoubleConfirm: true }
  return { decision: 'warn', reason: 'same-session workspace conflict requires approval' }
}

export function loadWriteScopes(storage: Storage | undefined = globalThis.localStorage): WorkspaceWriteScope[] {
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(item => item?.ownerId) : []
  } catch {
    return []
  }
}

export function pruneExpiredWriteScopes(scopes: WorkspaceWriteScope[], now = Date.now(), ttlMs = DEFAULT_SCOPE_TTL_MS): WorkspaceWriteScope[] {
  return scopes.filter(scope => now - scope.updatedAt <= ttlMs)
}

export function clearWriteScopesBySession(scopes: WorkspaceWriteScope[], sessionId: string): WorkspaceWriteScope[] {
  const prefix = `tool:${sessionId}:`
  return scopes.filter(scope => !scope.ownerId.startsWith(prefix))
}

export function saveWriteScopes(scopes: WorkspaceWriteScope[], storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) return
  storage.setItem(STORAGE_KEY, JSON.stringify(scopes.slice(-20)))
}

export function registerWorkspaceWrite(ownerId: string, ownerLabel: string, path: string, storage: Storage | undefined = globalThis.localStorage): WorkspaceWriteScope[] {
  const scopes = pruneExpiredWriteScopes(loadWriteScopes(storage))
  const existing = scopes.find(scope => scope.ownerId === ownerId)
  const nextScope = updateTouchedPaths(existing ?? createWriteScope(ownerId, ownerLabel), [path])
  const nextScopes = [nextScope, ...scopes.filter(scope => scope.ownerId !== ownerId)].slice(0, 20)
  saveWriteScopes(nextScopes, storage)
  return nextScopes
}
