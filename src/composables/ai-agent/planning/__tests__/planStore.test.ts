import { describe, it, expect, beforeEach } from 'vitest'
import {
  createPlan,
  updatePlan,
  getPlan,
  deletePlan,
  approvePlan,
  startPlanExecution,
  completePlan,
  abandonPlan,
  updateStepStatus,
  markStepInProgress,
  markStepCompleted,
  markStepFailed,
  attachJobToActivePlanStep,
  updateJobRefByJobId,
  getActivePlan,
  getSessionPlans,
  setActivePlan,
  clearActivePlan,
  getPlanCount,
  getActivePlanCount,
  clearAllPlans,
  buildPlanSummary,
  formatPlanSummaryForContext,
  getPlanChanges,
  loadPersistedPlans,
  savePersistedPlans,
  PLAN_STORE_STORAGE_KEY,
} from '@/composables/ai-agent/planning/planStore'

function createMemoryStorage(): Storage {
  const storage = new Map<string, string>()
  return {
    get length() {
      return storage.size
    },
    clear: () => { storage.clear() },
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    removeItem: (key: string) => { storage.delete(key) },
    setItem: (key: string, value: string) => { storage.set(key, value) },
  }
}

function makeStepOverrides(count: number): Array<{ index: number; title: string; description?: string }> {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    title: `Step ${i + 1}`,
    description: `Description for step ${i + 1}`,
  }))
}

function lastItem<T>(items: T[]): T {
  return items[items.length - 1]!
}

