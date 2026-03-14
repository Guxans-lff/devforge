<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X, Type, Braces, Code2, Binary, Clock, Link } from 'lucide-vue-next'
import { detectPreviewMode, PREVIEW_MODE_LABELS, type PreviewMode } from '@/utils/dataTypeDetector'
import TextPreview from '@/components/database/cell-preview/TextPreview.vue'
import JsonPreview from '@/components/database/cell-preview/JsonPreview.vue'
import XmlPreview from '@/components/database/cell-preview/XmlPreview.vue'
import HexPreview from '@/components/database/cell-preview/HexPreview.vue'
import DatetimePreview from '@/components/database/cell-preview/DatetimePreview.vue'
import UrlPreview from '@/components/database/cell-preview/UrlPreview.vue'

const props = defineProps<{
  /** 当前选中的单元格值 */
  value: unknown
  /** 列名 */
  columnName: string
  /** 列的数据类型 */
  columnType: string
}>()

const emit = defineEmits<{
  close: []
}>()

/** 自动检测的模式 */
const autoMode = computed(() => detectPreviewMode(props.value, props.columnType))

/** 用户手动覆盖的模式（null 表示使用自动检测） */
const overrideMode = ref<PreviewMode | null>(null)

/** 当前生效的模式 */
const activeMode = computed(() => overrideMode.value ?? autoMode.value)

// 值变化时重置覆盖模式
watch(() => props.value, () => {
  overrideMode.value = null
})

/** 文本化的值（用于各预览器） */
const textValue = computed(() => {
  if (props.value === null || props.value === undefined) return 'NULL'
  if (typeof props.value === 'object') return JSON.stringify(props.value, null, 2)
  return String(props.value)
})

/** 可用模式列表 */
const availableModes: { mode: PreviewMode; icon: typeof Type }[] = [
  { mode: 'text', icon: Type },
  { mode: 'json', icon: Braces },
  { mode: 'xml', icon: Code2 },
  { mode: 'hex', icon: Binary },
  { mode: 'datetime', icon: Clock },
  { mode: 'url', icon: Link },
]
</script>

<template>
  <div class="flex h-full flex-col border-t border-border bg-background">
    <!-- 头部：列名 + 模式切换 + 关闭 -->
    <div class="flex items-center gap-2 border-b border-border/50 px-3 py-1.5 shrink-0 bg-muted/20">
      <span class="text-xs font-semibold text-muted-foreground truncate">
        {{ columnName }}
      </span>
      <span class="text-[10px] text-muted-foreground/50 font-mono">
        {{ columnType }}
      </span>
      <div class="flex-1" />

      <!-- 模式切换标签 -->
      <div class="flex items-center gap-0.5">
        <button
          v-for="m in availableModes"
          :key="m.mode"
          class="flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] transition-colors"
          :class="activeMode === m.mode
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50'"
          :title="PREVIEW_MODE_LABELS[m.mode]"
          @click="overrideMode = m.mode"
        >
          <component :is="m.icon" class="h-3 w-3" />
          <span v-if="activeMode === m.mode">{{ PREVIEW_MODE_LABELS[m.mode] }}</span>
        </button>
      </div>

      <div class="w-px h-3 bg-border/50 mx-1" />
      <button
        class="h-5 w-5 flex items-center justify-center rounded-sm text-muted-foreground/50 hover:text-foreground hover:bg-muted/50"
        @click="emit('close')"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- 预览内容 -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <TextPreview v-if="activeMode === 'text'" :value="textValue" />
      <JsonPreview v-else-if="activeMode === 'json'" :value="textValue" />
      <XmlPreview v-else-if="activeMode === 'xml'" :value="textValue" />
      <HexPreview v-else-if="activeMode === 'hex'" :value="textValue" />
      <DatetimePreview v-else-if="activeMode === 'datetime'" :value="textValue" />
      <UrlPreview v-else-if="activeMode === 'url'" :value="textValue" />
    </div>
  </div>
</template>
