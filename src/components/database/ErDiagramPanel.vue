<script setup lang="ts">
import { onMounted, watch, computed, markRaw } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import { Controls } from '@vue-flow/controls'
import { Search, LayoutGrid, Download, Maximize, Loader2, AlertCircle } from 'lucide-vue-next'
import { useErDiagram } from '@/composables/useErDiagram'
import ErTableNode from '@/components/database/er-diagram/ErTableNode.vue'
import ErRelationEdge from '@/components/database/er-diagram/ErRelationEdge.vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  connectionId: string
  database: string
}>()

const emit = defineEmits<{
  openTableEditor: [database: string, tableName: string]
}>()

const {
  nodes,
  edges,
  loading,
  error,
  searchQuery,
  layoutOptions,
  highlightedNodes,
  loadDiagram,
  toggleDirection,
} = useErDiagram(props.connectionId, props.database)

const { fitView } = useVueFlow()

/** 自定义节点类型注册 */
const nodeTypes = {
  erTable: markRaw(ErTableNode),
} as any

/** 自定义边类型注册 */
const edgeTypes = {
  erRelation: markRaw(ErRelationEdge),
} as any

/** 搜索时更新节点高亮 */
watch(highlightedNodes, (highlighted) => {
  nodes.value = nodes.value.map(n => ({
    ...n,
    data: { ...(n.data ?? {}), highlighted: highlighted.has(n.id) },
  })) as any
})

/** 适应视图 */
function handleFitView() {
  fitView({ duration: 300, padding: 0.2 })
}

/** 导出为 PNG */
async function exportPng() {
  // 使用 html2canvas 方式导出（简化实现）
  const flowEl = document.querySelector('.vue-flow') as HTMLElement
  if (!flowEl) return

  try {
    // 动态导入 html2canvas 太重，改用 SVG 序列化
    const svgEl = flowEl.querySelector('svg.vue-flow__edges')
    if (!svgEl) return
    // 简单截图提示（完整实现需要额外库）
    // 这里先用浏览器原生 API
    const svgData = new XMLSerializer().serializeToString(svgEl)
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `er-diagram-${props.database}.svg`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    console.warn('导出失败:', e)
  }
}

onMounted(() => {
  loadDiagram()
})

/** 方向标签 */
const directionLabel = computed(() =>
  layoutOptions.value.direction === 'TB' ? '上→下' : '左→右',
)
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 工具栏 -->
    <div class="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5 shrink-0">
      <div class="flex items-center gap-1.5 flex-1">
        <Search class="h-3.5 w-3.5 text-muted-foreground" />
        <input
          v-model="searchQuery"
          placeholder="搜索表名..."
          class="h-6 w-48 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
        />
      </div>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1.5 text-[10px] px-2"
        @click="toggleDirection"
      >
        <LayoutGrid class="h-3 w-3" />
        {{ directionLabel }}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1.5 text-[10px] px-2"
        @click="handleFitView"
      >
        <Maximize class="h-3 w-3" />
        适应视图
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1.5 text-[10px] px-2"
        @click="exportPng"
      >
        <Download class="h-3 w-3" />
        导出 SVG
      </Button>
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="flex flex-1 items-center justify-center">
      <div class="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 class="h-4 w-4 animate-spin" />
        正在加载 ER 图...
      </div>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="flex flex-1 flex-col items-center justify-center gap-3">
      <AlertCircle class="h-8 w-8 text-destructive" />
      <p class="text-sm text-destructive">{{ error }}</p>
      <Button size="sm" @click="loadDiagram">重试</Button>
    </div>

    <!-- ER 图画布 -->
    <div v-else class="flex-1 min-h-0">
      <VueFlow
        :nodes="nodes"
        :edges="edges"
        :node-types="nodeTypes"
        :edge-types="edgeTypes"
        :min-zoom="0.1"
        :max-zoom="3"
        :default-viewport="{ zoom: 0.8, x: 50, y: 50 }"
        fit-view-on-init
        class="h-full w-full bg-background"
        @nodes-change="(changes: any) => {
          // 处理节点拖拽位置更新
          for (const change of changes) {
            if (change.type === 'position' && change.position) {
              nodes = nodes.map(n =>
                n.id === change.id ? { ...n, position: change.position } : n,
              )
            }
          }
        }"
      >
        <MiniMap
          pannable
          zoomable
          class="!bg-muted/30 !border-border"
        />
        <Controls class="!bg-background !border-border" />
      </VueFlow>

      <!-- 无表提示 -->
      <div
        v-if="nodes.length === 0"
        class="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <p class="text-sm text-muted-foreground/50">此数据库暂无表</p>
      </div>
    </div>

    <!-- 底部状态栏 -->
    <div class="flex items-center gap-3 border-t border-border bg-muted/20 px-3 py-1 text-[10px] text-muted-foreground shrink-0">
      <span>{{ nodes.length }} 张表</span>
      <span>{{ edges.length }} 条关系</span>
      <span>布局: {{ directionLabel }}</span>
    </div>
  </div>
</template>

<style>
/* vue-flow 必需的样式导入 */
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
@import '@vue-flow/minimap/dist/style.css';
@import '@vue-flow/controls/dist/style.css';
</style>
