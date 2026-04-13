<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Search, Plus, Pencil, Trash2, Copy, Play, X, CodeXml, FileCode2 } from 'lucide-vue-next'
import * as snippetApi from '@/api/sql-snippet'
import type { SqlSnippetRecord } from '@/api/sql-snippet'

const emit = defineEmits<{
  insert: [sql: string]
  execute: [sql: string]
  close: []
}>()

const { t } = useI18n()
const snippets = ref<SqlSnippetRecord[]>([])
const searchQuery = ref('')
const loading = ref(false)
const editDialogOpen = ref(false)
const editingSnippet = ref<Partial<SqlSnippetRecord>>({})
const isNew = ref(true)

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(searchQuery, (val) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadSnippets(val), 300)
})

onMounted(() => loadSnippets())

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

async function loadSnippets(search?: string) {
  loading.value = true
  try {
    snippets.value = await snippetApi.listSqlSnippets({
      search: search?.trim() || null,
    })
  } catch { snippets.value = [] }
  finally { loading.value = false }
}

function openNew() {
  isNew.value = true
  editingSnippet.value = { title: '', sqlText: '', description: '', category: 'default' }
  editDialogOpen.value = true
}

function openEdit(s: SqlSnippetRecord) {
  isNew.value = false
  editingSnippet.value = { ...s }
  editDialogOpen.value = true
}

async function handleSave() {
  const s = editingSnippet.value
  if (!s.title?.trim() || !s.sqlText?.trim()) return
  const now = Date.now()
  const record: SqlSnippetRecord = {
    id: s.id || crypto.randomUUID(),
    title: s.title!.trim(),
    description: s.description || null,
    sqlText: s.sqlText!.trim(),
    category: s.category || 'default',
    tags: s.tags || null,
    connectionId: s.connectionId || null,
    createdAt: s.createdAt || now,
    updatedAt: now,
  }
  try {
    if (isNew.value) {
      await snippetApi.createSqlSnippet(record)
    } else {
      await snippetApi.updateSqlSnippet(record)
    }
    editDialogOpen.value = false
    loadSnippets(searchQuery.value)
  } catch { /* ignore */ }
}

async function handleDelete(id: string) {
  try {
    await snippetApi.deleteSqlSnippet(id)
    loadSnippets(searchQuery.value)
  } catch { /* ignore */ }
}

function handleInsert(sql: string) {
  emit('insert', sql)
}

function handleExecute(sql: string) {
  emit('execute', sql)
}

function saveFromSelection(sql: string) {
  isNew.value = true
  editingSnippet.value = { title: '', sqlText: sql, description: '', category: 'default' }
  editDialogOpen.value = true
}

defineExpose({ saveFromSelection })
</script>

<template>
  <div class="flex h-full flex-col border-l border-border/50 bg-muted/20 w-80">
    <!-- 头部 -->
    <div class="flex items-center justify-between px-4 py-3">
      <div class="flex items-center gap-2">
        <FileCode2 class="h-4 w-4 text-primary/70" />
        <span class="text-sm font-semibold tracking-tight">{{ t('sqlSnippet.title') }}</span>
      </div>
      <div class="flex items-center gap-0.5">
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-primary/10 hover:text-primary"
          @click="openNew"
          title="新建片段"
        >
          <Plus class="h-4 w-4" />
        </button>
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-muted hover:text-foreground/70"
          @click="$emit('close')"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- 搜索框 -->
    <div class="px-3 pb-3">
      <div class="relative">
        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
        <Input
          v-model="searchQuery"
          class="h-8 pl-8 text-xs bg-background/60 border-border/40 focus:bg-background"
          :placeholder="t('sqlSnippet.searchPlaceholder')"
        />
      </div>
    </div>

    <!-- 分割线 -->
    <div class="h-px bg-border/40 mx-3" />

    <!-- 片段列表 -->
    <ScrollArea class="flex-1 min-h-0">
      <!-- 空状态 -->
      <div v-if="snippets.length === 0" class="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60 mb-4">
          <CodeXml class="h-6 w-6 text-muted-foreground/40" />
        </div>
        <p class="text-xs font-medium text-muted-foreground/70 mb-1">{{ t('sqlSnippet.noSnippets') }}</p>
        <p class="text-[11px] text-muted-foreground/40">点击右上角 + 创建您的第一个片段</p>
      </div>

      <!-- 列表 -->
      <div v-else class="p-2.5 space-y-2">
        <div
          v-for="s in snippets"
          :key="s.id"
          class="group rounded-lg bg-background/60 border border-border/30 p-3 hover:bg-background hover:border-border/60 hover:shadow-sm transition-[background-color,border-color,box-shadow] duration-200 cursor-default"
        >
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-semibold text-foreground/90 truncate max-w-[180px]">{{ s.title }}</span>
            <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <button
                class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-primary/10 hover:text-primary transition-colors"
                @click="handleInsert(s.sqlText)"
                title="插入到编辑器"
              >
                <Copy class="h-3 w-3" />
              </button>
              <button
                class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-df-success/10 hover:text-df-success transition-colors"
                @click="handleExecute(s.sqlText)"
                title="执行"
              >
                <Play class="h-3 w-3" />
              </button>
              <button
                class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-muted hover:text-foreground/70 transition-colors"
                @click="openEdit(s)"
                title="编辑"
              >
                <Pencil class="h-3 w-3" />
              </button>
              <button
                class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive transition-colors"
                @click="handleDelete(s.id)"
                title="删除"
              >
                <Trash2 class="h-3 w-3" />
              </button>
            </div>
          </div>
          <pre class="text-[10px] text-muted-foreground/60 leading-relaxed max-h-14 overflow-hidden whitespace-pre-wrap break-all font-mono bg-muted/30 rounded-md px-2 py-1.5">{{ s.sqlText }}</pre>
        </div>
      </div>
    </ScrollArea>

    <!-- 编辑/新建片段弹窗 -->
    <Dialog v-model:open="editDialogOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader class="px-6 pt-6 pb-0">
          <DialogTitle class="text-base font-semibold">{{ isNew ? t('sqlSnippet.create') : t('sqlSnippet.edit') }}</DialogTitle>
        </DialogHeader>

        <div class="flex flex-col gap-4 px-6 py-5">
          <!-- 片段标题 -->
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-medium text-muted-foreground">{{ t('sqlSnippet.titlePlaceholder') }}</label>
            <Input
              v-model="editingSnippet.title"
              :placeholder="t('sqlSnippet.titlePlaceholder')"
              class="text-sm h-9"
            />
          </div>

          <!-- SQL 语句 -->
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-medium text-muted-foreground">SQL</label>
            <textarea
              v-model="editingSnippet.sqlText"
              :placeholder="t('sqlSnippet.sqlPlaceholder')"
              rows="6"
              :style="{
                backgroundColor: 'var(--color-muted)',
                color: 'var(--color-foreground)',
              }"
              class="w-full rounded-lg border border-input px-3 py-2.5 text-xs font-mono leading-relaxed resize-none transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
            />
          </div>

          <!-- 描述 -->
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              描述
              <span class="text-[10px] text-muted-foreground/50 font-normal">可选</span>
            </label>
            <Input
              :model-value="editingSnippet.description ?? ''"
              @update:model-value="v => editingSnippet.description = String(v)"
              placeholder="简要说明该片段的用途..."
              class="text-sm h-9"
            />
          </div>
        </div>

        <DialogFooter class="px-6 pb-6 pt-0">
          <Button variant="outline" size="sm" @click="editDialogOpen = false">{{ t('common.cancel') }}</Button>
          <Button size="sm" @click="handleSave">{{ t('common.save') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
