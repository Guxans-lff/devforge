<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Search,
  Plus,
  Play,
  Pencil,
  Trash2,
  Bookmark,
  X,
} from 'lucide-vue-next'
import * as api from '@/api/command-snippet'
import type { CommandSnippet } from '@/api/command-snippet'

const emit = defineEmits<{
  send: [command: string]
}>()

const { t } = useI18n()
const toast = useToast()

const snippets = ref<CommandSnippet[]>([])
const searchQuery = ref('')
const loading = ref(false)

// 编辑表单
const editing = ref(false)
const editingSnippet = ref<CommandSnippet | null>(null)
const formTitle = ref('')
const formCommand = ref('')
const formDescription = ref('')
const formCategory = ref('')

// 删除确认
const showDeleteConfirm = ref(false)
const deleteTarget = ref<CommandSnippet | null>(null)

const filteredSnippets = computed(() => {
  if (!searchQuery.value) return snippets.value
  const q = searchQuery.value.toLowerCase()
  return snippets.value.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.command.toLowerCase().includes(q) ||
      (s.description?.toLowerCase().includes(q) ?? false),
  )
})

const categories = computed(() => {
  const cats = new Set(snippets.value.map((s) => s.category || 'default'))
  return Array.from(cats)
})

async function loadSnippets() {
  loading.value = true
  try {
    snippets.value = await api.listCommandSnippets()
  } catch (e) {
    toast.error(t('toast.operationFailed'), String(e))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingSnippet.value = null
  formTitle.value = ''
  formCommand.value = ''
  formDescription.value = ''
  formCategory.value = 'default'
  editing.value = true
}

function openEdit(snippet: CommandSnippet) {
  editingSnippet.value = snippet
  formTitle.value = snippet.title
  formCommand.value = snippet.command
  formDescription.value = snippet.description ?? ''
  formCategory.value = snippet.category ?? 'default'
  editing.value = true
}

async function handleSave() {
  if (!formTitle.value.trim() || !formCommand.value.trim()) return
  try {
    const now = Date.now()
    if (editingSnippet.value) {
      await api.updateCommandSnippet({
        ...editingSnippet.value,
        title: formTitle.value,
        command: formCommand.value,
        description: formDescription.value || undefined,
        category: formCategory.value || 'default',
        updatedAt: now,
      })
    } else {
      await api.createCommandSnippet({
        id: crypto.randomUUID(),
        title: formTitle.value,
        command: formCommand.value,
        description: formDescription.value || undefined,
        category: formCategory.value || 'default',
        sortOrder: snippets.value.length,
        createdAt: now,
        updatedAt: now,
      })
    }
    editing.value = false
    await loadSnippets()
  } catch (e) {
    toast.error(t('toast.operationFailed'), String(e))
  }
}

function requestDelete(snippet: CommandSnippet) {
  deleteTarget.value = snippet
  showDeleteConfirm.value = true
}

async function executeDelete() {
  if (!deleteTarget.value) return
  try {
    await api.deleteCommandSnippet(deleteTarget.value.id)
    deleteTarget.value = null
    await loadSnippets()
  } catch (e) {
    toast.error(t('toast.deleteFailed'), String(e))
  }
}

function sendCommand(command: string) {
  emit('send', command)
}

onMounted(loadSnippets)
</script>

<!-- TEMPLATE_PLACEHOLDER -->

<template>
  <div class="flex h-full flex-col border-l border-border bg-background">
    <!-- Header -->
    <div class="flex items-center gap-1 border-b border-border px-2 py-1.5">
      <Bookmark class="h-3.5 w-3.5 text-muted-foreground" />
      <span class="flex-1 text-xs font-medium text-muted-foreground">{{ t('terminal.commandSnippets') }}</span>
      <Button variant="ghost" size="icon" class="h-6 w-6" @click="openCreate">
        <Plus class="h-3 w-3" />
      </Button>
    </div>

    <!-- Search -->
    <div class="border-b border-border px-2 py-1">
      <div class="relative">
        <Search class="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="searchQuery"
          class="h-6 pl-7 text-xs"
          :placeholder="t('terminal.searchSnippets')"
        />
      </div>
    </div>

    <!-- Snippet list -->
    <div class="flex-1 overflow-y-auto">
      <div v-if="filteredSnippets.length === 0" class="flex items-center justify-center p-4">
        <span class="text-xs text-muted-foreground">{{ t('terminal.noSnippets') }}</span>
      </div>
      <div
        v-for="snippet in filteredSnippets"
        :key="snippet.id"
        class="group border-b border-border/50 px-2 py-1.5 hover:bg-accent cursor-pointer"
        @click="sendCommand(snippet.command)"
      >
        <div class="flex items-center gap-1">
          <span class="flex-1 truncate text-xs font-medium">{{ snippet.title }}</span>
          <Button
            variant="ghost"
            size="icon"
            class="h-5 w-5 opacity-0 group-hover:opacity-100"
            @click.stop="sendCommand(snippet.command)"
            :title="t('terminal.sendToTerminal')"
          >
            <Play class="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="h-5 w-5 opacity-0 group-hover:opacity-100"
            @click.stop="openEdit(snippet)"
          >
            <Pencil class="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="h-5 w-5 opacity-0 group-hover:opacity-100 text-destructive"
            @click.stop="requestDelete(snippet)"
          >
            <Trash2 class="h-3 w-3" />
          </Button>
        </div>
        <code class="mt-0.5 block truncate text-[10px] text-muted-foreground">{{ snippet.command }}</code>
        <p v-if="snippet.description" class="mt-0.5 truncate text-[10px] text-muted-foreground/70">{{ snippet.description }}</p>
      </div>
    </div>
  </div>

  <!-- Edit Sheet -->
  <Sheet v-model:open="editing">
    <SheetContent side="right" class="w-80">
      <SheetHeader>
        <SheetTitle>{{ editingSnippet ? t('terminal.editSnippet') : t('terminal.newSnippet') }}</SheetTitle>
      </SheetHeader>
      <div class="mt-4 grid gap-3">
        <div class="grid gap-1.5">
          <Label class="text-xs">{{ t('terminal.snippetTitle') }}</Label>
          <Input v-model="formTitle" class="h-8 text-xs" />
        </div>
        <div class="grid gap-1.5">
          <Label class="text-xs">{{ t('terminal.snippetCommand') }}</Label>
          <textarea
            v-model="formCommand"
            class="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div class="grid gap-1.5">
          <Label class="text-xs">{{ t('terminal.snippetDescription') }}</Label>
          <Input v-model="formDescription" class="h-8 text-xs" />
        </div>
        <div class="grid gap-1.5">
          <Label class="text-xs">{{ t('terminal.snippetCategory') }}</Label>
          <Input v-model="formCategory" class="h-8 text-xs" placeholder="default" />
        </div>
        <Button size="sm" :disabled="!formTitle.trim() || !formCommand.trim()" @click="handleSave">
          {{ t('common.save') }}
        </Button>
      </div>
    </SheetContent>
  </Sheet>

  <ConfirmDialog
    v-model:open="showDeleteConfirm"
    :title="t('terminal.deleteSnippet')"
    :description="deleteTarget?.title ?? ''"
    @confirm="executeDelete"
  />
</template>