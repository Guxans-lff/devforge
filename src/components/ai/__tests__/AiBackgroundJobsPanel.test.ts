import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AiBackgroundJobsPanel from '@/components/ai/AiBackgroundJobsPanel.vue'
import type { BackgroundJob } from '@/stores/background-job'

const iconStubs = {
  Loader2: true,
  CheckCircle2: true,
  XCircle: true,
  Clock: true,
  RotateCcw: true,
  Ban: true,
  Trash2: true,
}

describe('AiBackgroundJobsPanel', () => {
  it('renders job title and context summary when provided', () => {
    const jobs: BackgroundJob[] = [{
      id: 'job-1',
      kind: 'schema_compare',
      sessionId: 'session-1',
      status: 'queued',
      progress: 0,
      createdAt: 100,
      title: 'Schema 对比：dev → prod',
      contextSummary: 'dev@local -> prod@remote',
    }]

    const wrapper = mount(AiBackgroundJobsPanel, {
      props: { jobs },
      global: { stubs: iconStubs },
    })

    expect(wrapper.text()).toContain('Schema 对比：dev → prod')
    expect(wrapper.text()).toContain('dev@local -> prod@remote')
  })
})
