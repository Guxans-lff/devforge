<script setup lang="ts">
/**
 * 表编辑器面板（编排层）
 * 使用 useTableEditor composable 管理业务逻辑，委托子组件渲染各 Tab 内容
 */
import { ref, computed, onMounted, onUnmounted, nextTick, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Plus, X, Loader2, Code, Play, ChevronRight, Table2, Key, FileCode,
  Columns3, Copy, Check, Link2, Search, Trash2, Zap,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { useTableEditor } from '@/composables/useTableEditor'
import { FIELD_TEMPLATES } from '@/types/table-editor-constants'
import ColumnEditor from './table-editor/ColumnEditor.vue'
import IndexEditor from './table-editor/IndexEditor.vue'
import ForeignKeyEditor from './table-editor/ForeignKeyEditor.vue'
import TriggerEditor from './table-editor/TriggerEditor.vue'

const props = defineProps<{
  connectionId: string
  database: string
  driver: string
  table?: string
}>()

const emit = defineEmits<{ success: [] }>()

const { t } = useI18n()
const columnsScrollRef = ref<HTMLElement>()
const contextMenuRef = ref<HTMLElement>()

// — 核心 composable —
const editor = useTableEditor({
  connectionId: toRef(props, 'connectionId'),
  database: toRef(props, 'database'),
  driver: toRef(props, 'driver'),
  table: toRef(props, 'table'),
  columnsScrollRef,
  onSuccess: () => emit('success'),
})

// ===== Tab 定义 =====
const tabs = computed(() => [
  { key: 'columns', label: t('tableEditor.tabFields'), icon: Columns3, count: editor.columns.value.length },
  { key: 'indexes', label: t('tableEditor.tabIndexes'), icon: Key, count: editor.indexes.value.length },
  { key: 'foreignKeys', label: t('tableEditor.tabForeignKeys'), icon: Link2, count: editor.foreignKeys.value.length },
  { key: 'triggers', label: t('tableEditor.tabTriggers'), icon: Zap, count: editor.triggers.value.length },
  ...(editor.isAlterMode.value ? [{ key: 'ddl', label: 'DDL', icon: FileCode, count: 0 }] : []),
])

// ===== 字段模板下拉 =====
const showFieldTemplates = ref(false)

// ===== 右键菜单键盘导航 =====
function handleContextMenuKeydown(e: KeyboardEvent) {
  const menu = contextMenuRef.value
  if (!menu) return
  const items = menu.querySelectorAll<HTMLElement>('[role="menuitem"]')
  if (items.length === 0) return
  const active = menu.querySelector<HTMLElement>('[role="menuitem"]:focus')
  const idx = active ? Array.from(items).indexOf(active) : -1

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const next = idx < items.length - 1 ? idx + 1 : 0
    items[next]?.focus()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    const prev = idx > 0 ? idx - 1 : items.length - 1
    items[prev]?.focus()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    editor.closeContextMenu()
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    active?.click()
  }
}

// 右键菜单打开时自动聚焦第一项
watch(() => editor.showContextMenu.value, async (show) => {
  if (show) {
    await nextTick()
    contextMenuRef.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }
})

// ===== 字符集选项（动态：包含 API 返回的当前值 + 预设列表）=====
const CHARSET_PRESETS = ['utf8mb4', 'utf8', 'utf8mb3', 'latin1', 'gbk', 'gb2312']
const charsetOptions = computed(() => {
  const current = editor.tableCharset.value
  if (current && !CHARSET_PRESETS.includes(current)) {
    return [current, ...CHARSET_PRESETS]
  }
  return CHARSET_PRESETS
})

// ===== 添加字段并滚动到底部 =====
async function handleAddColumn() {
  editor.addColumn()
  await nextTick()
  const el = columnsScrollRef.value
  if (el) el.scrollTop = el.scrollHeight
}

// ===== 添加按钮路由（根据当前 Tab 调用不同的添加函数）=====
function handleAdd() {
  switch (editor.activeTab.value) {
    case 'columns': handleAddColumn(); break
    case 'indexes': editor.addIndex(); break
    case 'foreignKeys': editor.addForeignKey(); break
    case 'triggers': editor.addTrigger(); break
  }
}

// ===== 字段模板插入 =====
async function handleInsertTemplate(tpl: (typeof FIELD_TEMPLATES)[number]) {
  if (editor.insertTemplate(tpl)) {
    showFieldTemplates.value = false
    await nextTick()
    const el = columnsScrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  }
}

