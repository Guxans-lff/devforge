<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Loader2,
  FolderSync,
  Plus,
  Minus,
  RefreshCw,
  Check,
  File,
  Folder,
  ArrowUpRight,
  ArrowDownLeft,
} from 'lucide-vue-next'
import { syncCompare, type SyncDiff } from '@/api/sync'

const props = defineProps<{
  open: boolean
  connectionId: string
  localPath: string
  remotePath: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()

const comparing = ref(false)
const diff = ref<SyncDiff | null>(null)
const error = ref('')
const filter = ref<'all' | 'added_local' | 'added_remote' | 'modified'>('all')

const filteredEntries = computed(() => {
  if (!diff.value) return []
  if (filter.value === 'all') return diff.value.entries.filter(e => e.status !== 'unchanged')
  return diff.value.entries.filter(e => e.status === filter.value)
})

async function handleCompare() {
  comparing.value = true
  error.value = ''
  diff.value = null
  try {
    diff.value = await syncCompare(props.connectionId, props.localPath, props.remotePath)
  } catch (e) {
    error.value = String(e)
  } finally {
    comparing.value = false
  }
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '-'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}


function statusIcon(status: string) {
  switch (status) {
    case 'added_local': return ArrowUpRight
    case 'added_remote': return ArrowDownLeft
    case 'modified': return RefreshCw
    default: return Check
  }
}

function statusColor(status: string) {
  switch (status) {
    case 'added_local': return 'text-[var(--df-success)]'
    case 'added_remote': return 'text-[var(--df-info)]'
    case 'modified': return 'text-[var(--df-warning)]'
    default: return 'text-muted-foreground'
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[750px] max-h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <FolderSync class="h-4 w-4" />
          {{ t('sync.title') }}
        </DialogTitle>
      </DialogHeader>

      <div class="space-y-3 min-h-0 flex-1 overflow-hidden flex flex-col">
        <!-- 路径信息 -->
        <div class="grid grid-cols-2 gap-3 text-xs">
          <div class="rounded-md border border-border p-2">
            <div class="text-muted-foreground mb-1">{{ t('fileManager.local') }}</div>
            <div class="truncate font-mono">{{ localPath }}</div>
          </div>
          <div class="rounded-md border border-border p-2">
            <div class="text-muted-foreground mb-1">{{ t('fileManager.remote') }}</div>
            <div class="truncate font-mono">{{ remotePath }}</div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex items-center gap-2">
          <Button size="sm" :disabled="comparing" @click="handleCompare">
            <Loader2 v-if="comparing" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
            <RefreshCw v-else class="mr-1.5 h-3.5 w-3.5" />
            {{ t('sync.compare') }}
          </Button>

          <!-- 过滤按钮 -->
          <div v-if="diff" class="flex items-center gap-1 ml-auto">
            <Button
              variant="ghost" size="sm"
              class="h-7 px-2 text-xs"
              :class="filter === 'all' ? 'bg-accent' : ''"
              @click="filter = 'all'"
            >
              {{ t('sync.all') }}
            </Button>
            <Button
              v-if="diff.addedLocal > 0"
              variant="ghost" size="sm"
              class="h-7 px-2 text-xs text-[var(--df-success)]"
              :class="filter === 'added_local' ? 'bg-accent' : ''"
              @click="filter = 'added_local'"
            >
              <Plus class="mr-1 h-3 w-3" /> {{ diff.addedLocal }}
            </Button>
            <Button
              v-if="diff.addedRemote > 0"
              variant="ghost" size="sm"
              class="h-7 px-2 text-xs text-[var(--df-info)]"
              :class="filter === 'added_remote' ? 'bg-accent' : ''"
              @click="filter = 'added_remote'"
            >
              <Minus class="mr-1 h-3 w-3" /> {{ diff.addedRemote }}
            </Button>
            <Button
              v-if="diff.modified > 0"
              variant="ghost" size="sm"
              class="h-7 px-2 text-xs text-[var(--df-warning)]"
              :class="filter === 'modified' ? 'bg-accent' : ''"
              @click="filter = 'modified'"
            >
              <RefreshCw class="mr-1 h-3 w-3" /> {{ diff.modified }}
            </Button>
          </div>
        </div>

        <!-- 错误信息 -->
        <div v-if="error" class="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {{ error }}
        </div>

        <!-- 结果列表 -->
        <div v-if="diff && !comparing" class="min-h-0 flex-1 overflow-auto rounded-md border border-border">
          <!-- 摘要 -->
          <div class="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-muted/50 px-3 py-1.5 text-xs">
            <span>{{ t('sync.summary') }}:</span>
            <span class="text-[var(--df-success)]">+{{ diff.addedLocal }} {{ t('sync.localOnly') }}</span>
            <span class="text-[var(--df-info)]">+{{ diff.addedRemote }} {{ t('sync.remoteOnly') }}</span>
            <span class="text-[var(--df-warning)]">~{{ diff.modified }} {{ t('sync.modified') }}</span>
            <span class="text-muted-foreground">={{ diff.unchanged }} {{ t('sync.unchanged') }}</span>
          </div>

          <div v-if="filteredEntries.length === 0" class="py-8 text-center text-xs text-muted-foreground">
            {{ t('sync.noDifferences') }}
          </div>

          <div
            v-for="entry in filteredEntries"
            :key="entry.path"
            class="flex items-center gap-2 border-b border-border/50 px-3 py-1.5 text-xs last:border-b-0 hover:bg-accent/50"
          >
            <component :is="statusIcon(entry.status)" class="h-3.5 w-3.5 shrink-0" :class="statusColor(entry.status)" />
            <component :is="entry.isDir ? Folder : File" class="h-3.5 w-3.5 shrink-0" :class="entry.isDir ? 'text-[var(--df-warning)]' : 'text-muted-foreground'" />
            <div class="min-w-0 flex-1 truncate font-mono">{{ entry.path }}</div>
            <div class="shrink-0 w-20 text-right text-muted-foreground">{{ formatSize(entry.localSize) }}</div>
            <div class="shrink-0 w-20 text-right text-muted-foreground">{{ formatSize(entry.remoteSize) }}</div>
          </div>
        </div>

        <!-- 加载中 -->
        <div v-if="comparing" class="flex items-center justify-center py-12">
          <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t('common.close') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
