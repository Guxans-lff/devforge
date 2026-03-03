<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
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
import { Search, Plus, Pencil, Trash2, Copy, Play, X } from 'lucide-vue-next'
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
  <div class="flex h-full flex-col border-l border-border bg-background" style="width: 320px">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-3 py-2">
      <span class="text-xs font-medium">{{ t('sqlSnippet.title') }}</span>
      <div class="flex items-center gap-1">
        <Button variant="ghost" size="icon" class="h-5 w-5" @click="openNew">
          <Plus class="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" class="h-5 w-5" @click="$emit('close')">
          <X class="h-3 w-3" />
        </Button>
      </div>
    </div>

    <!-- Search -->
    <div class="px-2 py-1.5 border-b border-border">
      <div class="relative">
        <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <Input v-model="searchQuery" class="h-6 pl-6 text-xs" :placeholder="t('sqlSnippet.searchPlaceholder')" />
      </div>
    </div>

    <!-- Snippet list -->
    <ScrollArea class="flex-1 min-h-0">
      <div v-if="snippets.length === 0" class="px-3 py-8 text-center">
        <p class="text-xs text-muted-foreground">{{ t('sqlSnippet.noSnippets') }}</p>
      </div>
      <div v-else class="p-2 space-y-1.5">
        <div
          v-for="s in snippets"
          :key="s.id"
          class="group rounded-md border border-border p-2 hover:bg-muted/50 transition-colors"
        >
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs font-medium truncate">{{ s.title }}</span>
            <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="icon" class="h-5 w-5" @click="handleInsert(s.sqlText)">
                <Copy class="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" class="h-5 w-5" @click="handleExecute(s.sqlText)">
                <Play class="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" class="h-5 w-5" @click="openEdit(s)">
                <Pencil class="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" class="h-5 w-5 text-destructive" @click="handleDelete(s.id)">
                <Trash2 class="h-3 w-3" />
              </Button>
            </div>
          </div>
          <pre class="text-[10px] text-muted-foreground leading-tight max-h-16 overflow-hidden whitespace-pre-wrap break-all">{{ s.sqlText }}</pre>
        </div>
      </div>
    </ScrollArea>

    <!-- Edit dialog -->
    <Dialog v-model:open="editDialogOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle class="text-sm">{{ isNew ? t('sqlSnippet.create') : t('sqlSnippet.edit') }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-3 py-2">
          <Input v-model="editingSnippet.title" :placeholder="t('sqlSnippet.titlePlaceholder')" class="text-xs" />
          <textarea
            v-model="editingSnippet.sqlText"
            :placeholder="t('sqlSnippet.sqlPlaceholder')"
            class="w-full h-32 rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Input :model-value="editingSnippet.description ?? ''" @update:model-value="v => editingSnippet.description = String(v)" :placeholder="t('sqlSnippet.descriptionPlaceholder')" class="text-xs" />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" @click="editDialogOpen = false">{{ t('common.cancel') }}</Button>
          <Button size="sm" @click="handleSave">{{ t('common.save') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
