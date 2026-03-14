<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** XML 字符串 */
  value: string
}>()

/** 格式化 XML（简单缩进） */
const formattedXml = computed(() => {
  try {
    return formatXml(props.value)
  } catch {
    return props.value
  }
})

/** 格式化 XML 字符串 */
function formatXml(xml: string): string {
  let formatted = ''
  let indent = 0
  const lines = xml
    .replace(/>\s*</g, '>\n<')
    .split('\n')

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // 闭合标签减少缩进
    if (line.startsWith('</')) {
      indent = Math.max(0, indent - 1)
    }

    formatted += '  '.repeat(indent) + line + '\n'

    // 开始标签且非自闭合增加缩进
    if (line.startsWith('<') && !line.startsWith('</') && !line.startsWith('<?') && !line.endsWith('/>') && !line.includes('</')) {
      indent++
    }
  }
  return formatted.trim()
}

/** 语法高亮分段 */
interface XmlSegment {
  type: 'tag' | 'attr-name' | 'attr-value' | 'text' | 'comment' | 'declaration'
  text: string
}

/** 将 XML 行解析为带颜色的分段 */
function tokenizeLine(line: string): XmlSegment[] {
  const segments: XmlSegment[] = []
  // 简单的正则分词
  const regex = /(<\?[^?]*\?>|<!--[\s\S]*?-->|<\/?\w[\w.-]*|\/?>|"[^"]*"|'[^']*'|\w[\w.-]*=|[^<>"']+)/g
  let match
  while ((match = regex.exec(line)) !== null) {
    const token = match[1] ?? ''
    if (token.startsWith('<!--')) {
      segments.push({ type: 'comment', text: token })
    } else if (token.startsWith('<?')) {
      segments.push({ type: 'declaration', text: token })
    } else if (token.startsWith('</') || token.startsWith('<')) {
      segments.push({ type: 'tag', text: token })
    } else if (token === '/>' || token === '>') {
      segments.push({ type: 'tag', text: token })
    } else if (token.endsWith('=')) {
      segments.push({ type: 'attr-name', text: token })
    } else if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      segments.push({ type: 'attr-value', text: token })
    } else {
      segments.push({ type: 'text', text: token })
    }
  }
  return segments
}

/** 颜色映射 */
function getSegmentClass(type: XmlSegment['type']): string {
  switch (type) {
    case 'tag': return 'text-blue-600 dark:text-blue-400'
    case 'attr-name': return 'text-amber-600 dark:text-amber-400'
    case 'attr-value': return 'text-green-600 dark:text-green-400'
    case 'comment': return 'text-muted-foreground/50 italic'
    case 'declaration': return 'text-purple-600 dark:text-purple-400'
    default: return 'text-foreground'
  }
}

const lines = computed(() =>
  formattedXml.value.split('\n').map(line => ({
    raw: line,
    segments: tokenizeLine(line),
  }))
)
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex-1 overflow-auto p-3">
      <pre class="text-xs font-mono leading-relaxed select-text"><template v-for="(line, i) in lines" :key="i"><span class="text-muted-foreground/30 select-none inline-block w-8 text-right mr-2 tabular-nums">{{ i + 1 }}</span><template v-for="(seg, j) in line.segments" :key="j"><span :class="getSegmentClass(seg.type)">{{ seg.text }}</span></template>
</template></pre>
    </div>
    <div class="flex items-center gap-3 border-t border-border/50 px-3 py-1 text-[10px] text-muted-foreground shrink-0">
      <span>{{ lines.length }} 行</span>
      <span>{{ value.length }} 字符</span>
    </div>
  </div>
</template>
