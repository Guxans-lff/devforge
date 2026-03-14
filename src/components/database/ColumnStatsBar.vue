<script setup lang="ts">
import { computed } from 'vue'
import type { ColumnStatsResult } from '@/utils/columnStatistics'

const props = defineProps<{
  /** 统计结果 */
  stats: ColumnStatsResult
  /** 列名 */
  columnName: string
}>()

/** 格式化数字（保留合理精度） */
function fmt(n: number, decimals = 2): string {
  if (Number.isInteger(n)) return n.toLocaleString()
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals })
}

const items = computed(() => {
  const { basic, numeric, string: strStats } = props.stats
  const result: { label: string; value: string; color?: string }[] = [
    { label: '总计', value: fmt(basic.totalCount, 0) },
    { label: '唯一', value: fmt(basic.uniqueCount, 0) },
    { label: 'NULL', value: `${fmt(basic.nullCount, 0)} (${basic.nullPercent.toFixed(1)}%)`, color: basic.nullCount > 0 ? 'text-amber-500' : undefined },
  ]

  if (numeric) {
    result.push(
      { label: '最小', value: fmt(numeric.min) },
      { label: '最大', value: fmt(numeric.max) },
      { label: '平均', value: fmt(numeric.avg) },
      { label: '中位', value: fmt(numeric.median) },
      { label: '总和', value: fmt(numeric.sum) },
    )
  }

  if (strStats) {
    result.push(
      { label: '长度', value: `${strStats.minLength}~${strStats.maxLength}` },
      { label: '平均长', value: fmt(strStats.avgLength, 1) },
    )
    if (strStats.emptyCount > 0) {
      result.push({ label: '空串', value: fmt(strStats.emptyCount, 0), color: 'text-amber-500' })
    }
  }

  return result
})
</script>

<template>
  <div class="flex items-center gap-3 px-3 py-1 text-[10px] text-muted-foreground overflow-x-auto">
    <span class="font-semibold text-foreground/70 shrink-0">{{ columnName }}</span>
    <div class="w-px h-3 bg-border/50" />
    <div
      v-for="item in items"
      :key="item.label"
      class="flex items-center gap-1 shrink-0"
    >
      <span class="opacity-60">{{ item.label }}</span>
      <span class="font-mono font-medium tabular-nums" :class="item.color ?? 'text-foreground/80'">
        {{ item.value }}
      </span>
    </div>
  </div>
</template>
