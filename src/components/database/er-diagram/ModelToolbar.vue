<script setup lang="ts">
/**
 * 建模工具栏
 *
 * 提供新建/打开/保存模型、添加表、撤销/重做、自动布局、
 * 生成 DDL 和从数据库导入等按钮。
 */
import {
  FilePlus,
  FolderOpen,
  Save,
  Plus,
  Undo2,
  Redo2,
  LayoutGrid,
  Code,
  Database,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

defineProps<{
  /** 项目名称 */
  projectName: string
  /** 是否有未保存变更 */
  dirty: boolean
  /** 能否撤销 */
  canUndo: boolean
  /** 能否重做 */
  canRedo: boolean
  /** 当前文件路径 */
  filePath: string | null
}>()

const emit = defineEmits<{
  newProject: []
  openModel: []
  saveModel: []
  addTable: []
  undo: []
  redo: []
  autoLayout: []
  generateDdl: []
  importFromDb: []
}>()
</script>

<template>
  <div class="flex items-center gap-1 border-b border-border bg-muted/20 px-3 py-1.5 shrink-0">
    <!-- 项目信息 -->
    <span class="text-xs font-medium text-foreground truncate max-w-[160px]" :title="projectName">
      {{ projectName }}
    </span>
    <span v-if="dirty" class="text-xs text-df-warning" title="有未保存的变更">*</span>

    <Separator orientation="vertical" class="mx-1.5 h-4" />

    <!-- 文件操作 -->
    <Button
      variant="ghost"
      size="sm"
      class="h-6 gap-1 text-[10px] px-2"
      title="新建项目"
      @click="emit('newProject')"
    >
      <FilePlus class="h-3 w-3" />
      新建
    </Button>
    <Button
      variant="ghost"
      size="sm"
      class="h-6 gap-1 text-[10px] px-2"
      title="打开模型文件"
      @click="emit('openModel')"
    >
      <FolderOpen class="h-3 w-3" />
      打开
    </Button>
    <Button
      variant="ghost"
      size="sm"
      class="h-6 gap-1 text-[10px] px-2"
      title="保存模型"
      @click="emit('saveModel')"
    >
      <Save class="h-3 w-3" />
      保存
    </Button>

    <Separator orientation="vertical" class="mx-1.5 h-4" />

    <!-- 编辑操作 -->
    <Button
      variant="ghost"
      size="sm"
      class="h-6 gap-1 text-[10px] px-2"
      title="添加新表"
      @click="emit('addTable')"
    >
      <Plus class="h-3 w-3" />
      添加表
    </Button>
    <Button
      variant="ghost"
      size="sm"
      class="h-6 w-6 p-0"
      title="撤销 (Ctrl+Z)"
      :disabled="!canUndo"
      @click="emit('undo')"
    >
      <Undo2 class="h-3 w-3" />
    </Button>
    <Button
      variant="ghost"
      size="sm"
      class="h-6 w-6 p-0"
      title="重做 (Ctrl+Y)"
      :disabled="!canRedo"
      @click="emit('redo')"
    >
      <Redo2 class="h-3 w-3" />
    </Button>

    <Separator orientation="vertical" class="mx-1.5 h-4" />

    <!-- 布局与导出 -->
    <Button
      variant="ghost"
      size="sm"
      class="h-6 gap-1 text-[10px] px-2"
      title="自动布局"
      @click="emit('autoLayout')"
    >
      <LayoutGrid class="h-3 w-3" />
      自动布局
    </Button>
    <Button
      variant="ghost"
      size="sm"
      class="h-6 gap-1 text-[10px] px-2"
      title="生成 DDL"
      @click="emit('generateDdl')"
    >
      <Code class="h-3 w-3" />
      生成 DDL
    </Button>
    <Button
      variant="ghost"
      size="sm"
      class="h-6 gap-1 text-[10px] px-2"
      title="从数据库导入"
      @click="emit('importFromDb')"
    >
      <Database class="h-3 w-3" />
      从数据库导入
    </Button>
  </div>
</template>
