import { defineStore } from 'pinia'
import { shallowRef, triggerRef, computed, ref } from 'vue'
import { sftpReadFileContent, sftpWriteFileContent } from '@/api/file-editor'

export interface OpenFile {
  id: string
  connectionId: string
  remotePath: string
  fileName: string
  originalContent: string
  content: string
  language: string
  isDirty: boolean
  isSaving: boolean
  isLoading: boolean
}

/** 文件扩展名 → Monaco 语言映射 */
const EXT_LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  java: 'java',
  kt: 'kotlin',
  go: 'go',
  rs: 'rust',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  lua: 'lua',
  r: 'r',
  swift: 'swift',
  toml: 'ini',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  env: 'ini',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  vue: 'html',
  svelte: 'html',
}

function getLanguageFromPath(filePath: string): string {
  const name = filePath.split('/').pop() ?? ''
  const lower = name.toLowerCase()

  // 特殊文件名
  if (lower === 'dockerfile') return 'dockerfile'
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile'
  if (lower.startsWith('.env')) return 'ini'

  const ext = lower.split('.').pop() ?? ''
  return EXT_LANGUAGE_MAP[ext] ?? 'plaintext'
}

export const useFileEditorStore = defineStore('fileEditor', () => {
  const openFiles = shallowRef<Map<string, OpenFile>>(new Map())
  const activeFileId = ref<string | null>(null)

  const activeFile = computed(() => {
    if (!activeFileId.value) return null
    return openFiles.value.get(activeFileId.value) ?? null
  })

  const hasUnsavedFiles = computed(() => {
    for (const file of openFiles.value.values()) {
      if (file.isDirty) return true
    }
    return false
  })

  const fileList = computed(() => Array.from(openFiles.value.values()))

  /** 打开远程文件进行编辑 */
  async function openFile(connectionId: string, remotePath: string) {
    // 如果已打开，直接激活
    for (const [id, file] of openFiles.value) {
      if (file.connectionId === connectionId && file.remotePath === remotePath) {
        activeFileId.value = id
        return
      }
    }

    const id = crypto.randomUUID()
    const fileName = remotePath.split('/').pop() ?? remotePath

    const file: OpenFile = {
      id,
      connectionId,
      remotePath,
      fileName,
      originalContent: '',
      content: '',
      language: getLanguageFromPath(remotePath),
      isDirty: false,
      isSaving: false,
      isLoading: true,
    }

    openFiles.value.set(id, file)
    triggerRef(openFiles)
    activeFileId.value = id

    try {
      const content = await sftpReadFileContent(connectionId, remotePath)
      const existing = openFiles.value.get(id)
      if (existing) {
        openFiles.value.set(id, {
          ...existing,
          originalContent: content,
          content,
          isLoading: false,
        })
        triggerRef(openFiles)
      }
    } catch (e) {
      // 加载失败，移除标签
      openFiles.value.delete(id)
      triggerRef(openFiles)
      if (activeFileId.value === id) {
        activeFileId.value = openFiles.value.size > 0
          ? openFiles.value.keys().next().value ?? null
          : null
      }
      throw e
    }
  }

  /** 更新文件内容 */
  function updateContent(id: string, content: string) {
    const file = openFiles.value.get(id)
    if (!file) return

    openFiles.value.set(id, {
      ...file,
      content,
      isDirty: content !== file.originalContent,
    })
    triggerRef(openFiles)
  }

  /** 保存文件到远程 */
  async function saveFile(id: string) {
    const file = openFiles.value.get(id)
    if (!file || !file.isDirty) return

    // 记录本次保存的内容，用于 await 后比较
    const savedContent = file.content

    openFiles.value.set(id, { ...file, isSaving: true })
    triggerRef(openFiles)

    try {
      await sftpWriteFileContent(file.connectionId, file.remotePath, savedContent)
      // await 后重新读取最新状态，避免覆盖用户在保存期间的编辑
      const current = openFiles.value.get(id)
      if (current) {
        openFiles.value.set(id, {
          ...current,
          originalContent: savedContent,
          isDirty: current.content !== savedContent,
          isSaving: false,
        })
        triggerRef(openFiles)
      }
    } catch (e) {
      const current = openFiles.value.get(id)
      if (current) {
        openFiles.value.set(id, { ...current, isSaving: false })
        triggerRef(openFiles)
      }
      throw e
    }
  }

  /** 保存所有未保存文件 */
  async function saveAllFiles() {
    const promises: Promise<void>[] = []
    for (const [id, file] of openFiles.value) {
      if (file.isDirty) {
        promises.push(saveFile(id))
      }
    }
    await Promise.allSettled(promises)
  }

  /** 关闭文件 */
  function closeFile(id: string) {
    openFiles.value.delete(id)
    triggerRef(openFiles)

    if (activeFileId.value === id) {
      activeFileId.value = openFiles.value.size > 0
        ? openFiles.value.keys().next().value ?? null
        : null
    }
  }

  /** 关闭所有文件 */
  function closeAllFiles() {
    openFiles.value.clear()
    triggerRef(openFiles)
    activeFileId.value = null
  }

  /** 设置活动文件 */
  function setActiveFile(id: string) {
    if (openFiles.value.has(id)) {
      activeFileId.value = id
    }
  }

  return {
    openFiles,
    activeFileId,
    activeFile,
    hasUnsavedFiles,
    fileList,
    openFile,
    updateContent,
    saveFile,
    saveAllFiles,
    closeFile,
    closeAllFiles,
    setActiveFile,
  }
})
