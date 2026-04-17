import { defineStore } from 'pinia'
import { shallowRef, triggerRef } from 'vue'
import { readTextFile, writeTextFile } from '@/api/database'
import { inferLanguageFromPath, isTextFile } from '@/utils/file-markers'

/** 将任意错误值转为人类可读的字符串 */
function formatError(e: unknown): string {
  if (e == null) return '未知错误'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (typeof e === 'object') {
    const obj = e as Record<string, unknown>
    // Tauri 命令错误常见结构：{ Validation: "..." } / { Io: "..." } / { message: "..." }
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.error === 'string') return obj.error
    // 单字段枚举变体
    const keys = Object.keys(obj)
    if (keys.length === 1) {
      const k = keys[0]!
      const v = obj[k]
      if (typeof v === 'string') return `${k}: ${v}`
    }
    try {
      const s = JSON.stringify(e)
      if (s && s !== '{}') return s
    } catch {
      /* ignore */
    }
  }
  return String(e)
}

/** Monaco 语言别名映射（file-markers 里用的是高亮标识，部分 Monaco 名称不同） */
const MONACO_LANG_ALIAS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  rust: 'rust',
  python: 'python',
  bash: 'shell',
  toml: 'ini',
  text: 'plaintext',
}

function toMonacoLanguage(filePath: string): string {
  const lang = inferLanguageFromPath(filePath)
  return MONACO_LANG_ALIAS[lang] ?? lang
}

export interface LocalOpenFile {
  absolutePath: string
  fileName: string
  content: string
  originalContent: string
  language: string
  isLoading: boolean
  isSaving: boolean
  loadError: string | null
}

function extractFileName(absolutePath: string): string {
  return absolutePath.split(/[/\\]/).pop() ?? absolutePath
}

export const useLocalFileEditorStore = defineStore('localFileEditor', () => {
  const openFiles = shallowRef<Map<string, LocalOpenFile>>(new Map())

  function get(absolutePath: string): LocalOpenFile | undefined {
    return openFiles.value.get(absolutePath)
  }

  function isDirty(absolutePath: string): boolean {
    const f = openFiles.value.get(absolutePath)
    return !!f && f.content !== f.originalContent
  }

  /** 确保文件已打开；已打开直接返回，未打开则载入 */
  async function ensureOpen(absolutePath: string): Promise<LocalOpenFile> {
    const existing = openFiles.value.get(absolutePath)
    if (existing) return existing

    const placeholder: LocalOpenFile = {
      absolutePath,
      fileName: extractFileName(absolutePath),
      content: '',
      originalContent: '',
      language: toMonacoLanguage(absolutePath),
      isLoading: true,
      isSaving: false,
      loadError: null,
    }
    openFiles.value.set(absolutePath, placeholder)
    triggerRef(openFiles)

    // 前置拦截：非文本扩展名直接报错，避免把二进制 Blob 灌进 Monaco
    if (!isTextFile(absolutePath)) {
      const failed: LocalOpenFile = {
        ...placeholder,
        isLoading: false,
        loadError: '不支持预览该文件类型（疑似二进制文件）',
      }
      openFiles.value.set(absolutePath, failed)
      triggerRef(openFiles)
      return failed
    }

    try {
      const content = await readTextFile(absolutePath)
      const loaded: LocalOpenFile = {
        ...placeholder,
        content,
        originalContent: content,
        isLoading: false,
      }
      openFiles.value.set(absolutePath, loaded)
      triggerRef(openFiles)
      return loaded
    } catch (e) {
      const failed: LocalOpenFile = {
        ...placeholder,
        isLoading: false,
        loadError: formatError(e),
      }
      openFiles.value.set(absolutePath, failed)
      triggerRef(openFiles)
      return failed
    }
  }

  function updateContent(absolutePath: string, content: string) {
    const file = openFiles.value.get(absolutePath)
    if (!file) return
    if (file.content === content) return
    openFiles.value.set(absolutePath, { ...file, content })
    triggerRef(openFiles)
  }

  async function save(absolutePath: string): Promise<void> {
    const file = openFiles.value.get(absolutePath)
    if (!file) return
    if (file.content === file.originalContent) return
    const toWrite = file.content

    openFiles.value.set(absolutePath, { ...file, isSaving: true })
    triggerRef(openFiles)

    try {
      await writeTextFile(absolutePath, toWrite)
      const current = openFiles.value.get(absolutePath)
      if (current) {
        openFiles.value.set(absolutePath, {
          ...current,
          originalContent: toWrite,
          isSaving: false,
        })
        triggerRef(openFiles)
      }
    } catch (e) {
      const current = openFiles.value.get(absolutePath)
      if (current) {
        openFiles.value.set(absolutePath, { ...current, isSaving: false })
        triggerRef(openFiles)
      }
      throw e
    }
  }

  function close(absolutePath: string) {
    if (openFiles.value.delete(absolutePath)) {
      triggerRef(openFiles)
    }
  }

  return {
    openFiles,
    get,
    isDirty,
    ensureOpen,
    updateContent,
    save,
    close,
  }
})
