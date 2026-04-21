import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AiSpawnedTasksPanel from '@/components/ai/AiSpawnedTasksPanel.vue'
import type { SpawnedTask } from '@/composables/ai/chatSideEffects'

describe('AiSpawnedTasksPanel', () => {
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
    ]

    const wrapper = mount(AiSpawnedTasksPanel, {
      props: { tasks },
    })

    expect(wrapper.text()).toContain('ai.chat.dispatcher')
    expect(wrapper.text()).toContain('ai.tasks.pendingCount')
    expect(wrapper.text()).toContain('ai.tasks.errorCount')
    expect(wrapper.text()).toContain('prepare workspace')
    expect(wrapper.text()).toContain('Index rebuild is halfway done')
    expect(wrapper.text()).toContain('command failed')
    expect(wrapper.text()).toContain('ai.tasks.retryCount')

    const buttons = wrapper.findAll('button')
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')
    await buttons[2]!.trigger('click')
    await buttons[3]!.trigger('click')

    expect(wrapper.emitted('run')).toEqual([['task-1']])
    expect(wrapper.emitted('open')).toEqual([['task-2']])
    expect(wrapper.emitted('complete')).toEqual([['task-2']])
    expect(wrapper.emitted('retry')).toEqual([['task-3']])
  })
})
