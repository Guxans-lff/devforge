import { mount } from '@vue/test-utils'
import { describe, expect, it, beforeEach } from 'vitest'
import AiPlanPanel from '@/components/ai/AiPlanPanel.vue'
import {
  approvePlan,
  clearAllPlans,
  createPlan,
  markStepCompleted,
  markStepFailed,
  markStepInProgress,
  startPlanExecution,
  attachJobToActivePlanStep,
  updateJobRefByJobId,
  updatePlan,
  setActivePlan,
} from '@/composables/ai-agent/planning/planStore'

const iconStubs = {
  ClipboardList: true,
  CheckCircle2: true,
  Circle: true,
  Loader2: true,
  AlertTriangle: true,
  SkipForward: true,
  ChevronRight: true,
  RotateCcw: true,
  Ban: true,
  History: true,
}

describe('AiPlanPanel', () => {
  beforeEach(() => {
    clearAllPlans()
  })

  it('renders active plan without duplicate class binding crash', () => {
    createPlan({
      sessionId: 'session-1',
      title: '修复 SFTP 问题',
      description: '先定位，再修复',
      steps: [
        { index: 0, title: '定位问题', status: 'completed' },
        { index: 1, title: '修复问题', status: 'in_progress' },
      ],
    })

    const wrapper = mount(AiPlanPanel, {
      props: { sessionId: 'session-1' },
      global: {
        stubs: iconStubs,
      },
    })

    expect(wrapper.text()).toContain('修复 SFTP 问题')
    expect(wrapper.text()).toContain('执行进度')
  })

  it('renders empty state silently when no active plan exists', () => {
    const wrapper = mount(AiPlanPanel, {
      props: { sessionId: 'session-1' },
    })

    expect(wrapper.html()).toBe('<!--v-if-->')
  })

  it('renders recent plan changes', () => {
    const plan = createPlan({
      sessionId: 'session-1',
      title: '执行计划',
      steps: [
        { index: 0, title: '第一步' },
        { index: 1, title: '第二步' },
      ],
    })
    approvePlan(plan.id)
    startPlanExecution(plan.id)
    markStepInProgress(plan.id, 0)
    markStepCompleted(plan.id, 0)

    const wrapper = mount(AiPlanPanel, {
      props: { sessionId: 'session-1' },
      global: { stubs: iconStubs },
    })

    expect(wrapper.text()).toContain('最近变更')
    expect(wrapper.text()).toContain('最近 5 条')
    expect(wrapper.text()).toContain('步骤「第一步」状态')
    expect(wrapper.text()).toContain('批准计划')
  })

  it('limits recent plan changes to five items', () => {
    const plan = createPlan({
      sessionId: 'session-1',
      title: '长历史计划',
      steps: [
        { index: 0, title: '第一步' },
        { index: 1, title: '第二步' },
      ],
    })
    updatePlan(plan.id, { description: 'v1' })
    updatePlan(plan.id, { description: 'v2' })
    approvePlan(plan.id)
    startPlanExecution(plan.id)
    markStepInProgress(plan.id, 0)
    markStepCompleted(plan.id, 0)
    markStepFailed(plan.id, 1, '失败原因')

    const wrapper = mount(AiPlanPanel, {
      props: { sessionId: 'session-1' },
      global: { stubs: iconStubs },
    })

    const recentChanges = wrapper.find('[data-testid="recent-changes"]')
    expect(recentChanges.text()).toContain('最近 5 条')
    expect(recentChanges.text()).toContain('pending -> failed')
    expect(recentChanges.text()).not.toContain('创建计划')
    expect(wrapper.text()).toContain('失败原因')
    expect(wrapper.find('[data-testid="full-change-history"]').text()).toContain('创建计划')
  })

  it('renders full change history when recent changes are truncated', () => {
    const plan = createPlan({
      sessionId: 'session-1',
      title: '完整历史计划',
      steps: [
        { index: 0, title: '第一步' },
        { index: 1, title: '第二步' },
      ],
    })
    updatePlan(plan.id, { description: 'v1' })
    updatePlan(plan.id, { description: 'v2' })
    approvePlan(plan.id)
    startPlanExecution(plan.id)
    markStepInProgress(plan.id, 0)
    markStepCompleted(plan.id, 0)

    const wrapper = mount(AiPlanPanel, {
      props: { sessionId: 'session-1' },
      global: { stubs: iconStubs },
    })

    const history = wrapper.find('[data-testid="full-change-history"]')
    expect(wrapper.text()).toContain('完整历史 (7)')
    expect(history.text()).toContain('全部 7')
    expect(history.text()).toContain('创建计划')
    expect(history.findAll('[data-change-type]')).toHaveLength(7)
  })

  it('filters full history to job changes', async () => {
    const plan = createPlan({
      sessionId: 'session-1',
      title: '任务历史计划',
      steps: [
        { index: 0, title: '跑验证' },
      ],
    })
    updatePlan(plan.id, { description: 'v1' })
    approvePlan(plan.id)
    startPlanExecution(plan.id)
    markStepInProgress(plan.id, 0)
    attachJobToActivePlanStep('session-1', {
      jobId: 'job-verify-1',
      kind: 'verification',
      status: 'queued',
      title: 'pnpm test',
    })
    updateJobRefByJobId('job-verify-1', { status: 'succeeded', resultSummary: '通过' })

    const wrapper = mount(AiPlanPanel, {
      props: { sessionId: 'session-1' },
      global: { stubs: iconStubs },
    })

    await wrapper.find('[data-history-filter="job"]').trigger('click')

    const historyChanges = wrapper.findAll('[data-testid="full-change-history"] [data-change-type]')
    expect(historyChanges).toHaveLength(2)
    expect(historyChanges.every(change => change.attributes('data-change-type')?.startsWith('job_'))).toBe(true)
    expect(wrapper.find('[data-testid="full-change-history"]').text()).toContain('verification/job-verify-1')
  })

  it('resets full history filter when active plan changes', async () => {
    const firstPlan = createPlan({
      sessionId: 'session-1',
      title: 'Plan A',
      steps: [
        { index: 0, title: 'Verify' },
      ],
    })
    updatePlan(firstPlan.id, { description: 'v1' })
    approvePlan(firstPlan.id)
    startPlanExecution(firstPlan.id)
    markStepInProgress(firstPlan.id, 0)
    attachJobToActivePlanStep('session-1', {
      jobId: 'job-verify-1',
      kind: 'verification',
      status: 'queued',
    })
    updateJobRefByJobId('job-verify-1', { status: 'succeeded' })

    const secondPlan = createPlan({
      sessionId: 'session-1',
      title: 'Plan B',
      steps: [
        { index: 0, title: 'Step B' },
      ],
    })
    updatePlan(secondPlan.id, { description: 'v1' })
    updatePlan(secondPlan.id, { description: 'v2' })
    approvePlan(secondPlan.id)
    startPlanExecution(secondPlan.id)
    markStepInProgress(secondPlan.id, 0)

    setActivePlan('session-1', firstPlan.id)
    const wrapper = mount(AiPlanPanel, {
      props: { sessionId: 'session-1' },
      global: { stubs: iconStubs },
    })

    await wrapper.find('[data-history-filter="job"]').trigger('click')
    expect(wrapper.findAll('[data-testid="full-change-history"] [data-change-type]')).toHaveLength(2)

    setActivePlan('session-1', secondPlan.id)
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('[data-testid="full-change-history"] [data-change-type]').length).toBeGreaterThan(2)
  })

  it('renders step job refs', () => {
    const plan = createPlan({
      sessionId: 'session-1',
      title: '任务关联计划',
      steps: [
        { index: 0, title: '跑验证' },
      ],
    })
    attachJobToActivePlanStep('session-1', {
      jobId: 'job-verify-1',
      kind: 'verification',
      status: 'queued',
      title: 'pnpm test',
    })

    const wrapper = mount(AiPlanPanel, {
      props: { sessionId: 'session-1' },
      global: { stubs: iconStubs },
    })

    expect(wrapper.text()).toContain('pnpm test:queued')
    expect(wrapper.text()).toContain('任务关联计划')
    expect(plan.steps[0]!.jobRefs).toHaveLength(1)
  })
})
