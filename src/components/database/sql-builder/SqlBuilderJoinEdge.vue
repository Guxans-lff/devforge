<script setup lang="ts">
import { computed } from 'vue'
import { getBezierPath, BaseEdge, EdgeLabelRenderer, Position } from '@vue-flow/core'
import type { SqlBuilderEdgeData, JoinType } from '@/types/sql-builder'

const props = defineProps<{
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: string
  targetPosition: string
  data: SqlBuilderEdgeData
  selected?: boolean
  animated?: boolean
}>()

const emit = defineEmits<{
  updateJoinType: [joinType: JoinType]
  removeJoin: []
}>()

const path = computed(() => {
  const [d, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition as Position,
    targetPosition: props.targetPosition as Position,
  })
  return { d, labelX, labelY }
})

const joinTypes: JoinType[] = ['INNER', 'LEFT', 'RIGHT', 'FULL']

/** 循环切换 JOIN 类型 */
function cycleJoinType() {
  const idx = joinTypes.indexOf(props.data.joinType)
  const next = joinTypes[(idx + 1) % joinTypes.length]!
  emit('updateJoinType', next)
}

const joinColor = computed(() => {
  switch (props.data.joinType) {
    case 'INNER': return 'bg-primary/10 text-primary border-primary/30'
    case 'LEFT': return 'bg-blue-500/10 text-blue-600 border-blue-500/30'
    case 'RIGHT': return 'bg-green-500/10 text-green-600 border-green-500/30'
    case 'FULL': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30'
    default: return 'bg-muted text-muted-foreground border-border'
  }
})
</script>

<template>
  <BaseEdge
    :id="id"
    :path="path.d"
    :class="selected ? 'stroke-primary' : 'stroke-muted-foreground/40'"
    :style="{ strokeWidth: selected ? 2.5 : 1.5 }"
  />
  <EdgeLabelRenderer>
    <div
      class="absolute pointer-events-auto flex flex-col items-center gap-0.5"
      :style="{
        transform: `translate(-50%, -50%) translate(${path.labelX}px, ${path.labelY}px)`,
      }"
    >
      <!-- JOIN 类型标签（点击切换） -->
      <div class="flex items-center gap-0.5">
        <button
          class="px-1.5 py-0.5 rounded-l border text-[9px] font-mono font-bold cursor-pointer hover:opacity-80 shadow-sm"
          :class="joinColor"
          :title="`点击切换 JOIN 类型（当前 ${data.joinType}）`"
          @click.stop="cycleJoinType"
        >
          {{ data.joinType }}
        </button>
        <button
          class="px-1 py-0.5 rounded-r border border-l-0 text-[9px] text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 bg-background/90 shadow-sm"
          title="删除 JOIN"
          @click.stop="emit('removeJoin')"
        >
          ✕
        </button>
      </div>
      <!-- 列映射 -->
      <span class="text-[8px] text-muted-foreground/50 font-mono bg-background/80 px-1 rounded">
        {{ data.sourceColumn }} = {{ data.targetColumn }}
      </span>
    </div>
  </EdgeLabelRenderer>
</template>