describe('planStore', () => {
  beforeEach(() => {
    clearAllPlans()
  })

  describe('createPlan', () => {
    it('creates a plan with draft status', () => {
      const plan = createPlan({
        sessionId: 'session-1',
        title: 'Refactor auth module',
        steps: makeStepOverrides(3),
      })

      expect(plan.id).toBeTruthy()
      expect(plan.sessionId).toBe('session-1')
      expect(plan.title).toBe('Refactor auth module')
      expect(plan.status).toBe('draft')
      expect(plan.steps).toHaveLength(3)
      expect(plan.steps[0]!.status).toBe('pending')
      expect(plan.createdAt).toBeGreaterThan(0)
      expect(plan.changes).toHaveLength(1)
      expect(plan.changes[0]!.type).toBe('created')
    })

    it('auto-generates step IDs', () => {
      const plan = createPlan({
        sessionId: 'session-1',
        title: 'Test',
        steps: [{ index: 0, title: 'Only step' }],
      })

      expect(plan.steps[0]!.id).toBeTruthy()
      expect(plan.steps[0]!.id.startsWith('step-')).toBe(true)
    })

    it('sets relatedFiles when provided', () => {
      const plan = createPlan({
        sessionId: 'session-1',
        title: 'Test',
        steps: makeStepOverrides(1),
        relatedFiles: ['/src/auth.ts', '/src/user.ts'],
      })

      expect(plan.relatedFiles).toEqual(['/src/auth.ts', '/src/user.ts'])
    })

    it('abandons old active plan for same session', () => {
      const oldPlan = createPlan({
        sessionId: 'session-1',
        title: 'Old plan',
        steps: makeStepOverrides(2),
      })

      const newPlan = createPlan({
        sessionId: 'session-1',
        title: 'New plan',
        steps: makeStepOverrides(2),
      })

      expect(getPlan(oldPlan.id)!.status).toBe('abandoned')
      expect(lastItem(getPlan(oldPlan.id)!.changes).type).toBe('abandoned')
      expect(getActivePlan('session-1')!.id).toBe(newPlan.id)
    })

    it('does not abandon completed old plan', () => {
      const oldPlan = createPlan({
        sessionId: 'session-1',
        title: 'Old plan',
        steps: makeStepOverrides(2),
      })
      approvePlan(oldPlan.id)
      startPlanExecution(oldPlan.id)
      completePlan(oldPlan.id)

      createPlan({
        sessionId: 'session-1',
        title: 'New plan',
        steps: makeStepOverrides(2),
      })

      expect(getPlan(oldPlan.id)!.status).toBe('completed')
    })
  })

  describe('getPlan / updatePlan / deletePlan', () => {
    it('gets a plan by id', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(1) })
      expect(getPlan(plan.id)!.title).toBe('Test')
    })

    it('returns undefined for non-existent plan', () => {
      expect(getPlan('non-existent')).toBeUndefined()
    })

    it('updates plan fields', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Old', steps: makeStepOverrides(1) })
      const updated = updatePlan(plan.id, { title: 'New', description: 'Desc' })

      expect(updated!.title).toBe('New')
      expect(updated!.description).toBe('Desc')
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(plan.updatedAt)
      expect(lastItem(updated!.changes).type).toBe('updated')
      expect(lastItem(updated!.changes).metadata).toEqual({ fields: ['title', 'description'] })
    })

    it('does not allow updatePlan patch to replace change history', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Old', steps: makeStepOverrides(1) })
      const updated = updatePlan(plan.id, { title: 'New', changes: [] } as never)

      expect(updated!.changes).toHaveLength(2)
      expect(updated!.changes[0]!.type).toBe('created')
      expect(updated!.changes[1]!.type).toBe('updated')
    })

    it('returns null when updating non-existent plan', () => {
      expect(updatePlan('fake', { title: 'x' })).toBeNull()
    })

    it('deletes a plan and clears active reference', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(1) })
      expect(deletePlan(plan.id)).toBe(true)
      expect(getPlan(plan.id)).toBeUndefined()
      expect(getActivePlan('s1')).toBeUndefined()
    })

    it('returns false when deleting non-existent plan', () => {
      expect(deletePlan('fake')).toBe(false)
    })
  })

  describe('state transitions', () => {
    it('approves a draft plan', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(2) })
      const approved = approvePlan(plan.id)

      expect(approved!.status).toBe('approved')
      expect(approved!.approvedAt).toBeGreaterThan(0)
      expect(lastItem(approved!.changes).type).toBe('approved')
    })

    it('cannot approve non-draft plan', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(1) })
      approvePlan(plan.id)
      expect(approvePlan(plan.id)).toBeNull()
    })

    it('starts execution from approved', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(1) })
      approvePlan(plan.id)
      const started = startPlanExecution(plan.id)

      expect(started!.status).toBe('in_progress')
      expect(lastItem(started!.changes).type).toBe('started')
    })

    it('cannot start execution from draft', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(1) })
      expect(startPlanExecution(plan.id)).toBeNull()
    })

    it('completes an in-progress plan', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(1) })
      approvePlan(plan.id)
      startPlanExecution(plan.id)
      const completed = completePlan(plan.id)

      expect(completed!.status).toBe('completed')
      expect(completed!.completedAt).toBeGreaterThan(0)
      expect(lastItem(completed!.changes).type).toBe('completed')
    })

    it('abandons a draft plan', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(1) })
      const abandoned = abandonPlan(plan.id)

      expect(abandoned!.status).toBe('abandoned')
      expect(lastItem(abandoned!.changes).type).toBe('abandoned')
    })

    it('cannot abandon a completed plan', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(1) })
      approvePlan(plan.id)
      startPlanExecution(plan.id)
      completePlan(plan.id)

      expect(abandonPlan(plan.id)).toBeNull()
    })
  })

  describe('step operations', () => {
    it('marks step in progress', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(3) })
      const updated = markStepInProgress(plan.id, 0)

      expect(updated!.steps[0]!.status).toBe('in_progress')
      expect(updated!.steps[0]!.startedAt).toBeGreaterThan(0)
      expect(lastItem(updated!.changes).type).toBe('step_status_changed')
      expect(lastItem(updated!.changes).toStatus).toBe('in_progress')
    })

    it('marks step completed', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(3) })
      markStepInProgress(plan.id, 0)
      const updated = markStepCompleted(plan.id, 0)

      expect(updated!.steps[0]!.status).toBe('completed')
      expect(updated!.steps[0]!.completedAt).toBeGreaterThan(0)
      expect(lastItem(updated!.changes).toStatus).toBe('completed')
    })

    it('auto-completes plan when all steps done', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(2) })
      approvePlan(plan.id)
      startPlanExecution(plan.id)

      markStepCompleted(plan.id, 0)
      const updated = markStepCompleted(plan.id, 1)

      expect(updated!.status).toBe('completed')
    })

    it('does not auto-complete when some steps pending', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(2) })
      approvePlan(plan.id)
      startPlanExecution(plan.id)

      const updated = markStepCompleted(plan.id, 0)
      expect(updated!.status).toBe('in_progress')
    })

    it('marks step failed', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(1) })
      const updated = markStepFailed(plan.id, 0, 'Tool timeout')

      expect(updated!.steps[0]!.status).toBe('failed')
      expect(updated!.steps[0]!.error).toBe('Tool timeout')
      expect(lastItem(updated!.changes).metadata).toEqual({ error: 'Tool timeout' })
    })

    it('updates step status by stepId', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(2) })
      const stepId = plan.steps[1]!.id
      const updated = updateStepStatus(plan.id, stepId, 'skipped')

      expect(updated!.steps[1]!.status).toBe('skipped')
      expect(updated!.steps[1]!.completedAt).toBeGreaterThan(0)
    })

    it('returns null for invalid step index', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(1) })
      expect(markStepInProgress(plan.id, 99)).toBeNull()
    })
  })

  describe('session queries', () => {
    it('gets active plan for session', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(1) })
      expect(getActivePlan('s1')!.id).toBe(plan.id)
    })

    it('returns undefined when no active plan', () => {
      expect(getActivePlan('no-session')).toBeUndefined()
    })

    it('gets all session plans sorted by createdAt desc', () => {
      const p1 = createPlan({ sessionId: 's1', title: 'First', steps: makeStepOverrides(1) })
      // 等待 10ms 确保 createdAt 不同
      const start = Date.now()
      while (Date.now() - start < 10) { /* busy wait */ }
      const p2 = createPlan({ sessionId: 's1', title: 'Second', steps: makeStepOverrides(1) })
      const p3 = createPlan({ sessionId: 's2', title: 'Other', steps: makeStepOverrides(1) })

      const s1Plans = getSessionPlans('s1')
      expect(s1Plans).toHaveLength(2)
      expect(s1Plans[0]!.id).toBe(p2.id)
      expect(s1Plans[1]!.id).toBe(p1.id)

      expect(getSessionPlans('s2')).toHaveLength(1)
      expect(getSessionPlans('s2')[0]!.id).toBe(p3.id)
    })

    it('setActivePlan validates session ownership', () => {
      const p1 = createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(1) })
      expect(setActivePlan('s2', p1.id)).toBe(false)
      expect(setActivePlan('s1', p1.id)).toBe(true)
    })

    it('clearActivePlan removes active reference', () => {
      createPlan({ sessionId: 's1', title: 'Test', steps: makeStepOverrides(1) })
      clearActivePlan('s1')
      expect(getActivePlan('s1')).toBeUndefined()
    })
  })

  describe('global counts', () => {
    it('counts all plans', () => {
      createPlan({ sessionId: 's1', title: 'A', steps: makeStepOverrides(1) })
      createPlan({ sessionId: 's2', title: 'B', steps: makeStepOverrides(1) })
      expect(getPlanCount()).toBe(2)
    })

    it('counts active (non-terminal) plans', () => {
      const p1 = createPlan({ sessionId: 's1', title: 'A', steps: makeStepOverrides(1) })
      const p2 = createPlan({ sessionId: 's2', title: 'B', steps: makeStepOverrides(1) })
      abandonPlan(p2.id)

      expect(getActivePlanCount()).toBe(1)
    })
  })

  describe('buildPlanSummary', () => {
    it('builds summary with correct counts', () => {
      const plan = createPlan({
        sessionId: 's1',
        title: 'Refactor',
        steps: [
          { index: 0, title: 'Step 1' },
          { index: 1, title: 'Step 2' },
          { index: 2, title: 'Step 3' },
        ],
      })
      approvePlan(plan.id)
      startPlanExecution(plan.id)
      markStepCompleted(plan.id, 0)
      markStepInProgress(plan.id, 1)

      const summary = buildPlanSummary(getPlan(plan.id)!)
      expect(summary.title).toBe('Refactor')
      expect(summary.status).toBe('in_progress')
      expect(summary.stepCount).toBe(3)
      expect(summary.completedStepCount).toBe(1)
      expect(summary.activeStepTitle).toBe('Step 2')
      expect(summary.lastChangeSummary).toContain('Step 2')
      expect(summary.lastChangeAt).toBeGreaterThan(0)
    })

    it('formats summary for context injection', () => {
      const plan = createPlan({
        sessionId: 's1',
        title: 'Fix bug',
        steps: [
          { index: 0, title: 'Step 1' },
          { index: 1, title: 'Step 2' },
          { index: 2, title: 'Step 3' },
        ],
      })
      approvePlan(plan.id)
      startPlanExecution(plan.id)
      markStepCompleted(plan.id, 0)
      markStepCompleted(plan.id, 1)
      markStepInProgress(plan.id, 2)

      const summary = buildPlanSummary(getPlan(plan.id)!)
      const text = formatPlanSummaryForContext(summary)
      expect(text).toContain('[Active Plan] Fix bug')
      expect(text).toContain('Status: in_progress')
      expect(text).toContain('Progress: 2/3 steps completed')
      expect(text).toContain('Current step: Step 3')
      expect(text).toContain('Last change:')
    })

    it('formats job evidence and recent changes for compact context', () => {
      const plan = createPlan({
        sessionId: 's1',
        title: 'Verify schema',
        steps: [
          { index: 0, title: 'Run schema compare' },
          { index: 1, title: 'Fix migration' },
        ],
      })
      approvePlan(plan.id)
      startPlanExecution(plan.id)
      markStepInProgress(plan.id, 0)
      attachJobToActivePlanStep('s1', {
        jobId: 'job-schema-1',
        kind: 'schema_compare',
        status: 'running',
        title: 'Schema 对比：dev → prod',
        resultSummary: 'dev@local -> prod@remote',
      })
      attachJobToActivePlanStep('s1', {
        jobId: 'job-verify-1',
        kind: 'verification',
        status: 'failed',
        title: 'pnpm test',
        error: 'migration test failed',
      })

      const summary = buildPlanSummary(getPlan(plan.id)!)
      const text = formatPlanSummaryForContext(summary)

      expect(summary.activeStepJobRefs).toHaveLength(2)
      expect(summary.attentionJobSummaries?.join('\n')).toContain('migration test failed')
      expect(text).toContain('Recent plan changes:')
      expect(text).toContain('Current step jobs:')
      expect(text).toContain('Schema 对比：dev → prod')
      expect(text).toContain('Plan jobs needing attention:')
      expect(text).toContain('pnpm test [failed]')
    })
  })

  describe('change history', () => {
    it('records lifecycle changes in order', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Lifecycle', steps: makeStepOverrides(1) })
      approvePlan(plan.id)
      startPlanExecution(plan.id)
      markStepInProgress(plan.id, 0)
      markStepCompleted(plan.id, 0)

      expect(getPlanChanges(plan.id).map(change => change.type)).toEqual([
        'created',
        'approved',
        'started',
        'step_status_changed',
        'step_status_changed',
        'completed',
      ])
    })

    it('returns a copy of plan changes', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Copy', steps: makeStepOverrides(1) })
      updatePlan(plan.id, { title: 'Copy updated' })

      const changes = getPlanChanges(plan.id)
      changes[0]!.summary = 'mutated'
      changes[1]!.metadata = { fields: ['mutated'] }

      const originalChanges = getPlanChanges(plan.id)
      expect(originalChanges[0]!.summary).not.toBe('mutated')
      expect(originalChanges[1]!.metadata).toEqual({ fields: ['title'] })
    })

    it('records active plan changes', () => {
      const first = createPlan({ sessionId: 's1', title: 'First', steps: makeStepOverrides(1) })
      createPlan({ sessionId: 's1', title: 'Second', steps: makeStepOverrides(1) })

      expect(setActivePlan('s1', first.id)).toBe(true)
      expect(lastItem(getPlanChanges(first.id)).type).toBe('active_changed')
    })

    it('records job refs on the active plan step', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Jobs', steps: makeStepOverrides(2) })
      approvePlan(plan.id)
      startPlanExecution(plan.id)
      markStepInProgress(plan.id, 0)

      const updated = attachJobToActivePlanStep('s1', {
        jobId: 'job-verify-1',
        kind: 'verification',
        status: 'queued',
        title: 'pnpm test',
      })

      expect(updated!.steps[0]!.jobRefs).toEqual([
        expect.objectContaining({ jobId: 'job-verify-1', kind: 'verification', status: 'queued' }),
      ])
      expect(lastItem(getPlanChanges(plan.id)).type).toBe('job_attached')
    })

    it('updates job refs by job id', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Jobs', steps: makeStepOverrides(1) })
      attachJobToActivePlanStep('s1', {
        jobId: 'job-verify-1',
        kind: 'verification',
        status: 'queued',
      })

      const updated = updateJobRefByJobId('job-verify-1', {
        status: 'succeeded',
        resultSummary: 'Verification passed',
      })

      expect(updated!.steps[0]!.jobRefs![0]).toMatchObject({
        jobId: 'job-verify-1',
        status: 'succeeded',
        resultSummary: 'Verification passed',
      })
      expect(lastItem(getPlanChanges(plan.id)).type).toBe('job_updated')
    })

    it('does not move plan updatedAt backwards when attaching restored job refs', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Jobs', steps: makeStepOverrides(1) })
      attachJobToActivePlanStep('s1', {
        jobId: 'job-verify-1',
        kind: 'verification',
        status: 'queued',
        attachedAt: 100,
      })

      const updated = getPlan(plan.id)!
      expect(updated.updatedAt).toBeGreaterThanOrEqual(plan.createdAt)
      expect(updated.updatedAt).toBeGreaterThan(100)
      expect(updated.steps[0]!.jobRefs![0]!.attachedAt).toBe(100)
    })

    it('uses job update time when refreshing job refs', () => {
      const plan = createPlan({ sessionId: 's1', title: 'Jobs', steps: makeStepOverrides(1) })
      attachJobToActivePlanStep('s1', {
        jobId: 'job-verify-1',
        kind: 'verification',
        status: 'queued',
      })
      const attachedAt = getPlan(plan.id)!.updatedAt

      attachJobToActivePlanStep('s1', {
        jobId: 'job-verify-1',
        kind: 'verification',
        status: 'succeeded',
        resultSummary: 'Verification passed',
        updatedAt: attachedAt + 1000,
      })

      const updated = getPlan(plan.id)!
      expect(updated.updatedAt).toBeGreaterThan(attachedAt)
      expect(updated.steps[0]!.jobRefs![0]!.updatedAt).toBe(updated.updatedAt)
    })
  })

  describe('persistence', () => {
    it('saves and restores plans with active mapping and changes', () => {
      const storage = createMemoryStorage()
      const plan = createPlan({ sessionId: 's1', title: 'Persisted', steps: makeStepOverrides(2) })
      approvePlan(plan.id)
      startPlanExecution(plan.id)
      markStepInProgress(plan.id, 0)
      savePersistedPlans(storage)

      clearAllPlans()
      expect(getPlanCount()).toBe(0)

      expect(loadPersistedPlans(storage)).toBe(true)
      expect(getPlanCount()).toBe(1)
      expect(getActivePlan('s1')!.id).toBe(plan.id)
      expect(getActivePlan('s1')!.status).toBe('in_progress')
      expect(getPlanChanges(plan.id).map(change => change.type)).toEqual([
        'created',
        'approved',
        'started',
        'step_status_changed',
      ])
    })

    it('restores step job refs from persisted snapshot', () => {
      const storage = createMemoryStorage()
      const plan = createPlan({ sessionId: 's1', title: 'Persisted jobs', steps: makeStepOverrides(1) })
      attachJobToActivePlanStep('s1', {
        jobId: 'job-verify-1',
        kind: 'verification',
        status: 'queued',
      })
      updateJobRefByJobId('job-verify-1', { status: 'failed', error: 'failed' })
      savePersistedPlans(storage)

      clearAllPlans()
      expect(loadPersistedPlans(storage)).toBe(true)

      expect(getPlan(plan.id)!.steps[0]!.jobRefs![0]).toMatchObject({
        jobId: 'job-verify-1',
        status: 'failed',
        error: 'failed',
      })
    })

    it('removes persisted snapshot when store is empty', () => {
      const storage = createMemoryStorage()
      createPlan({ sessionId: 's1', title: 'Persisted', steps: makeStepOverrides(1) })
      savePersistedPlans(storage)

      expect(storage.getItem(PLAN_STORE_STORAGE_KEY)).toBeTruthy()

      clearAllPlans()
      savePersistedPlans(storage)

      expect(storage.getItem(PLAN_STORE_STORAGE_KEY)).toBeNull()
    })

    it('ignores invalid persisted data', () => {
      const storage = createMemoryStorage()
      storage.setItem(PLAN_STORE_STORAGE_KEY, JSON.stringify({ version: 1, plans: [{ id: 1 }] }))

      expect(loadPersistedPlans(storage)).toBe(true)
      expect(getPlanCount()).toBe(0)
    })

    it('returns false for broken persisted json', () => {
      const storage = createMemoryStorage()
      storage.setItem(PLAN_STORE_STORAGE_KEY, '{broken')

      expect(loadPersistedPlans(storage)).toBe(false)
      expect(getPlanCount()).toBe(0)
    })
  })
})
