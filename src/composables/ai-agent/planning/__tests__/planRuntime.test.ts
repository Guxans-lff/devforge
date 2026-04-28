import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPlanRuntime } from '@/composables/ai-agent/planning/planRuntime'
import { clearAllPlans, getActivePlan } from '@/composables/ai-agent/planning/planStore'
import type { ToolCallInfo, ToolResultInfo } from '@/types/ai'
import { createLogger } from '@/utils/logger'

const mockLog = createLogger('test')

describe('planRuntime', () => {
  beforeEach(() => {
    clearAllPlans()
  })

  function makeRuntime(sessionId = 'session-1', callbacks?: Parameters<typeof createPlanRuntime>[0]) {
    return createPlanRuntime({
      sessionId,
      log: mockLog,
      ...callbacks,
    })
  }

  describe('handlePlanText', () => {
    it('creates a plan from markdown text', () => {
      const runtime = makeRuntime()
      const plan = runtime.handlePlanText(`Refactor Plan

1. Extract service
2. Add tests
3. Update docs`)

      expect(plan).not.toBeNull()
      expect(plan!.title).toBe('Refactor Plan')
      expect(plan!.steps).toHaveLength(3)
      expect(plan!.status).toBe('draft')
    })

    it('returns null for empty text', () => {
      const runtime = makeRuntime()
      expect(runtime.handlePlanText('')).toBeNull()
      expect(runtime.handlePlanText('   ')).toBeNull()
    })

    it('calls onPlanCreated callback', () => {
      const onPlanCreated = vi.fn()
      const runtime = makeRuntime('session-1', { onPlanCreated })
      runtime.handlePlanText('Plan\n\n1. Step A')

      expect(onPlanCreated).toHaveBeenCalledOnce()
      expect(onPlanCreated.mock.calls[0]![0].title).toBe('Plan')
    })
  })

  describe('approveCurrentPlan', () => {
    it('approves the active draft plan', () => {
      const onPlanStatusChanged = vi.fn()
      const runtime = makeRuntime('session-1', { onPlanStatusChanged })
      runtime.handlePlanText('Plan\n\n1. Step A')

      const approved = runtime.approveCurrentPlan()
      expect(approved!.status).toBe('approved')
      expect(onPlanStatusChanged).toHaveBeenCalled()
    })

    it('returns null when no active plan', () => {
      const runtime = makeRuntime()
      expect(runtime.approveCurrentPlan()).toBeNull()
    })

    it('returns null when plan is not draft', () => {
      const runtime = makeRuntime()
      runtime.handlePlanText('Plan\n\n1. Step A')
      runtime.approveCurrentPlan()

      expect(runtime.approveCurrentPlan()).toBeNull()
    })
  })

  describe('abandonCurrentPlan', () => {
    it('abandons the active plan', () => {
      const onPlanStatusChanged = vi.fn()
      const runtime = makeRuntime('session-1', { onPlanStatusChanged })
      runtime.handlePlanText('Plan\n\n1. Step A')

      const abandoned = runtime.abandonCurrentPlan()
      expect(abandoned!.status).toBe('abandoned')
      expect(onPlanStatusChanged).toHaveBeenCalled()
    })

    it('returns null when no active plan', () => {
      const runtime = makeRuntime()
      expect(runtime.abandonCurrentPlan()).toBeNull()
    })
  })

  describe('startExecution', () => {
    it('starts execution after approval', () => {
      const runtime = makeRuntime()
      runtime.handlePlanText('Plan\n\n1. Step A')
      runtime.approveCurrentPlan()

      const started = runtime.startExecution()
      expect(started!.status).toBe('in_progress')
    })

    it('returns null when plan is not approved', () => {
      const runtime = makeRuntime()
      runtime.handlePlanText('Plan\n\n1. Step A')

      expect(runtime.startExecution()).toBeNull()
    })
  })

  describe('trackStepFromToolUse', () => {
    function makeToolCall(name: string): ToolCallInfo {
      return {
        id: `tc-${name}`,
        name,
        arguments: '{}',
        status: 'pending',
      }
    }

    function makeToolResult(success: boolean, content?: string): ToolResultInfo {
      return {
        toolCallId: 'tc-1',
        toolName: 'test_tool',
        success,
        content: content ?? (success ? 'ok' : 'error'),
      }
    }

    it('marks first pending step in_progress then completed on success', () => {
      const onStepStatusChanged = vi.fn()
      const runtime = makeRuntime('session-1', { onStepStatusChanged })
      runtime.handlePlanText('Plan\n\n1. Step A\n2. Step B')
      runtime.approveCurrentPlan()
      runtime.startExecution()

      runtime.trackStepFromToolUse(makeToolCall('tool1'), makeToolResult(true))

      const plan = getActivePlan('session-1')!
      expect(plan.steps[0]!.status).toBe('completed')
      expect(plan.steps[1]!.status).toBe('pending')
      expect(onStepStatusChanged).toHaveBeenCalled()
    })

    it('marks step failed on tool error', () => {
      const runtime = makeRuntime()
      runtime.handlePlanText('Plan\n\n1. Step A')
      runtime.approveCurrentPlan()
      runtime.startExecution()

      runtime.trackStepFromToolUse(makeToolCall('tool1'), makeToolResult(false, 'Timeout'))

      const plan = getActivePlan('session-1')!
      expect(plan.steps[0]!.status).toBe('failed')
      expect(plan.steps[0]!.error).toContain('Timeout')
    })

    it('auto-completes plan when all steps done', () => {
      const onPlanStatusChanged = vi.fn()
      const runtime = makeRuntime('session-1', { onPlanStatusChanged })
      runtime.handlePlanText('Plan\n\n1. Step A')
      runtime.approveCurrentPlan()
      runtime.startExecution()

      runtime.trackStepFromToolUse(makeToolCall('tool1'), makeToolResult(true))

      const plan = getActivePlan('session-1')!
      expect(plan.status).toBe('completed')
    })

    it('ignores tool calls when no active plan', () => {
      const runtime = makeRuntime()
      // 不应抛出
      runtime.trackStepFromToolUse(makeToolCall('tool1'), makeToolResult(true))
      expect(getActivePlan('session-1')).toBeUndefined()
    })

    it('ignores tool calls when plan is not in_progress', () => {
      const runtime = makeRuntime()
      runtime.handlePlanText('Plan\n\n1. Step A')
      // plan 是 draft，未开始执行
      runtime.trackStepFromToolUse(makeToolCall('tool1'), makeToolResult(true))

      const plan = getActivePlan('session-1')!
      expect(plan.steps[0]!.status).toBe('pending')
    })
  })

  describe('formatPlanContext', () => {
    it('returns formatted context when plan exists', () => {
      const runtime = makeRuntime()
      runtime.handlePlanText('Fix Bug\n\n1. Find root cause\n2. Apply fix')
      runtime.approveCurrentPlan()
      runtime.startExecution()
      runtime.markStep(0, 'completed')
      runtime.markStep(1, 'in_progress')

      const context = runtime.formatPlanContext()
      expect(context).toContain('[Active Plan] Fix Bug')
      expect(context).toContain('Status: in_progress')
      expect(context).toContain('Progress: 1/2 steps completed')
      expect(context).toContain('Current step: Apply fix')
    })

    it('returns null when no active plan', () => {
      const runtime = makeRuntime()
      expect(runtime.formatPlanContext()).toBeNull()
    })
  })

  describe('markStep', () => {
    it('manually marks step status', () => {
      const onStepStatusChanged = vi.fn()
      const runtime = makeRuntime('session-1', { onStepStatusChanged })
      runtime.handlePlanText('Plan\n\n1. Step A\n2. Step B')

      runtime.markStep(0, 'in_progress')
      const plan = getActivePlan('session-1')!
      expect(plan.steps[0]!.status).toBe('in_progress')
      expect(plan.steps[0]!.startedAt).toBeGreaterThan(0)
      expect(onStepStatusChanged).toHaveBeenCalled()
    })

    it('returns null for invalid step index', () => {
      const runtime = makeRuntime()
      runtime.handlePlanText('Plan\n\n1. Step A')

      expect(runtime.markStep(99, 'completed')).toBeNull()
    })
  })

  describe('session isolation', () => {
    it('only tracks plans for its own session', () => {
      const runtime1 = makeRuntime('session-a')
      const runtime2 = makeRuntime('session-b')

      runtime1.handlePlanText('Plan A\n\n1. Step 1')
      runtime2.handlePlanText('Plan B\n\n1. Step 1')

      expect(runtime1.getActivePlan()!.title).toBe('Plan A')
      expect(runtime2.getActivePlan()!.title).toBe('Plan B')
    })
  })
})