// ===== 键盘快捷键 =====
function handleGlobalKeydown(e: KeyboardEvent) {
  editor.handleKeydown(e)
}

// ===== 关闭弹出层（点击外部关闭类型下拉、索引列下拉） =====
function onGlobalClick(e: MouseEvent) {
  // 关闭类型搜索下拉
  if (editor.typeDropdownIdx.value !== null) {
    const target = e.target as HTMLElement
    if (!target.closest('.type-search-input') && !target.closest('[class*="bg-popover"]')) {
      editor.typeDropdownIdx.value = null
    }
  }
  // 关闭索引列下拉
  if (editor.indexColumnDropdown.value !== null) {
    const target = e.target as HTMLElement
    if (!target.closest('[class*="bg-popover"]')) {
      editor.indexColumnDropdown.value = null
    }
  }
  // 关闭右键菜单
  if (editor.showContextMenu.value) {
    editor.closeContextMenu()
  }
  // 关闭字段模板下拉
  if (showFieldTemplates.value) {
    const target = e.target as HTMLElement
    if (!target.closest('[data-field-templates]')) {
      showFieldTemplates.value = false
    }
  }
}

// ===== 生命周期 =====
onMounted(async () => {
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('click', onGlobalClick, true)
  if (editor.isAlterMode.value) {
    await editor.loadTableDetail()
  } else {
    editor.initCreateMode()
  }
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('click', onGlobalClick, true)
})
</script>

