import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockCommands, resetInvokeMock } from '@/__tests__/mocks/tauri'
import { useLocalFileEditorStore } from '@/stores/local-file-editor'

describe('local-file-editor store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetInvokeMock()
  })

  it('opens png files as read-only image previews instead of unsupported binary files', async () => {
    mockCommands({
      local_read_file_binary: 'ZmFrZS1wbmc=',
    })

    const store = useLocalFileEditorStore()

    const opened = await store.ensureOpen('D:/Project/devforge/.doc/image.png')

    expect(opened).toMatchObject({
      absolutePath: 'D:/Project/devforge/.doc/image.png',
      fileName: 'image.png',
      previewType: 'image',
      language: 'image',
      isLoading: false,
      isSaving: false,
      loadError: null,
    })
    expect(opened.previewSrc).toBe('data:image/png;base64,ZmFrZS1wbmc=')
  })

  it('still opens text files through the text reader', async () => {
    mockCommands({
      read_text_file: 'hello',
    })

    const store = useLocalFileEditorStore()
    const opened = await store.ensureOpen('D:/Project/devforge/README.md')

    expect(opened).toMatchObject({
      previewType: 'text',
      content: 'hello',
      originalContent: 'hello',
      language: 'markdown',
      loadError: null,
    })
  })

  it('maps vue files to Monaco html mode for syntax highlighting', async () => {
    mockCommands({
      read_text_file: '<template><div /></template>',
    })

    const store = useLocalFileEditorStore()
    const opened = await store.ensureOpen('D:/Project/devforge/src/App.vue')

    expect(opened.language).toBe('html')
  })

  it('keeps java files on Monaco java mode for syntax highlighting', async () => {
    mockCommands({
      read_text_file: 'class Demo {}',
    })

    const store = useLocalFileEditorStore()
    const opened = await store.ensureOpen('D:/Project/devforge/src/Demo.java')

    expect(opened.language).toBe('java')
  })
})
