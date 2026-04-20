<script setup lang="ts">
/**
 * 深邃沉浸型并排 Diff — 左旧右新
 *
 * 行级对齐 + 字符级 pill 高亮
 */
import { computed } from 'vue'
import { computeSideBySideDiff } from '@/composables/useAiDiff'
import { Check, FileText, Copy } from 'lucide-vue-next'

const props = defineProps<{
  oldText: string
  newText: string
  fileName: string
  dirPath?: string
  description?: string
  /** 隐藏底部操作栏（审批卡内嵌场景，按钮由外层提供） */
  hideActions?: boolean
}>()

const emit = defineEmits<{
  apply: []
  reject: []
  close: []
}>()

const diff = computed(() => computeSideBySideDiff(props.oldText, props.newText))

const isLargeDiff = computed(() =>
  diff.value.stats.added + diff.value.stats.removed > 500
)


/** 复制新内容到剪贴板 */
async function copyNewContent() {
  try {
    await navigator.clipboard.writeText(props.newText)
  } catch (e) {
    console.error('[AiDiffViewer] 复制失败:', e)
  }
}
</script>

<template>
  <div
    class="rounded-2xl overflow-hidden relative"
    style="background: linear-gradient(160deg, #08080f, #0f0f1a, #0a0a14);"
  >
    <!-- 微光晕 -->
    <div
      class="absolute -top-10 right-10 w-40 h-40 pointer-events-none"
      style="background: radial-gradient(circle, rgba(99,102,241,0.06), transparent 70%);"
    />

    <!-- 文件信息栏（非 hideActions 模式才显示，embedded 时外层已有文件名和变更数） -->
    <div v-if="!hideActions" class="flex items-center gap-2.5 px-4 py-3 relative z-10">
      <div
        class="w-7 h-7 rounded-[10px] flex items-center justify-center shadow-lg"
        style="background: linear-gradient(135deg, #6366f1, #8b5cf6); box-shadow: 0 2px 10px rgba(99,102,241,0.25);"
      >
        <FileText class="w-3.5 h-3.5 text-white" />
      </div>
      <div>
        <div class="font-semibold text-[13px] text-[#f0f0ff] tracking-tight">{{ fileName }}</div>
        <div class="text-[10px] text-white/25 mt-0.5">{{ dirPath }}{{ description ? ` · ${description}` : '' }}</div>
      </div>
      <div class="ml-auto flex gap-1.5">
        <span
          class="text-[10px] px-2.5 py-0.5 rounded-full border"
          style="background: rgba(74,222,128,0.06); border-color: rgba(74,222,128,0.1); color: #4ade80;"
        >+{{ diff.stats.added }}</span>
        <span
          class="text-[10px] px-2.5 py-0.5 rounded-full border"
          style="background: rgba(248,113,113,0.06); border-color: rgba(248,113,113,0.1); color: #f87171;"
        >−{{ diff.stats.removed }}</span>
      </div>
    </div>

    <!-- 列标题 -->
    <div class="flex mx-3.5 rounded-t-lg overflow-hidden border border-b-0" style="border-color: rgba(255,255,255,0.04);">
      <div
        class="flex-1 px-3.5 py-1.5 text-[9px] uppercase tracking-[1.5px] font-semibold flex items-center gap-1.5"
        style="background: rgba(248,113,113,0.03); color: rgba(248,113,113,0.5);"
      >
        <span class="w-[5px] h-[5px] rounded-full" style="background: rgba(248,113,113,0.4);"></span>
        Before
      </div>
      <div class="w-px" style="background: rgba(255,255,255,0.04);"></div>
      <div
        class="flex-1 px-3.5 py-1.5 text-[9px] uppercase tracking-[1.5px] font-semibold flex items-center gap-1.5"
        style="background: rgba(74,222,128,0.03); color: rgba(74,222,128,0.5);"
      >
        <span class="w-[5px] h-[5px] rounded-full" style="background: rgba(74,222,128,0.4);"></span>
        After
      </div>
    </div>

    <!-- Diff 主体 -->
    <div
      class="flex mx-3.5 rounded-b-lg overflow-hidden border border-t-0 font-mono text-[10.5px]"
      style="border-color: rgba(255,255,255,0.04); background: rgba(0,0,0,0.2);"
      :class="isLargeDiff && 'max-h-[400px] overflow-y-auto'"
    >
      <!-- 左列 Before -->
      <div class="flex-1 min-w-0">
        <div
          v-for="(line, i) in diff.left"
          :key="'l' + i"
          class="flex items-center"
          :class="line.type === 'removed' && 'border-l-2'"
          :style="{
            borderColor: line.type === 'removed' ? 'rgba(248,113,113,0.5)' : 'transparent',
            background: line.type === 'removed'
              ? 'linear-gradient(90deg, rgba(248,113,113,0.08), rgba(248,113,113,0.02))'
              : line.type === 'empty'
                ? 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.008) 4px, rgba(255,255,255,0.008) 8px)'
                : 'transparent',
            borderBottom: '1px solid rgba(255,255,255,0.015)',
            padding: '3px 0',
          }"
        >
          <span
            class="w-9 text-right pr-2.5 flex-shrink-0 text-[9px]"
            :style="{ color: line.type === 'removed' ? 'rgba(248,113,113,0.2)' : 'rgba(255,255,255,0.08)' }"
          >{{ line.lineNumber ?? '' }}</span>
          <span class="truncate" :style="{ color: line.type === 'unchanged' ? 'rgba(255,255,255,0.18)' : '#e5e5eb' }">
            <template v-if="line.charDiffs">
              <span
                v-for="(cd, j) in line.charDiffs"
                :key="j"
                :style="{
                  background: cd.type === 'removed' ? 'rgba(248,113,113,0.12)' : 'transparent',
                  color: cd.type === 'removed' ? '#fca5a5' : undefined,
                  padding: cd.type === 'removed' ? '1px 3px' : '0',
                  borderRadius: cd.type === 'removed' ? '3px' : '0',
                }"
              >{{ cd.value }}</span>
            </template>
            <template v-else>{{ line.content }}</template>
          </span>
        </div>
      </div>

      <div class="w-px" style="background: rgba(255,255,255,0.04);"></div>

      <!-- 右列 After -->
      <div class="flex-1 min-w-0">
        <div
          v-for="(line, i) in diff.right"
          :key="'r' + i"
          class="flex items-center"
          :class="line.type === 'added' && 'border-r-2'"
          :style="{
            borderColor: line.type === 'added' ? 'rgba(74,222,128,0.5)' : 'transparent',
            background: line.type === 'added'
              ? 'linear-gradient(270deg, rgba(74,222,128,0.08), rgba(74,222,128,0.02))'
              : line.type === 'empty'
                ? 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.008) 4px, rgba(255,255,255,0.008) 8px)'
                : 'transparent',
            borderBottom: '1px solid rgba(255,255,255,0.015)',
            padding: '3px 0',
          }"
        >
          <span
            class="w-9 text-right pr-2.5 flex-shrink-0 text-[9px]"
            :style="{ color: line.type === 'added' ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.08)' }"
          >{{ line.lineNumber ?? '' }}</span>
          <span class="truncate" :style="{ color: line.type === 'unchanged' ? 'rgba(255,255,255,0.18)' : '#e5e5eb' }">
            <template v-if="line.charDiffs">
              <span
                v-for="(cd, j) in line.charDiffs"
                :key="j"
                :style="{
                  background: cd.type === 'added' ? 'rgba(74,222,128,0.1)' : 'transparent',
                  color: cd.type === 'added' ? '#86efac' : undefined,
                  padding: cd.type === 'added' ? '1px 3px' : '0',
                  borderRadius: cd.type === 'added' ? '3px' : '0',
                }"
              >{{ cd.value }}</span>
            </template>
            <template v-else>{{ line.content }}</template>
          </span>
        </div>
      </div>
    </div>

    <!-- 操作栏 -->
    <div v-if="!hideActions" class="flex items-center gap-2 px-3.5 py-3">
      <button
        class="flex items-center gap-1.5 px-5 py-[7px] rounded-[10px] text-[11px] font-semibold text-white border-none cursor-pointer"
        style="background: linear-gradient(135deg, #22c55e, #16a34a); box-shadow: 0 2px 12px rgba(34,197,94,0.2);"
        @click="$emit('apply')"
      >
        <Check class="w-3 h-3" />
        应用更改
      </button>
      <button
        class="px-4 py-[7px] rounded-[10px] text-[11px] text-white/35 border cursor-pointer"
        style="background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.06);"
        @click="$emit('reject')"
      >撤销</button>
      <button
        class="px-4 py-[7px] rounded-[10px] text-[11px] text-white/35 border cursor-pointer"
        style="background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.06);"
        @click="$emit('close')"
      >收起</button>
      <button
        class="px-4 py-[7px] rounded-[10px] text-[11px] text-white/35 border cursor-pointer"
        style="background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.06);"
        @click="copyNewContent"
      >
        <Copy class="w-3 h-3" />
      </button>
      <div class="ml-auto flex items-center gap-1.5">
        <div
          class="w-[5px] h-[5px] rounded-full"
          style="background: linear-gradient(135deg, #6366f1, #a855f7); box-shadow: 0 0 4px rgba(99,102,241,0.3);"
        />
        <span class="text-[9px]" style="color: rgba(255,255,255,0.15);">AI generated</span>
      </div>
    </div>
  </div>
</template>