<template>
  <div class="flex flex-col h-full bg-background text-foreground">
    <!-- ===== 顶部工具栏 ===== -->
    <div class="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-background shrink-0">
      <!-- 左侧：添加、快速字段、过滤、批量删除 -->
      <Button
        v-if="editor.activeTab.value !== 'ddl'"
        variant="ghost" size="sm"
        class="h-6 px-2 text-xs gap-1"
        @click="handleAdd"
      >
        <Plus class="size-3" />
        {{ t('tableEditor.add') }}
      </Button>

      <!-- 字段模板（仅在 columns tab 显示） -->
      <div v-if="editor.activeTab.value === 'columns'" class="relative" data-field-templates>
        <Button variant="ghost" size="sm" class="h-6 px-2 text-xs" @click.stop="showFieldTemplates = !showFieldTemplates">
          {{ t('tableEditor.quickField') }}
        </Button>
        <div v-if="showFieldTemplates" role="menu" class="absolute left-0 top-7 z-30 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[140px]">
          <button
            v-for="tpl in FIELD_TEMPLATES" :key="tpl.label"
            role="menuitem"
            class="w-full px-3 py-1.5 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none"
            @click="handleInsertTemplate(tpl)"
          >
            {{ tpl.label }}
          </button>
        </div>
      </div>

      <!-- 批量删除 -->
      <Button
        v-if="editor.activeTab.value === 'columns' && editor.selectedRows.value.size > 0"
        variant="ghost" size="sm"
        class="h-6 px-2 text-xs gap-1 text-destructive hover:text-destructive"
        @click="editor.batchDelete"
      >
        <Trash2 class="size-3" />
        {{ t('tableEditor.deleteCount', { count: editor.selectedRows.value.size }) }}
      </Button>

      <div class="flex-1" />

      <!-- 右侧：过滤、撤销/重做、预览/执行 -->
      <!-- 字段过滤（仅在 columns tab 显示） -->
      <div v-if="editor.activeTab.value === 'columns'" class="relative">
        <Search class="absolute left-1.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
        <Input
          v-model="editor.columnFilter.value"
          class="h-6 w-32 pl-6 text-xs"
          :placeholder="t('tableEditor.filterFields')"
        />
      </div>

      <!-- 撤销/重做 -->
      <div class="flex items-center gap-0.5 border-l border-border pl-1.5 ml-1">
        <Button variant="ghost" size="sm" class="h-6 w-6 p-0" :disabled="editor.undoStack.value.length === 0" :title="t('tableEditor.undoShortcut')" :aria-label="t('tableEditor.undo')" @click="editor.undo">
          ↩
        </Button>
        <Button variant="ghost" size="sm" class="h-6 w-6 p-0" :disabled="editor.redoStack.value.length === 0" :title="t('tableEditor.redoShortcut')" :aria-label="t('tableEditor.redo')" @click="editor.redo">
          ↪
        </Button>
      </div>

      <!-- 预览 / 执行 -->
      <div class="flex items-center gap-1 border-l border-border pl-1.5 ml-1">
        <Button
          variant="outline" size="sm"
          class="h-6 px-2 text-xs gap-1"
          :disabled="editor.loading.value || editor.executing.value"
          @click="editor.previewSql"
        >
          <Code class="size-3" />
          {{ t('tableEditor.previewSQL') }}
        </Button>
        <Button
          size="sm"
          class="h-6 px-2 text-xs gap-1"
          :disabled="editor.loading.value || editor.executing.value"
          @click="editor.handleExecuteSql"
        >
          <Loader2 v-if="editor.executing.value" class="size-3 animate-spin" />
          <Play v-else class="size-3" />
          {{ editor.isAlterMode.value ? t('tableEditor.alterTable') : t('tableEditor.createTable') }}
        </Button>
      </div>
    </div>

    <!-- ===== 表属性区域（可折叠） ===== -->
    <div class="border-b border-border shrink-0">
      <button
        class="w-full flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        @click="editor.metaCollapsed.value = !editor.metaCollapsed.value"
      >
        <ChevronRight class="size-3 transition-transform duration-150" :class="editor.metaCollapsed.value ? '' : 'rotate-90'" />
        <Table2 class="size-3" />
        {{ t('tableEditor.tableProperties') }}
      </button>
      <div v-if="!editor.metaCollapsed.value" class="px-3 pb-2 grid grid-cols-[auto_1fr_auto_1fr] gap-x-2 gap-y-1.5 items-center text-xs">
        <label for="te-table-name" class="text-muted-foreground whitespace-nowrap">{{ t('tableEditor.labelTableName') }}</label>
        <Input id="te-table-name" v-model="editor.tableName.value" class="h-6 text-xs font-mono" placeholder="table_name" />
        <label for="te-table-comment" class="text-muted-foreground whitespace-nowrap">{{ t('tableEditor.labelComment') }}</label>
        <Input id="te-table-comment" v-model="editor.tableComment.value" class="h-6 text-xs" :placeholder="t('tableEditor.placeholderOptional')" />
        <template v-if="editor.isMysql.value">
          <label for="te-table-engine" class="text-muted-foreground whitespace-nowrap">{{ t('tableEditor.labelEngine') }}</label>
          <Select v-model="editor.tableEngine.value">
            <SelectTrigger id="te-table-engine" class="h-6 text-xs w-full"><SelectValue :placeholder="t('tableEditor.labelEngine')" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="e in ['InnoDB', 'MyISAM', 'MEMORY', 'ARCHIVE']" :key="e" :value="e" class="text-xs">{{ e }}</SelectItem>
            </SelectContent>
          </Select>
          <label for="te-table-charset" class="text-muted-foreground whitespace-nowrap">{{ t('tableEditor.labelCharset') }}</label>
          <Select v-model="editor.tableCharset.value">
            <SelectTrigger id="te-table-charset" class="h-6 text-xs w-full"><SelectValue :placeholder="t('tableEditor.labelCharset')" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="c in charsetOptions" :key="c" :value="c" class="text-xs">{{ c }}</SelectItem>
            </SelectContent>
          </Select>
        </template>
      </div>
    </div>

    <!-- ===== Tab 栏 ===== -->
    <div class="flex items-center gap-0 border-b border-border bg-muted/20 shrink-0 px-1">
      <button
        v-for="tab in tabs" :key="tab.key"
        class="flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors relative"
        :class="editor.activeTab.value === tab.key
          ? 'text-foreground font-medium after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-primary after:rounded-full'
          : 'text-muted-foreground hover:text-foreground/80'"
        @click="tab.key === 'ddl' ? editor.showDdlInfo() : (editor.activeTab.value = tab.key)"
      >
        <component :is="tab.icon" class="size-3" />
        {{ tab.label }}
        <span v-if="tab.count > 0" class="text-[10px] text-muted-foreground/60 tabular-nums">({{ tab.count }})</span>
      </button>
    </div>

    <!-- ===== Tab 内容区 ===== -->
    <div class="flex-1 min-h-0 flex flex-col">
      <!-- 字段 Tab -->
      <div v-if="editor.activeTab.value === 'columns'" ref="columnsScrollRef" class="flex-1 min-h-0 overflow-auto">
        <ColumnEditor
          :columns="editor.columns.value"
          :filtered-column-indices="editor.filteredColumnIndices.value"
          :selected-row-idx="editor.selectedRowIdx.value"
          :selected-rows="editor.selectedRows.value"
          :all-selected="editor.allSelected.value"
          :is-mysql="editor.isMysql.value"
          :is-alter-mode="editor.isAlterMode.value"
          :original-columns="editor.originalColumns.value"
          :drag-idx="editor.dragIdx.value"
          :drag-over-idx="editor.dragOverIdx.value"
          :type-dropdown-idx="editor.typeDropdownIdx.value"
          :type-search-query="editor.typeSearchQuery.value"
          :filtered-types="editor.filteredTypes.value"
          :loading="editor.loading.value"
          :validation-errors="editor.validationErrors.value"
          @select-row="(idx) => editor.selectedRowIdx.value = idx"
          @toggle-row-select="editor.toggleRowSelect"
          @toggle-select-all="editor.toggleSelectAll"
          @update-column="editor.updateColumn"
          @remove-column="editor.removeColumn"
          @open-type-dropdown="editor.openTypeDropdown"
          @close-type-dropdown="() => editor.typeDropdownIdx.value = null"
          @update:type-search-query="(v) => editor.typeSearchQuery.value = v"
          @on-grip-mouse-down="editor.onGripMouseDown"
          @contextmenu="editor.onColumnContextMenu"
        />
      </div>

      <!-- 索引 Tab -->
      <IndexEditor
        v-else-if="editor.activeTab.value === 'indexes'"
        :indexes="editor.indexes.value"
        :column-names="editor.columnNames.value"
        :index-column-dropdown="editor.indexColumnDropdown.value"
        :loading="editor.loading.value"
        @update-index="editor.updateIndex"
        @remove-index="editor.removeIndex"
        @toggle-index-column="editor.toggleIndexColumn"
        @update:index-column-dropdown="(v) => editor.indexColumnDropdown.value = v"
      />

      <!-- 外键 Tab -->
      <ForeignKeyEditor
        v-else-if="editor.activeTab.value === 'foreignKeys'"
        :foreign-keys="editor.foreignKeys.value"
        @update-foreign-key="editor.updateForeignKey"
        @remove-foreign-key="editor.removeForeignKey"
      />

      <!-- 触发器 Tab -->
      <TriggerEditor
        v-else-if="editor.activeTab.value === 'triggers'"
        :triggers="editor.triggers.value"
        @update-trigger="editor.updateTrigger"
        @remove-trigger="editor.removeTrigger"
      />

      <!-- DDL Tab -->
      <div v-else-if="editor.activeTab.value === 'ddl'" class="flex-1 min-h-0 flex flex-col p-3">
        <div v-if="editor.ddlLoading.value" class="flex-1 flex items-center justify-center">
          <Loader2 class="size-5 animate-spin text-muted-foreground" />
        </div>
        <template v-else>
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-muted-foreground">{{ t('tableEditor.ddlStatement') }}</span>
            <Button variant="ghost" size="sm" class="h-6 px-2 text-xs gap-1" @click="editor.copyToClipboard(editor.ddlContent.value, 'ddl')">
              <Check v-if="editor.ddlCopied.value" class="size-3 text-df-success" />
              <Copy v-else class="size-3" />
              {{ editor.ddlCopied.value ? t('tableEditor.copied') : t('tableEditor.copy') }}
            </Button>
          </div>
          <pre class="flex-1 min-h-0 overflow-auto p-3 text-xs font-mono bg-muted/30 border border-border rounded-md whitespace-pre-wrap break-all" v-html="editor.highlightSql(editor.ddlContent.value)" />
        </template>
      </div>
    </div>

    <!-- ===== SQL 预览面板 ===== -->
    <div v-if="editor.showSqlPreview.value" class="border-t border-border shrink-0">
      <div class="flex items-center justify-between px-3 py-1 bg-muted/50">
        <span class="text-xs text-muted-foreground">{{ t('tableEditor.sqlPreview') }}</span>
        <div class="flex items-center gap-1">
          <Button variant="ghost" size="sm" class="h-5 px-1.5 text-[10px] gap-1" @click="editor.copyToClipboard(editor.generatedSql.value, 'sql')">
            <Check v-if="editor.sqlCopied.value" class="size-3 text-df-success" />
            <Copy v-else class="size-3" />
          </Button>
          <Button variant="ghost" size="sm" class="h-5 w-5 p-0" @click="editor.showSqlPreview.value = false">
            <X class="size-3" />
          </Button>
        </div>
      </div>
      <pre class="max-h-40 overflow-auto px-3 py-2 text-xs font-mono bg-muted/30 text-foreground whitespace-pre-wrap break-all" v-html="editor.highlightSql(editor.generatedSql.value)" />
    </div>

    <!-- ===== 底部状态栏 ===== -->
    <div class="flex items-center justify-between px-3 py-1 border-t border-border bg-muted/20 text-[10px] text-muted-foreground shrink-0">
      <div class="flex items-center gap-3">
        <span>{{ t('tableEditor.fieldCount', { count: editor.columns.value.length }) }}</span>
        <span>{{ t('tableEditor.indexCount', { count: editor.indexes.value.length }) }}</span>
        <span>{{ t('tableEditor.fkCount', { count: editor.foreignKeys.value.length }) }}</span>
        <template v-if="editor.isAlterMode.value">
          <span class="text-df-success" v-if="editor.changeStats.value.added > 0">+{{ editor.changeStats.value.added }}</span>
          <span class="text-df-warning" v-if="editor.changeStats.value.modified > 0">~{{ editor.changeStats.value.modified }}</span>
          <span class="text-destructive" v-if="editor.changeStats.value.deleted > 0">-{{ editor.changeStats.value.deleted }}</span>
        </template>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="editor.validationErrors.value.length > 0" class="text-destructive">{{ t('tableEditor.errorCount', { count: editor.validationErrors.value.length }) }}</span>
        <span class="text-muted-foreground/50">
          {{ editor.isAlterMode.value ? t('tableEditor.alterTable') : t('tableEditor.createTable') }} · {{ driver }}
        </span>
      </div>
    </div>

    <!-- ===== 右键菜单（Teleport 到 body） ===== -->
    <Teleport to="body">
      <div
        v-if="editor.showContextMenu.value"
        ref="contextMenuRef"
        role="menu"
        class="fixed z-[9999] bg-popover border border-border rounded-md shadow-lg py-1 min-w-[160px] text-xs"
        :style="{ left: editor.contextMenuPos.value.x + 'px', top: editor.contextMenuPos.value.y + 'px' }"
        @keydown="handleContextMenuKeydown"
      >
        <button role="menuitem" tabindex="-1" class="w-full px-3 py-1.5 text-left hover:bg-accent focus:bg-accent focus:outline-none flex items-center gap-2" @click="editor.contextInsertAbove">
          <span class="w-4 text-center text-muted-foreground/50">↑</span>
          {{ t('tableEditor.insertAbove') }}
        </button>
        <button role="menuitem" tabindex="-1" class="w-full px-3 py-1.5 text-left hover:bg-accent focus:bg-accent focus:outline-none flex items-center gap-2" @click="editor.contextInsertBelow">
          <span class="w-4 text-center text-muted-foreground/50">↓</span>
          {{ t('tableEditor.insertBelow') }}
        </button>
        <div role="separator" class="my-1 border-t border-border" />
        <button role="menuitem" tabindex="-1" class="w-full px-3 py-1.5 text-left hover:bg-accent focus:bg-accent focus:outline-none flex items-center gap-2" @click="editor.contextDuplicate">
          <Copy class="size-3 text-muted-foreground/50" />
          {{ t('tableEditor.duplicateField') }}
        </button>
        <button role="menuitem" tabindex="-1" class="w-full px-3 py-1.5 text-left hover:bg-accent focus:bg-accent focus:outline-none flex items-center gap-2" @click="editor.contextTogglePK">
          <Key class="size-3 text-muted-foreground/50" />
          {{ t('tableEditor.togglePrimaryKey') }}
        </button>
        <button role="menuitem" tabindex="-1" class="w-full px-3 py-1.5 text-left hover:bg-accent focus:bg-accent focus:outline-none flex items-center gap-2" @click="editor.contextCopyName">
          <Copy class="size-3 text-muted-foreground/50" />
          {{ t('tableEditor.copyFieldName') }}
        </button>
        <div role="separator" class="my-1 border-t border-border" />
        <button role="menuitem" tabindex="-1" class="w-full px-3 py-1.5 text-left hover:bg-accent focus:bg-accent focus:outline-none flex items-center gap-2 text-destructive" @click="editor.contextDelete">
          <X class="size-3" />
          {{ t('tableEditor.deleteField') }}
        </button>
      </div>
    </Teleport>
  </div>
</template>
