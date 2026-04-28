import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAiMemoryStore } from '@/stores/ai-memory'
import type { AiMemory } from '@/types/ai'

const {
  aiListMemoriesMock,
  aiSaveMemoryMock,
  aiSearchMemoriesMock,
} = vi.hoisted(() => ({
  aiListMemoriesMock: vi.fn(),
  aiSaveMemoryMock: vi.fn(),
  aiSearchMemoriesMock: vi.fn(),
}))

vi.mock('@/api/ai-memory', () => ({
  aiListMemories: aiListMemoriesMock,
  aiSaveMemory: aiSaveMemoryMock,
  aiDeleteMemory: vi.fn(),
  aiSearchMemories: aiSearchMemoriesMock,
}))

function makeMemory(partial: Partial<AiMemory> = {}): AiMemory {
  return {
    id: 'mem-1',
    workspaceId: '_global',
    type: 'knowledge',
    title: 'Vue 规范',
    content: 'Vue 组件需要保持简洁',
    tags: 'vue,组件',
    weight: 1,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

describe('ai-memory store governance fields', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    aiListMemoriesMock.mockResolvedValue([])
    aiSaveMemoryMock.mockResolvedValue(undefined)
    aiSearchMemoriesMock.mockResolvedValue([])
  })

  it('normalizes governance fields when loading legacy memories', async () => {
    aiListMemoriesMock.mockResolvedValue([makeMemory({ sourceSessionId: 'session-1' })])

    const store = useAiMemoryStore()
    await store.loadMemories()

    expect(store.memories[0]).toMatchObject({
      sourceType: 'chat',
      confidence: 0.8,
      reviewStatus: 'approved',
      usageCount: 0,
    })
  })

  it('turns approved proposals into auditable memories', async () => {
    const store = useAiMemoryStore()
    store.proposeMemory({
      type: 'knowledge',
      title: '部署规范',
      content: '上线前必须跑验证',
      tags: '部署,验证',
      sourceType: 'workflow',
      sourceRef: 'workflow-1',
      confidence: 0.6,
    })

    await store.approveProposal(store.pendingProposals[0]!.id)

    expect(aiSaveMemoryMock).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'workflow',
      sourceRef: 'workflow-1',
      confidence: 0.6,
      reviewStatus: 'approved',
      usageCount: 0,
    }))
    expect(store.pendingProposals).toHaveLength(0)
  })

  it('filters archived memories and records usage on recall', async () => {
    aiSearchMemoriesMock.mockResolvedValue([
      makeMemory({ id: 'active', reviewStatus: 'approved', usageCount: 2 }),
      makeMemory({ id: 'archived', title: '归档', reviewStatus: 'archived' }),
    ])

    const store = useAiMemoryStore()
    const result = await store.recall('Vue 组件规范', 200)

    expect(result).toContain('Vue 规范')
    expect(result).not.toContain('归档')
    expect(aiSaveMemoryMock).toHaveBeenCalledWith(expect.objectContaining({
      id: 'active',
      usageCount: 3,
    }))
  })
})
