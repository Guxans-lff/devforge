<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  CodeXml,
  TerminalSquare,
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
  <div class="flex h-full flex-col border-l border-border/50 bg-muted/20 w-80">
    <!-- 头部 -->
    <div class="flex items-center justify-between px-4 py-3">
      <div class="flex items-center gap-2">
        <TerminalSquare class="h-4 w-4 text-primary/70" />
        <span class="text-sm font-semibold tracking-tight">{{ t('terminal.commandSnippets') }}</span>
      </div>
      <div class="flex items-center gap-0.5">
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-all hover:bg-primary/10 hover:text-primary"
          @click="openCreate"
          title="新建片段"
        >
          <Plus class="h-4 w-4" />
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
          :placeholder="t('terminal.searchSnippets')"
        />
      </div>
    </div>

    <!-- 分割线 -->
    <div class="h-px bg-border/40 mx-3" />

    <!-- 片段列表 -->
    <ScrollArea class="flex-1 min-h-0">
      <!-- 空状态 -->
      <div v-if="filteredSnippets.length === 0" class="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60 mb-4">
          <CodeXml class="h-6 w-6 text-muted-foreground/40" />
        </div>
        <p class="text-xs font-medium text-muted-foreground/70 mb-1">{{ t('terminal.noSnippets') }}</p>
        <p class="text-[11px] text-muted-foreground/40">点击右上角 + 创建您的第一个命令片段</p>
      </div>

      <!-- 列表 -->
      <div v-else class="p-2.5 space-y-2">
        <div
          v-for="snippet in filteredSnippets"
          :key="snippet.id"
          class="group rounded-lg bg-background/60 border border-border/30 p-3 hover:bg-background hover:border-border/60 hover:shadow-sm transition-all duration-200 cursor-default"
          @click="sendCommand(snippet.command)"
        >
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-semibold text-foreground/90 truncate max-w-[180px]">{{ snippet.title }}</span>
            <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <button
                class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-primary/10 hover:text-primary transition-colors"
                @click.stop="sendCommand(snippet.command)"
                :title="t('terminal.sendToTerminal')"
              >
                <Play class="h-3 w-3" />
              </button>
              <button
                class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-muted hover:text-foreground/70 transition-colors"
                @click.stop="openEdit(snippet)"
                title="编辑"
              >
                <Pencil class="h-3 w-3" />
              </button>
              <button
                class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive transition-colors"
                @click.stop="requestDelete(snippet)"
                title="删除"
              >
                <Trash2 class="h-3 w-3" />
              </button>
            </div>
          </div>
          <p v-if="snippet.description" class="mb-1.5 text-[10px] text-muted-foreground/60 line-clamp-2 leading-relaxed">
            {{ snippet.description }}
          </p>
          <code class="block truncate text-[10px] text-muted-foreground/80 font-mono bg-muted/30 rounded-md px-2 py-1.5 border border-border/20">
            {{ snippet.command }}
          </code>
        </div>
      </div>
    </ScrollArea>
  </div>

  <!-- Edit Sheet -->
  <Sheet v-model:open="editing">
    <SheetContent side="right" class="w-80">
      <SheetHeader>
        <SheetTitle>{{ editingSnippet ? t('terminal.editSnippet') : t('terminal.newSnippet') }}</SheetTitle>
      </SheetHeader>
      <div class="grid gap-4 py-4">
        <div class="grid gap-2 px-6">
          <label class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{{ t('terminal.snippetTitle') }}</label>
          <Input v-model="formTitle" class="h-9 text-sm" placeholder="例如：Docker 清理..." />
        </div>
        <div class="grid gap-2 px-6">
          <label class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{{ t('terminal.snippetCommand') }}</label>
          <textarea
            v-model="formCommand"
            rows="5"
            :style="{
              backgroundColor: 'var(--color-muted)',
              color: 'var(--color-foreground)',
            }"
            class="w-full rounded-lg border border-input px-3 py-2.5 text-xs font-mono leading-relaxed resize-none transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
            placeholder="输入 shell 命令..."
          />
        </div>
        <div class="grid gap-2 px-6">
          <div class="flex items-center justify-between">
            <label class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{{ t('terminal.snippetDescription') }}</label>
            <span class="text-[10px] text-muted-foreground/50">可选</span>
          </div>
          <Input v-model="formDescription" class="h-9 text-sm" placeholder="简要说明该命令的用途..." />
        </div>
        <div class="grid gap-2 px-6">
          <div class="flex items-center justify-between">
            <label class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{{ t('terminal.snippetCategory') }}</label>
            <span class="text-[10px] text-muted-foreground/50">默认: default</span>
          </div>
          <Input v-model="formCategory" class="h-9 text-sm" placeholder="default" />
        </div>
        <div class="px-6 pt-2">
          <Button class="w-full h-10 font-semibold shadow-sm" :disabled="!formTitle.trim() || !formCommand.trim()" @click="handleSave">
            {{ t('common.save') }}
          </Button>
        </div>
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