import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AiPatchReviewPanel from '@/components/ai/AiPatchReviewPanel.vue'

const gitMock = vi.hoisted(() => ({
  gitGetDiffWorking: vi.fn(),
}))

const aiMock = vi.hoisted(() => ({
  aiReadContextFile: vi.fn(),
}))

vi.mock('@/api/git', () => ({
  gitGetDiffWorking: gitMock.gitGetDiffWorking,
}))

vi.mock('@/api/ai', () => ({
  aiReadContextFile: aiMock.aiReadContextFile,
}))

describe('AiPatchReviewPanel', () => {
  beforeEach(() => {
    gitMock.gitGetDiffWorking.mockReset()
    aiMock.aiReadContextFile.mockReset()
    aiMock.aiReadContextFile.mockResolvedValue('const value: any = 1')
  })

  it('emits Verification Agent commands from current patch review', async () => {
    gitMock.gitGetDiffWorking.mockResolvedValue({
      stats: {
        filesChanged: 2,
        insertions: 17,
        deletions: 3,
      },
      files: [
        {
          path: 'src/ai-gui/permissionRules.ts',
          status: 'modified',
          isBinary: false,
          hunks: [{ header: '@@', lines: Array.from({ length: 12 }, () => ({ origin: '+', content: 'line' })) }],
        },
        {
          path: 'src-tauri/src/services/ai/session_store.rs',
          status: 'modified',
          isBinary: false,
          hunks: [{ header: '@@', lines: [
            ...Array.from({ length: 5 }, () => ({ origin: '+', content: 'line' })),
            { origin: '-', content: 'line' },
          ] }],
        },
      ],
    })

    const wrapper = mount(AiPatchReviewPanel, {
      props: {
        workDir: 'D:/Project/devforge',
        jobs: [],
        verifying: false,
      },
    })

    await wrapper.findAll('button').find(button => button.text().includes('审查 diff'))?.trigger('click')
    await vi.dynamicImportSettled()

    expect(wrapper.text()).toContain('Verification Agent')
    expect(wrapper.text()).toContain('Verification Gate')
    expect(wrapper.text()).toContain('需补证据')
    await wrapper.findAll('button').find(button => button.text().includes('Agent 验证'))?.trigger('click')

    const emitted = wrapper.emitted('verify')?.[0]?.[0] as string[]
    expect(emitted).toContain('pnpm vitest run src/ai-gui src/ai-gateway src/composables/__tests__')
    expect(emitted).toContain('pnpm test:typecheck')
    expect(emitted).toContain('cargo check --manifest-path src-tauri/Cargo.toml')
  })

  it('shows LSP-compatible diagnostics from readable changed files', async () => {
    gitMock.gitGetDiffWorking.mockResolvedValue({
      stats: {
        filesChanged: 1,
        insertions: 4,
        deletions: 0,
      },
      files: [
        {
          path: 'src/ai-gui/runtime.ts',
          status: 'modified',
          isBinary: false,
          hunks: [{ header: '@@', lines: [{ origin: '+', content: 'const value: any = 1' }] }],
        },
      ],
    })
    aiMock.aiReadContextFile.mockResolvedValue([
      'const value: any = 1',
      'console.log(value)',
    ].join('\n'))

    const wrapper = mount(AiPatchReviewPanel, {
      props: {
        workDir: 'D:/Project/devforge',
        jobs: [],
        verifying: false,
      },
    })

    await wrapper.findAll('button').find(button => button.text().includes('审查 diff'))?.trigger('click')
    await vi.dynamicImportSettled()
    await wrapper.findAll('button').find(button => button.text().includes('代码智能'))?.trigger('click')
    await vi.dynamicImportSettled()

    expect(wrapper.text()).toContain('代码智能摘要')
    expect(wrapper.text()).toContain('LSP 兼容诊断')
    expect(wrapper.text()).toContain('诊断 2 条')
    expect(wrapper.text()).toContain('使用 any')
    expect(wrapper.text()).toContain('console.log')
  })

  it('blocks completion when latest verification failed', async () => {
    gitMock.gitGetDiffWorking.mockResolvedValue({
      stats: {
        filesChanged: 1,
        insertions: 8,
        deletions: 1,
      },
      files: [
        {
          path: 'src/views/AiChatView.vue',
          status: 'modified',
          isBinary: false,
          hunks: [{ header: '@@', lines: Array.from({ length: 8 }, () => ({ origin: '+', content: 'line' })) }],
        },
      ],
    })

    const wrapper = mount(AiPatchReviewPanel, {
      props: {
        workDir: 'D:/Project/devforge',
        verifying: false,
        jobs: [
          {
            id: 'job-verification-failed',
            kind: 'verification',
            sessionId: 'session-1',
            status: 'failed',
            progress: 100,
            createdAt: Date.now(),
            finishedAt: Date.now(),
            error: [
              'Verification failed | duration=100ms | commands=1',
              '$ pnpm test:typecheck\nstatus=failed duration=100ms\ntype error',
            ].join('\n\n---\n\n'),
          },
        ],
      },
    })

    await wrapper.findAll('button').find(button => button.text().includes('审查 diff'))?.trigger('click')
    await vi.dynamicImportSettled()

    expect(wrapper.text()).toContain('Verification Gate')
    expect(wrapper.text()).toContain('status block')
    expect(wrapper.text()).toContain('最近验证存在失败命令')
    expect(wrapper.text()).toContain('失败 pnpm test:typecheck')
  })
})
