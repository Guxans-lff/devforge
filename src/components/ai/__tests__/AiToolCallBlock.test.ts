import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AiToolCallBlock from '@/components/ai/AiToolCallBlock.vue'

const stubs = {
  AiCodeBlock: true,
  AiFileOpCard: true,
  AiTodoPanel: true,
  AiApprovalDialog: true,
  Dialog: { template: '<div><slot /></div>' },
  DialogContent: { template: '<div><slot /></div>' },
  DialogDescription: { template: '<div><slot /></div>' },
  DialogHeader: { template: '<div><slot /></div>' },
  DialogTitle: { template: '<div><slot /></div>' },
  Button: { template: '<button><slot /></button>' },
  ChevronRight: true,
  Loader2: true,
  CheckCircle2: true,
  XCircle: true,
  Wrench: true,
  ExternalLink: true,
  Eye: true,
  Copy: true,
  Maximize2: true,
}

describe('AiToolCallBlock', () => {
  it('翻译旧版用户拒绝工具错误', async () => {
    const wrapper = mount(AiToolCallBlock, {
      props: {
        toolCall: {
          id: 'tool-1',
          name: 'edit_file',
          arguments: '{}',
          parsedArgs: {},
          status: 'error',
          approvalState: 'denied',
          error: '[user_rejected] User rejected edit_file.',
        },
        sessionId: 'session-1',
      },
      global: {
        stubs,
      },
    })

    await wrapper.find('button').trigger('click')

    expect(wrapper.text()).toContain('用户已拒绝')
    expect(wrapper.text()).toContain('用户拒绝执行 edit_file')
    expect(wrapper.text()).not.toContain('User rejected edit_file')
  })

  it('大结果默认只渲染摘要，完整内容按需查看', async () => {
    const largeResult = Array.from({ length: 80 }, (_, index) => `line-${index}`).join('\n')
    const wrapper = mount(AiToolCallBlock, {
      props: {
        toolCall: {
          id: 'tool-large',
          name: 'bash',
          arguments: '{"command":"cat large.log"}',
          parsedArgs: { command: 'cat large.log' },
          status: 'success',
          result: largeResult,
        },
        sessionId: 'session-1',
      },
      global: {
        stubs,
      },
    })

    await wrapper.find('button').trigger('click')

    expect(wrapper.text()).toContain('命令')
    expect(wrapper.text()).toContain('line-0')
    expect(wrapper.text()).not.toContain('line-40')
    expect(wrapper.text()).toContain('点击“查看完整”加载详情')
  })

  it('完整结果弹窗默认仍只渲染预览，避免详情页卡死', async () => {
    const largeResult = Array.from({ length: 500 }, (_, index) => `line-${index}`).join('\n')
    const wrapper = mount(AiToolCallBlock, {
      props: {
        toolCall: {
          id: 'tool-dialog',
          name: 'bash',
          arguments: '{"command":"cat huge.log"}',
          parsedArgs: { command: 'cat huge.log' },
          status: 'success',
          result: largeResult,
        },
        sessionId: 'session-1',
      },
      global: {
        stubs,
      },
    })

    await wrapper.find('button').trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('查看完整') || button.attributes('title') === '全屏查看')?.trigger('click')

    expect(wrapper.text()).toContain('执行命令')
    expect(wrapper.text()).toContain('line-0')
    expect(wrapper.text()).toContain('line-239')
    expect(wrapper.text()).not.toContain('line-300')
    expect(wrapper.text()).toContain('渲染完整内容')
  })
})
