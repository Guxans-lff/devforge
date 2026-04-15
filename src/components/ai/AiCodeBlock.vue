<script setup lang="ts">
/**
 * AI 代码块组件
 *
 * 支持语法高亮（shiki）、复制、语言标签、行号。
 */
import { computed, ref, onMounted, watch } from 'vue'
import { Copy, Check, Download } from 'lucide-vue-next'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@/api/database'

const props = withDefaults(defineProps<{
  language: string
  code: string
  /** 是否显示顶栏操作按钮（复制/保存），默认 true */
  showActions?: boolean
}>(), {
  showActions: true,
})

const copied = ref(false)
const highlightedHtml = ref('')

/** 语言 → 文件扩展名映射 */
const LANG_EXT: Record<string, string> = {
  javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts',
  tsx: 'tsx', jsx: 'jsx', python: 'py', py: 'py',
  rust: 'rs', rs: 'rs', go: 'go', sql: 'sql',
  shell: 'sh', sh: 'sh', bash: 'sh', json: 'json',
  yaml: 'yaml', yml: 'yaml', html: 'html', css: 'css',
  vue: 'vue', markdown: 'md', md: 'md', java: 'java',
  kotlin: 'kt', swift: 'swift', dart: 'dart', text: 'txt',
}

/** 语言显示名称 */
const displayLang = computed(() => {
  const langMap: Record<string, string> = {
    js: 'JavaScript',
    ts: 'TypeScript',
    tsx: 'TSX',
    jsx: 'JSX',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    sql: 'SQL',
    sh: 'Shell',
    bash: 'Bash',
    json: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    html: 'HTML',
    css: 'CSS',
    vue: 'Vue',
    md: 'Markdown',
    text: 'Text',
  }
  return langMap[props.language.toLowerCase()] ?? props.language.toUpperCase()
})

/** 复制代码 */
async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // 静默失败
  }
}

/** 保存代码到文件 */
async function saveCode() {
  const ext = LANG_EXT[props.language.toLowerCase()] ?? 'txt'
  const defaultName = `code-${Date.now()}.${ext}`

  const filePath = await save({
    defaultPath: defaultName,
    filters: [{ name: `${displayLang.value} 文件`, extensions: [ext] }],
  })
  if (!filePath) return

  try {
    await writeTextFile(filePath, props.code)
  } catch (e) {
    console.error('[AI] 保存代码失败:', e)
  }
}

/** 异步加载 shiki 高亮 */
async function highlight() {
  try {
    const { codeToHtml } = await import('shiki')
    const html = await codeToHtml(props.code, {
      lang: props.language || 'text',
      theme: document.documentElement.classList.contains('dark')
        ? 'github-dark'
        : 'github-light',
    })
    highlightedHtml.value = html
  } catch {
    // shiki 不支持的语言，回退到纯文本
    highlightedHtml.value = ''
  }
}

onMounted(highlight)
watch(() => [props.code, props.language], highlight)
</script>

<template>
  <div class="rounded-lg border border-border/50 overflow-hidden bg-muted/30">
    <!-- 顶栏 -->
    <div class="flex items-center justify-between px-3 py-1.5 border-b border-border/50 bg-muted/50">
      <span class="text-[10px] font-mono font-medium text-muted-foreground">
        {{ displayLang }}
      </span>
      <div v-if="showActions" class="flex items-center gap-1">
        <button
          class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="保存为文件"
          @click="saveCode"
        >
          <Download class="h-3 w-3" />
          <span>保存</span>
        </button>
        <button
          class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          :title="copied ? '已复制' : '复制代码'"
          @click="copyCode"
        >
          <component :is="copied ? Check : Copy" class="h-3 w-3" />
          <span>{{ copied ? '已复制' : '复制' }}</span>
        </button>
      </div>
    </div>
    <!-- 代码内容 -->
    <div class="overflow-x-auto">
      <div
        v-if="highlightedHtml"
        class="p-3 text-[12px] leading-relaxed [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_code]:!text-[12px]"
        v-html="highlightedHtml"
      />
      <pre
        v-else
        class="p-3 text-[12px] leading-relaxed font-mono text-foreground whitespace-pre-wrap"
      ><code>{{ code }}</code></pre>
    </div>
  </div>
</template>
