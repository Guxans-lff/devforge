import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import AiSpawnedTasksPanel from '@/components/ai/AiSpawnedTasksPanel.vue'
import type { SpawnedTask } from '@/composables/ai/chatSideEffects'

describe('AiSpawnedTasksPanel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders task summary, metadata and emits run/retry actions', async () => {
    const tasks: SpawnedTask[] = [
      {
        id: 'task-1',
        description: 'prepare workspace',
        status: 'pending',
        createdAt: 1000,
        retryCount: 0,
        sourceMessageId: 'assistant-1',
      },
      {
        id: 'task-2',
        description: 'rebuild indexes',
        status: 'running',
        createdAt: 2000,
        startedAt: 2500,
        taskTabId: 'ai-task-2',
        lastSummary: 'Index rebuild is halfway done',
        retryCount: 2,
        sourceMessageId: 'assistant-2',
      },
      {
        id: 'task-6',
        description: 'rebuild cache',
        status: 'running',
        createdAt: 2100,
        startedAt: 2550,
        taskTabId: 'ai-task-6',
        retryCount: 0,
        sourceMessageId: 'assistant-2',
      },
      {
        id: 'task-3',
        description: 'rebuild indexes',
        status: 'error',
        createdAt: 3000,
        startedAt: 3500,
        finishedAt: 4200,
        durationMs: 700,
        lastError: 'command failed',
        retryCount: 1,
        sourceMessageId: 'assistant-3',
      },
      {
        id: 'task-4',
        description: 'rerun failed check',
        status: 'cancelled',
        createdAt: 5000,
        startedAt: 5500,
        finishedAt: 6200,
        durationMs: 700,
        lastError: 'cancelled by user',
        retryCount: 0,
      },
      {
        id: 'task-5',
        description: 'rerun cancelled audit',
        status: 'cancelled',
        createdAt: 7000,
        startedAt: 7300,
        finishedAt: 7600,
        durationMs: 300,
        lastError: 'manual stop',
        retryCount: 1,
      },
    ]

    const wrapper = mount(AiSpawnedTasksPanel, {
      props: { tasks },
    })

    expect(wrapper.text()).toContain('ai.chat.dispatcher')
    expect(wrapper.text()).toContain('ai.tasks.pendingCount')
    expect(wrapper.text()).toContain('ai.tasks.errorCount')
    expect(wrapper.text()).toContain('ai.tasks.cancelledCount')
    expect(wrapper.text()).toContain('ai.tasks.groups.pending')
    expect(wrapper.text()).toContain('ai.tasks.groups.running')
    expect(wrapper.text()).toContain('ai.tasks.groups.error')
    expect(wrapper.text()).toContain('ai.tasks.groups.cancelled')
    expect(wrapper.text()).toContain('ai.tasks.synthesize')
    expect(wrapper.text()).toContain('prepare workspace')
    expect(wrapper.text()).toContain('Index rebuild is halfway done')
    expect(wrapper.text()).toContain('command failed')
    expect(wrapper.text()).toContain('cancelled by user')
    expect(wrapper.text()).toContain('manual stop')
    expect(wrapper.text()).toContain('ai.tasks.retryCount')
    expect(wrapper.text()).toContain('ai.tasks.sourceGroup')
    expect(wrapper.text()).toContain('ai.tasks.sourceStandalone')
    expect(wrapper.text()).toContain('ai.tasks.sourceStep')
    expect(wrapper.text()).toContain('ai.tasks.dependencyRoot')
    expect(wrapper.text()).toContain('ai.tasks.dependencyAfter')
    expect(wrapper.find('[data-source-section-key="source:assistant-2"]').exists()).toBe(true)
    expect(wrapper.find('[data-source-section-key="standalone"]').exists()).toBe(true)

    const findButton = (text: string) => wrapper.findAll('button').find(button => button.text().includes(text))

    await findButton('ai.tasks.run')!.trigger('click')
    await findButton('ai.tasks.open')!.trigger('click')
    await findButton('ai.tasks.complete')!.trigger('click')
    await findButton('common.cancel')!.trigger('click')
    await wrapper.findAll('button').filter(button => button.text().includes('ai.tasks.batchCancel'))[0]!.trigger('click')
    await findButton('common.retry')!.trigger('click')
    await wrapper.findAll('button').filter(button => button.text().includes('ai.tasks.batchRetry'))[0]!.trigger('click')
    await findButton('ai.tasks.synthesize')!.trigger('click')

    expect(wrapper.emitted('run')).toEqual([['task-1']])
    expect(wrapper.emitted('open')).toEqual([['task-2']])
    expect(wrapper.emitted('complete')).toEqual([['task-2']])
    expect(wrapper.emitted('cancel')).toEqual([['task-2']])
    expect(wrapper.emitted('cancel-batch')).toEqual([[['task-2', 'task-6']]])
    expect(wrapper.emitted('retry')).toEqual([['task-3']])
    expect(wrapper.emitted('retry-batch')).toEqual([[['task-4', 'task-5']]])
    expect(wrapper.emitted('synthesize')).toEqual([[]])
  })

  it('persists collapsed source sections', async () => {
    const tasks: SpawnedTask[] = [
      {
        id: 'task-1',
        description: 'prepare workspace',
        status: 'pending',
        createdAt: 1000,
        retryCount: 0,
        sourceMessageId: 'assistant-1',
      },
    ]

    const wrapper = mount(AiSpawnedTasksPanel, {
      props: { tasks },
    })

    expect(wrapper.text()).toContain('prepare workspace')

    await wrapper.find('[data-source-section-key="source:assistant-1"] button').trigger('click')

    expect(wrapper.text()).not.toContain('prepare workspace')
    expect(localStorage.getItem('devforge-ai-task-collapsed-source-groups')).toContain('source:assistant-1')

    const remounted = mount(AiSpawnedTasksPanel, {
      props: { tasks },
    })

    expect(remounted.text()).not.toContain('prepare workspace')
  })

  it('shows blocked state for pending tasks with unresolved explicit dependencies', async () => {
    const tasks: SpawnedTask[] = [
      {
        id: 'task-1',
        description: 'prepare workspace',
        status: 'running',
        createdAt: 1000,
        retryCount: 0,
        sourceMessageId: 'assistant-1',
      },
      {
        id: 'task-2',
        description: 'verify workspace',
        status: 'pending',
        createdAt: 1001,
        retryCount: 0,
        sourceMessageId: 'assistant-1',
        dependsOn: ['task-1'],
      },
    ]

    const wrapper = mount(AiSpawnedTasksPanel, {
      props: { tasks },
    })

    expect(wrapper.text()).toContain('ai.tasks.runBlockedBy')

    const runButtons = wrapper.findAll('button').filter(button => button.text().includes('ai.tasks.run'))
    expect(runButtons).toHaveLength(1)
    expect(runButtons[0]?.attributes('disabled')).toBeDefined()

    await runButtons[0]!.trigger('click')

    expect(wrapper.emitted('run')).toBeUndefined()
  })

  it('runs only runnable pending tasks in batch and shows blocked count', async () => {
    const tasks: SpawnedTask[] = [
      {
        id: 'task-1',
        description: 'prepare workspace',
        status: 'done',
        createdAt: 1000,
        retryCount: 0,
        sourceMessageId: 'assistant-1',
      },
      {
        id: 'task-2',
        description: 'verify workspace',
        status: 'pending',
        createdAt: 1001,
        retryCount: 0,
        sourceMessageId: 'assistant-1',
        dependsOn: ['task-1'],
      },
      {
        id: 'task-3',
        description: 'deploy workspace',
        status: 'pending',
        createdAt: 1002,
        retryCount: 0,
        sourceMessageId: 'assistant-1',
        dependsOn: ['task-4'],
      },
    ]

    const wrapper = mount(AiSpawnedTasksPanel, {
      props: { tasks },
    })

    expect(wrapper.text()).toContain('ai.tasks.blockedCount')

    const batchRunButton = wrapper.findAll('button').find(button => button.text().includes('ai.tasks.batchRun'))
    expect(batchRunButton).toBeDefined()

    await batchRunButton!.trigger('click')

    expect(wrapper.emitted('run-batch')).toEqual([[['task-2']]])
  })
})
