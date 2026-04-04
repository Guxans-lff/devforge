<script setup lang="ts">
/**
 * Git 分支图 — Canvas 渲染
 * 彩色分支线、节点圆点、hover 信息、点击查看 diff、Ref 标签、虚拟滚动
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { gitGetGraph } from '@/api/git'
import type { GitGraph, GitGraphNode, GitRef } from '@/types/git'
import { useToast } from '@/composables/useToast'
import { Loader2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  repoPath: string
}>()

const emit = defineEmits<{
  viewCommitDiff: [hash: string]
  createBranch: [hash: string]
  createTag: [hash: string]
  cherryPick: [hash: string]
}>()

const { t } = useI18n()
const toast = useToast()

// ── 数据 ────────────────────────────────────────────────────────
const graph = ref<GitGraph | null>(null)
const loading = ref(false)
const hasMore = ref(true)
const PAGE_SIZE = 200

// ── Canvas 布局常量 ─────────────────────────────────────────────
const ROW_HEIGHT = 28
const COL_WIDTH = 16
const NODE_RADIUS = 4
const GRAPH_PADDING_LEFT = 12
const TEXT_PADDING_LEFT = 16 // 图区右侧到文字的间距

// ── 缩放 ────────────────────────────────────────────────────────
const scale = ref(1)
const MIN_SCALE = 0.5
const MAX_SCALE = 2

// ── DOM ─────────────────────────────────────────────────────────
const containerRef = ref<HTMLDivElement>()
const canvasRef = ref<HTMLCanvasElement>()
const scrollRef = ref<HTMLDivElement>()

// ── Hover / 右键 ────────────────────────────────────────────────
const hoverNode = ref<GitGraphNode | null>(null)
const hoverPos = ref({ x: 0, y: 0 })
const contextNode = ref<GitGraphNode | null>(null)
const contextPos = ref({ x: 0, y: 0 })

// ── 虚拟滚动 ───────────────────────────────────────────────────
const scrollTop = ref(0)
const viewportHeight = ref(600)
const OVERSCAN = 5 // 上下各多渲染 5 行缓冲

const visibleNodes = computed(() => {
  if (!graph.value) return []
  const rowH = ROW_HEIGHT * scale.value
  const startIdx = Math.max(0, Math.floor(scrollTop.value / rowH) - OVERSCAN)
  const endIdx = Math.min(graph.value.nodes.length, Math.ceil((scrollTop.value + viewportHeight.value) / rowH) + OVERSCAN)
  return graph.value.nodes.slice(startIdx, endIdx)
})

// ── 列颜色 ──────────────────────────────────────────────────────
const COLORS = [
  '#4f8ff7', '#e5534b', '#57ab5a', '#c69026',
  '#b083f0', '#e275ad', '#39c5cf', '#768390',
  '#6cb6ff', '#f47067', '#8ddb8c', '#f2cc60',
  '#dcbdfb', '#f69dab', '#76e3ea', '#adbac7',
]
function colColor(col: number): string {
  return COLORS[col % COLORS.length]!
}

// ── 计算属性 ────────────────────────────────────────────────────
const graphWidth = computed(() => {
  if (!graph.value) return 100
  return GRAPH_PADDING_LEFT + (graph.value.maxCols + 1) * COL_WIDTH
})

const totalHeight = computed(() => {
  if (!graph.value) return 0
  return graph.value.nodes.length * ROW_HEIGHT * scale.value
})

// ── 加载数据 ────────────────────────────────────────────────────
onMounted(async () => {
  await loadGraph(0)
  await nextTick()
  drawGraph()
})

async function loadGraph(skip: number) {
  if (loading.value) return
  loading.value = true
  try {
    const data = await gitGetGraph(props.repoPath, skip, PAGE_SIZE)
    if (skip === 0) {
      graph.value = data
    } else if (graph.value) {
      graph.value = {
        nodes: [...graph.value.nodes, ...data.nodes],
        maxCols: Math.max(graph.value.maxCols, data.maxCols),
      }
    }
    hasMore.value = data.nodes.length >= PAGE_SIZE
  } catch (e) {
    toast.error(t('git.graphFailed'), String(e))
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loading.value || !hasMore.value || !graph.value) return
  await loadGraph(graph.value.nodes.length)
  await nextTick()
  drawGraph()
}

// ── 缓存 hashToRow 映射，仅在 graph 变更时重建 ────────────────
let _cachedHashToRow: Map<string, number> | null = null
let _cachedGraphNodes: GitGraphNode[] | null = null

function getHashToRow(nodes: GitGraphNode[]): Map<string, number> {
  if (_cachedHashToRow && _cachedGraphNodes === nodes) return _cachedHashToRow
  const map = new Map<string, number>()
  for (const node of nodes) {
    map.set(node.hash, node.row)
  }
  _cachedHashToRow = map
  _cachedGraphNodes = nodes
  return map
}

// ── Canvas 绘制 ─────────────────────────────────────────────────
function drawGraph() {
  const canvas = canvasRef.value
  const nodes = graph.value?.nodes
  if (!canvas || !nodes || nodes.length === 0) return

  const dpr = window.devicePixelRatio || 1
  const s = scale.value
  const w = graphWidth.value * s
  const h = nodes.length * ROW_HEIGHT * s

  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`

  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)

  // 使用缓存的 hashToRow 映射
  const hashToRow = getHashToRow(nodes)

  // 画连线
  ctx.lineWidth = 1.5 * s
  for (const node of nodes) {
    const nx = (GRAPH_PADDING_LEFT + node.col * COL_WIDTH) * s
    const ny = (node.row * ROW_HEIGHT + ROW_HEIGHT / 2) * s

    for (const parent of node.parents) {
      const parentRow = hashToRow.get(parent.parentHash)
      if (parentRow === undefined) continue // 父节点不在当前页

      const px = (GRAPH_PADDING_LEFT + parent.parentCol * COL_WIDTH) * s
      const py = (parentRow * ROW_HEIGHT + ROW_HEIGHT / 2) * s

      ctx.beginPath()
      ctx.strokeStyle = colColor(node.col)

      if (node.col === parent.parentCol) {
        // 同列：直线
        ctx.moveTo(nx, ny)
        ctx.lineTo(px, py)
      } else {
        // 跨列：贝塞尔曲线
        const midY = ny + ROW_HEIGHT * s * 0.5
        ctx.moveTo(nx, ny)
        ctx.bezierCurveTo(nx, midY, px, midY, px, py)
      }
      ctx.stroke()
    }
  }

  // 画节点
  for (const node of nodes) {
    const cx = (GRAPH_PADDING_LEFT + node.col * COL_WIDTH) * s
    const cy = (node.row * ROW_HEIGHT + ROW_HEIGHT / 2) * s
    const r = NODE_RADIUS * s

    // 外圈
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = colColor(node.col)
    ctx.fill()

    // 多 parent（merge commit）用空心圈
    if (node.parents.length > 1) {
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2)
      ctx.fillStyle = '#1c2128'
      ctx.fill()
    }
  }
}

// ── 滚动自动加载 + 虚拟滚动追踪（rAF 节流） ────────────────────
let scrollRafId: number | null = null
function onScroll(e: Event) {
  if (scrollRafId !== null) return
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null
    const el = e.target as HTMLElement
    scrollTop.value = el.scrollTop
    viewportHeight.value = el.clientHeight
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
      loadMore()
    }
  })
}

// ── 鼠标事件（rAF 节流） ────────────────────────────────────────
function getNodeAtY(clientY: number): GitGraphNode | null {
  const scroll = scrollRef.value
  if (!scroll || !graph.value) return null
  const rect = scroll.getBoundingClientRect()
  const y = clientY - rect.top + scroll.scrollTop
  const row = Math.floor(y / (ROW_HEIGHT * scale.value))
  return graph.value.nodes[row] ?? null
}

let moveRafId: number | null = null
function onMouseMove(e: MouseEvent) {
  if (moveRafId !== null) return
  moveRafId = requestAnimationFrame(() => {
    moveRafId = null
    const node = getNodeAtY(e.clientY)
    if (node !== hoverNode.value) {
      hoverNode.value = node
      hoverPos.value = { x: e.clientX, y: e.clientY }
    }
  })
}

function onMouseLeave() {
  hoverNode.value = null
}

function onClick(e: MouseEvent) {
  const node = getNodeAtY(e.clientY)
  if (node) {
    emit('viewCommitDiff', node.hash)
  }
}

function closeContextMenu() {
  contextNode.value = null
  document.removeEventListener('click', closeContextMenu)
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  const node = getNodeAtY(e.clientY)
  if (!node) return
  closeContextMenu()
  contextNode.value = node
  contextPos.value = { x: e.clientX, y: e.clientY }
  setTimeout(() => document.addEventListener('click', closeContextMenu), 0)
}

// ── 缩放 ────────────────────────────────────────────────────────
function zoomIn() {
  scale.value = Math.min(MAX_SCALE, +(scale.value + 0.25).toFixed(2))
  nextTick(drawGraph)
}
function zoomOut() {
  scale.value = Math.max(MIN_SCALE, +(scale.value - 0.25).toFixed(2))
  nextTick(drawGraph)
}
function zoomReset() {
  scale.value = 1
  nextTick(drawGraph)
}

// ── 监听缩放 → 重绘 ────────────────────────────────────────────
watch(scale, () => nextTick(drawGraph))

// ── Ref 标签渲染工具 ────────────────────────────────────────────
function refBadgeClass(r: GitRef) {
  switch (r.refType) {
    case 'HEAD': return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
    case 'branch': return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    case 'remote': return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'tag': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    default: return 'bg-muted text-muted-foreground border-border'
  }
}

function formatTime(ts: number) {
  const d = new Date(ts * 1000)
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`
  if (diff < 2592000000) return `${Math.floor(diff / 86400000)}d`
  return d.toLocaleDateString()
}

function copyText(text: string) {
  navigator.clipboard.writeText(text)
  toast.success(t('git.copied'))
}

// ── 窗口 resize 重绘（防抖） ───────────────────────────────────
let resizeObs: ResizeObserver | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  if (containerRef.value) {
    resizeObs = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => drawGraph(), 200)
    })
    resizeObs.observe(containerRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObs?.disconnect()
  if (resizeTimer) clearTimeout(resizeTimer)
  document.removeEventListener('click', closeContextMenu)
})
</script>

<template>
  <div ref="containerRef" class="flex flex-col h-full">
    <!-- 工具栏 -->
    <div class="flex items-center gap-1 px-2 py-1 border-b border-border bg-muted/20">
      <span class="text-xs font-medium text-muted-foreground mr-auto">{{ t('git.branchGraph') }}</span>
      <Button variant="ghost" size="icon" class="h-7 w-7" @click="zoomOut" :title="t('git.zoomOut')">
        <ZoomOut class="h-3.5 w-3.5" />
      </Button>
      <span class="text-[10px] text-muted-foreground min-w-[36px] text-center">{{ Math.round(scale * 100) }}%</span>
      <Button variant="ghost" size="icon" class="h-7 w-7" @click="zoomIn" :title="t('git.zoomIn')">
        <ZoomIn class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" class="h-7 w-7" @click="zoomReset" :title="t('git.zoomReset')">
        <RotateCcw class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- 图 + 信息滚动区域 -->
    <div
      ref="scrollRef"
      class="flex-1 overflow-auto min-h-0"
      @scroll="onScroll"
      @mousemove="onMouseMove"
      @mouseleave="onMouseLeave"
      @click="onClick"
      @contextmenu="onContextMenu"
    >
      <!-- 初始 loading -->
      <div v-if="loading && !graph" class="flex items-center justify-center py-12">
        <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
      </div>

      <div v-else-if="graph" class="relative" :style="{ minHeight: totalHeight + 'px' }">
        <!-- Canvas 分支图（绝对定位左侧） -->
        <canvas
          ref="canvasRef"
          class="absolute left-0 top-0"
          :style="{ width: graphWidth * scale + 'px', height: totalHeight + 'px' }"
        />

        <!-- 提交信息行（HTML，与 Canvas 行对齐） -->
        <div
          v-for="node in visibleNodes" :key="node.hash"
          class="absolute flex items-center gap-1.5 pr-3 cursor-pointer hover:bg-accent/30 w-full"
          :style="{
            top: node.row * ROW_HEIGHT * scale + 'px',
            height: ROW_HEIGHT * scale + 'px',
            paddingLeft: (graphWidth + TEXT_PADDING_LEFT) * scale + 'px',
          }"
        >
          <!-- Ref 标签 -->
          <span
            v-for="r in node.refs" :key="r.name"
            class="inline-flex items-center px-1 py-0 rounded border text-[10px] leading-tight shrink-0"
            :class="refBadgeClass(r)"
          >
            {{ r.name }}
          </span>

          <!-- 提交消息 -->
          <span class="truncate text-xs" :style="{ fontSize: 12 * scale + 'px' }">{{ node.message }}</span>

          <div class="ml-auto flex items-center gap-2 shrink-0">
            <span class="font-mono text-[10px] text-primary/70" :style="{ fontSize: 10 * scale + 'px' }">{{ node.shortHash }}</span>
            <span class="text-[10px] text-muted-foreground" :style="{ fontSize: 10 * scale + 'px' }">{{ node.author }}</span>
            <span class="text-[10px] text-muted-foreground" :style="{ fontSize: 10 * scale + 'px' }">{{ formatTime(node.timestamp) }}</span>
          </div>
        </div>

        <!-- 加载更多指示器 -->
        <div
          v-if="loading && graph.nodes.length > 0"
          class="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 text-xs text-muted-foreground"
          :style="{ top: totalHeight + 'px' }"
        >
          <Loader2 class="h-3.5 w-3.5 animate-spin" /> {{ t('git.loadingMore') }}
        </div>
      </div>

      <!-- 无数据 -->
      <div v-else class="flex items-center justify-center py-12 text-xs text-muted-foreground">
        {{ t('git.noCommits') }}
      </div>
    </div>

    <!-- Hover 提示 -->
    <Teleport to="body">
      <div
        v-if="hoverNode"
        class="fixed z-50 max-w-xs rounded-md border border-border bg-popover p-2 shadow-md pointer-events-none"
        :style="{
          left: hoverPos.x + 12 + 'px',
          top: hoverPos.y + 12 + 'px',
        }"
      >
        <div class="text-xs font-medium truncate">{{ hoverNode.message }}</div>
        <div class="text-xs text-muted-foreground mt-0.5">
          <span class="font-mono text-primary">{{ hoverNode.shortHash }}</span>
          · {{ hoverNode.author }}
          · {{ formatTime(hoverNode.timestamp) }}
        </div>
        <div v-if="hoverNode.refs.length" class="flex flex-wrap gap-0.5 mt-1">
          <span
            v-for="r in hoverNode.refs" :key="r.name"
            class="inline-flex items-center px-1 rounded border text-[10px]"
            :class="refBadgeClass(r)"
          >
            {{ r.name }}
          </span>
        </div>
      </div>
    </Teleport>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextNode"
        class="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-md"
        :style="{ left: contextPos.x + 'px', top: contextPos.y + 'px' }"
      >
        <button
          class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="emit('viewCommitDiff', contextNode!.hash)"
        >
          {{ t('git.viewDiff') }}
        </button>
        <button
          class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="emit('cherryPick', contextNode!.hash)"
        >
          {{ t('git.cherryPick') }}
        </button>
        <button
          class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="emit('createBranch', contextNode!.hash)"
        >
          {{ t('git.createBranchHere') }}
        </button>
        <button
          class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="emit('createTag', contextNode!.hash)"
        >
          {{ t('git.createTagHere') }}
        </button>
        <div class="h-px bg-border my-1" />
        <button
          class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="copyText(contextNode!.hash)"
        >
          {{ t('git.copyHash') }}
        </button>
        <button
          class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          @click="copyText(contextNode!.message)"
        >
          {{ t('git.copyMessage') }}
        </button>
      </div>
    </Teleport>
  </div>
</template>
