import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import AiFileChangeSummaryPanel from '@/components/ai/AiFileChangeSummaryPanel.vue'
import type { FileOperation } from '@/types/ai'

const { aiRevertWriteFileMock } = vi.hoisted(() => ({
  aiRevertWriteFileMock: vi.fn(),
}))

vi.mock('@/api/ai', () => ({
  aiRevertWriteFile: aiRevertWriteFileMock,
}))

const IconStub = defineComponent({
  name: 'IconStub',
  setup() {
    return () => h('span')
  },
})

function operation(overrides: Partial<FileOperation> = {}): FileOperation {
  return {
    op: 'modify',
    path: 'src/a.ts',
    fileName: 'a.ts',
    newContent: 'new',
    status: 'pending',
    toolCallId: 'w1',
    ...overrides,
  }
}

describe('AiFileChangeSummaryPanel', () => {
  function mountComponent(operations: FileOperation[] = [operation()]) {
    return mount(AiFileChangeSummaryPanel, {
      props: {
        operations,
        sessionId: 'session-1',
      },
      global: {
        stubs: {
          FilePenLine: IconStub,
          RotateCcw: IconStub,
          Check: IconStub,
          AlertCircle: IconStub,
        },
      },
    })
  }

  it('renders summary and expands operations', async () => {
    const wrapper = mountComponent([operation(), operation({ toolCallId: 'w2', path: 'src/b.ts' })])

    expect(wrapper.text()).toContain('AI 文件变更')
    expect(wrapper.text()).toContain('共 2 个文件操作')

    await wrapper.findAll('button').find(button => button.text().includes('查看全部'))?.trigger('click')

    expect(wrapper.text()).toContain('src/a.ts')
    expect(wrapper.text()).toContain('src/b.ts')
  })

  it('reverts a single operation and emits updated operations', async () => {
    aiRevertWriteFileMock.mockResolvedValue('ok')
    const wrapper = mountComponent([operation()])

    await wrapper.findAll('button').find(button => button.text() === '查看全部')?.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '撤销')?.trigger('click')

    expect(aiRevertWriteFileMock).toHaveBeenCalledWith('session-1', 'w1', 'src/a.ts')
    const emitted = wrapper.emitted('update:operations')?.at(-1)?.[0] as FileOperation[]
    expect(emitted[0]!.status).toBe('rejected')
  })

  it('marks error when session id is missing', async () => {
    const wrapper = mount(AiFileChangeSummaryPanel, {
      props: { operations: [operation()] },
      global: { stubs: { FilePenLine: IconStub, RotateCcw: IconStub, Check: IconStub, AlertCircle: IconStub } },
    })

    await wrapper.findAll('button').find(button => button.text() === '查看全部')?.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '撤销')?.trigger('click')

    const emitted = wrapper.emitted('update:operations')?.at(-1)?.[0] as FileOperation[]
    expect(emitted[0]!.status).toBe('error')
    expect(emitted[0]!.errorMessage).toContain('缺少 sessionId')
  })
})
