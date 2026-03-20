<script setup lang="ts">
/**
 * 可编辑建模画布 — 建模模式核心视图
 *
 * 集成 Vue Flow 画布、工具栏、列编辑侧边栏和 DDL 预览对话框。
 * 支持双击添加表、拖拽连线创建外键、快捷键撤销/重做等交互。
 */
import { ref, computed, watch, markRaw, onMounted, onBeforeUnmount } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import { Controls } from '@vue-flow/controls'
import { save, open } from '@tauri-apps/plugin-dialog'
import ErEditableTableNode from './ErEditableTableNode.vue'
import ErRelationEdge from './ErRelationEdge.vue'
import ModelToolbar from './ModelToolbar.vue'
import TableColumnEditor from './TableColumnEditor.vue'
import DdlPreviewDialog from './DdlPreviewDialog.vue'
import { useErModeling } from '@/composables/useErModeling'

const props = defineProps<{
  /** 连接 ID（用于从数据库导入） */
  connectionId: string
  /** 数据库名 */
  database: string
}>()

const {
  project,
  dirty,
  currentFilePath,
  selectedTableId,
  selectedTable,
  canUndo,
  canRedo,
  undo,
  redo,
  addTable,
  updateTable,
  updateTablePosition,
  removeTable,
  addColumn,
  updateColumn,
  removeColumn,
  addRelation,
  removeRelation,
  newProject,
  saveModel,
  loadModel,
  importFromDatabase,
  toVueFlowNodes,
  toVueFlowEdges,
  autoLayout,
} = useErModeling()

const { fitView } = useVueFlow()

/** 自定义节点类型 */
const nodeTypes = {
  erEditable: markRaw(ErEditableTableNode),
} as any

/** 自定义边类型 */
const edgeTypes = {
  erRelation: markRaw(ErRelationEdge),
} as any

/** 列编辑器是否打开 */
const columnEditorOpen = ref(false)
/** DDL 预览是否打开 */
const ddlPreviewOpen = ref(false)
/** 导入中 */
const importing = ref(false)

/** Vue Flow 节点 & 边 */
const nodes = ref<any[]>([])
const edges = ref<any[]>([])

/** 同步 project → Vue Flow */
function syncFlowData() {
  nodes.value = toVueFlowNodes()
  edges.value = toVueFlowEdges()
}

// 监听 project 变化，自动同步
watch(
  () => JSON.stringify(project.value),
  () => syncFlowData(),
  { immediate: true },
)

// 监听选中表变化，刷新节点高亮
watch(selectedTableId, () => syncFlowData())

// ============ 画布事件 ============

/** 双击画布空白处 → 添加新表 */
function handlePaneDoubleClick(event: { event: MouseEvent }) {
  // 通过 Vue Flow 的 project 方法将屏幕坐标转换为画布坐标
  const name = prompt('请输入表名：')
  if (!name?.trim()) return
  const rect = (event.event.target as HTMLElement)?.closest('.vue-flow')?.getBoundingClientRect()
  const x = event.event.clientX - (rect?.left ?? 0)
  const y = event.event.clientY - (rect?.top ?? 0)
  addTable(name.trim(), { x, y })
}

/** 节点拖拽结束 → 更新位置 */
function handleNodesChange(changes: any[]) {
  for (const change of changes) {
    if (change.type === 'position' && change.position && change.dragging === false) {
      updateTablePosition(change.id, change.position)
    }
    // 拖拽中也要实时更新节点位置
    if (change.type === 'position' && change.position) {
      nodes.value = nodes.value.map((n: any) =>
        n.id === change.id ? { ...n, position: change.position } : n,
      )
    }
  }
}

