<script setup lang="ts">
import { computed } from 'vue'
import { getBezierPath, BaseEdge, EdgeLabelRenderer, Position, type EdgeProps } from '@vue-flow/core'
import type { ErEdgeData } from '@/types/er-diagram'

const props = defineProps<EdgeProps<ErEdgeData>>()

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
</script>

<template>
  <BaseEdge
    :id="id"
    :path="path.d"
    :class="selected ? 'stroke-primary' : 'stroke-muted-foreground/40'"
    :style="{ strokeWidth: selected ? 2 : 1.5 }"
  />
  <!-- 关系标签 -->
  <EdgeLabelRenderer>
    <div
      class="absolute pointer-events-auto px-1.5 py-0.5 rounded text-[9px] font-mono bg-background/90 border border-border/50 shadow-sm"
      :class="selected ? 'text-primary' : 'text-muted-foreground/60'"
      :style="{
        transform: `translate(-50%, -50%) translate(${path.labelX}px, ${path.labelY}px)`,
      }"
      :title="`${data.sourceColumn} → ${data.targetColumn}`"
    >
      {{ data.sourceColumn }} → {{ data.targetColumn }}
    </div>
  </EdgeLabelRenderer>
</template>
