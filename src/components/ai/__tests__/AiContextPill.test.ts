import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AiContextPill from '@/components/ai/AiContextPill.vue'

const stubs = {
  Popover: { template: '<div><slot /></div>' },
  PopoverTrigger: { template: '<div><slot /></div>' },
  PopoverContent: { template: '<div><slot /></div>' },
  FileText: true,
  Folder: true,
  Search: true,
  Globe: true,
  Loader2: true,
  CheckCircle2: true,
  XCircle: true,
  Wrench: true,
}

describe('AiContextPill', () => {
  it('hover 预览只渲染截断后的工具结果', async () => {
    const result = [
      '[文件: src/big.ts | 80 行 | 4 KB]',
      ...Array.from({ length: 80 }, (_, index) => `line-${index}`),
    ].join('\n')
    const wrapper = mount(AiContextPill, {
      props: {
        toolCall: {
          id: 'read-1',
          name: 'read_file',
          arguments: '{"path":"src/big.ts"}',
          parsedArgs: { path: 'src/big.ts' },
          status: 'success',
          result,
        },
      },
      global: {
        stubs,
      },
    })

    await wrapper.find('button').trigger('mouseenter')

    expect(wrapper.text()).toContain('line-0')
    expect(wrapper.text()).toContain('读取文件')
    expect(wrapper.text()).toContain('line-11')
    expect(wrapper.text()).not.toContain('line-20')
    expect(wrapper.text()).not.toContain('[文件:')
    expect(wrapper.text()).toContain('点击“查看完整”加载详情')
  })

  it('点击胶囊发出打开详情事件', async () => {
    const wrapper = mount(AiContextPill, {
      props: {
        toolCall: {
          id: 'search-1',
          name: 'search_files',
          arguments: '{"pattern":"TODO"}',
          parsedArgs: { pattern: 'TODO' },
          status: 'success',
          result: 'found',
        },
      },
      global: {
        stubs,
      },
    })

    await wrapper.find('button').trigger('click')

    expect(wrapper.emitted('open')).toHaveLength(1)
  })
})