/** 连线完成 → 创建外键关系 */
function handleConnect(params: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) {
  if (params.source === params.target) return

  // 默认取源表第一个非主键列 → 目标表主键列
  const sourceTable = project.value.tables.find(t => t.id === params.source)
  const targetTable = project.value.tables.find(t => t.id === params.target)
  if (!sourceTable || !targetTable) return

  const targetPk = targetTable.columns.find(c => c.isPrimaryKey)
  // 先查找源表中与目标表同名的列（如 user_id → users.id 模式），否则取第一列
  const sourceCol = sourceTable.columns.find(c => !c.isPrimaryKey) ?? sourceTable.columns[0]
  const targetCol = targetPk ?? targetTable.columns[0]

  if (!sourceCol || !targetCol) return

  addRelation({
    sourceTableId: params.source,
    sourceColumnId: sourceCol.id,
    targetTableId: params.target,
    targetColumnId: targetCol.id,
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
}

/** 删除选中的节点或边 */
function handleDelete() {
  // 检查是否有选中的边
  const selectedEdges = edges.value.filter((e: any) => e.selected)
  for (const edge of selectedEdges) {
    removeRelation(edge.id)
  }
  // 检查选中的节点
  const selectedNodes = nodes.value.filter((n: any) => n.selected)
  for (const node of selectedNodes) {
    if (confirm(`确定删除表「${project.value.tables.find(t => t.id === node.id)?.name}」？`)) {
      removeTable(node.id)
    }
  }
}

// ============ 工具栏操作 ============

async function handleNewProject() {
  if (dirty.value) {
    const confirmed = confirm('有未保存的变更，确定新建项目？当前变更将丢失。')
    if (!confirmed) return
  }
  const name = prompt('请输入项目名称：', '未命名项目')
  if (!name?.trim()) return
  newProject(name.trim())
}

async function handleOpenModel() {
  const filePath = await open({
    title: '打开建模文件',
    filters: [{ name: 'DevForge Model', extensions: ['dfmodel'] }],
    multiple: false,
  })
  if (!filePath) return
  try {
    await loadModel(filePath as string)
  } catch (e) {
    alert(`打开文件失败: ${e}`)
  }
}

async function handleSaveModel() {
  let path = currentFilePath.value
  if (!path) {
    const selected = await save({
      title: '保存建模文件',
      defaultPath: `${project.value.name}.dfmodel`,
      filters: [{ name: 'DevForge Model', extensions: ['dfmodel'] }],
    })
    if (!selected) return
    path = selected
  }
  try {
    await saveModel(path)
  } catch (e) {
    alert(`保存失败: ${e}`)
  }
}

function handleAddTable() {
  const name = prompt('请输入表名：')
  if (!name?.trim()) return
  // 在画布中心偏移位置放置
  const tableCount = project.value.tables.length
  addTable(name.trim(), {
    x: 100 + (tableCount % 4) * 280,
    y: 100 + Math.floor(tableCount / 4) * 300,
  })
}

function handleAutoLayout() {
  autoLayout()
  // 布局完成后适应视图
  setTimeout(() => fitView({ duration: 300, padding: 0.2 }), 100)
}

async function handleImportFromDb() {
  if (dirty.value) {
    const confirmed = confirm('导入将替换当前项目内容，确定继续？')
    if (!confirmed) return
  }
  importing.value = true
  try {
    await importFromDatabase(props.connectionId, props.database)
    handleAutoLayout()
  } catch (e) {
    alert(`导入失败: ${e}`)
  } finally {
    importing.value = false
  }
}

// ============ 键盘快捷键 ============

function handleKeyDown(e: KeyboardEvent) {
  // Ctrl+Z 撤销
  if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
    e.preventDefault()
    undo()
  }
  // Ctrl+Y 或 Ctrl+Shift+Z 重做
  if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
    e.preventDefault()
    redo()
  }
  // Delete 删除选中
  if (e.key === 'Delete') {
    handleDelete()
  }
  // Ctrl+S 保存
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault()
    handleSaveModel()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown)
})

/** 统计信息 */
const tableCount = computed(() => project.value.tables.length)
const relationCount = computed(() => project.value.relations.length)
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 工具栏 -->
    <ModelToolbar
      :project-name="project.name"
      :dirty="dirty"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :file-path="currentFilePath"
      @new-project="handleNewProject"
      @open-model="handleOpenModel"
      @save-model="handleSaveModel"
      @add-table="handleAddTable"
      @undo="undo"
      @redo="redo"
      @auto-layout="handleAutoLayout"
      @generate-ddl="ddlPreviewOpen = true"
      @import-from-db="handleImportFromDb"
    />

    <!-- 画布 -->
    <div class="flex-1 min-h-0 relative">
      <VueFlow
        :nodes="nodes"
        :edges="edges"
        :node-types="nodeTypes"
        :edge-types="edgeTypes"
        :min-zoom="0.1"
        :max-zoom="3"
        :default-viewport="{ zoom: 0.8, x: 50, y: 50 }"
        :snap-to-grid="true"
        :snap-grid="[10, 10]"
        :connect-on-click="false"
        fit-view-on-init
        class="h-full w-full bg-background"
        @nodes-change="handleNodesChange"
        @connect="handleConnect"
        @pane-click="() => { selectedTableId = null }"
        @double-click="handlePaneDoubleClick"
      >
        <MiniMap
          pannable
          zoomable
          class="!bg-muted/30 !border-border"
        />
        <Controls class="!bg-background !border-border" />
      </VueFlow>

      <!-- 空画布提示 -->
      <div
        v-if="tableCount === 0 && !importing"
        class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-2"
      >
        <p class="text-sm text-muted-foreground/50">双击画布添加表，或使用工具栏操作</p>
        <p class="text-xs text-muted-foreground/30">支持从现有数据库导入</p>
      </div>

      <!-- 导入中遮罩 -->
      <div
        v-if="importing"
        class="absolute inset-0 flex items-center justify-center bg-background/50 z-10"
      >
        <p class="text-sm text-muted-foreground">正在从数据库导入...</p>
      </div>
    </div>

    <!-- 底部状态栏 -->
    <div class="flex items-center gap-3 border-t border-border bg-muted/20 px-3 py-1 text-[10px] text-muted-foreground shrink-0">
      <span>{{ tableCount }} 张表</span>
      <span>{{ relationCount }} 条关系</span>
      <span v-if="currentFilePath" class="truncate max-w-[300px]" :title="currentFilePath">{{ currentFilePath }}</span>
      <span v-else>未保存</span>
      <span class="ml-auto">建模模式</span>
    </div>

    <!-- 列编辑器 -->
    <TableColumnEditor
      v-model:open="columnEditorOpen"
      :table="selectedTable"
      @update-table="(id, partial) => updateTable(id, partial)"
      @update-column="(tid, cid, partial) => updateColumn(tid, cid, partial)"
      @add-column="(tid) => addColumn(tid)"
      @remove-column="(tid, cid) => removeColumn(tid, cid)"
    />

    <!-- DDL 预览 -->
    <DdlPreviewDialog
      v-model:open="ddlPreviewOpen"
      :project="project"
    />
  </div>
</template>

<style>
/* Vue Flow 必需的样式（与只读模式共享） */
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
@import '@vue-flow/minimap/dist/style.css';
@import '@vue-flow/controls/dist/style.css';
</style>
