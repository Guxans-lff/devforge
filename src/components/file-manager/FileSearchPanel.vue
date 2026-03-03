<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, Loader2, Folder, File, X, StopCircle } from 'lucide-vue-next'
import { sftpSearchFiles, sftpCancelSearch } from '@/api/file-editor'
import type { SearchResult } from '@/types/fileManager'

const props = defineProps<{
  connectionId: string
  currentPath: string
}>()

const emit = defineEmits<{
  navigate: [path: string]
  close: []
}>()

const { t } = useI18n()

const pattern = ref('')
const caseSensitive = ref(false)
const maxDepth = ref(10)
const searching = ref(false)
const results = ref<SearchResult[]>([])
const searched = ref(false)
const cancelled = ref(false)

const resultCount = computed(() => results.value.length)

let unlistenResult: UnlistenFn | null = null
let currentSearchId = 0

function cleanupListener() {
  if (unlistenResult) {
    unlistenResult()
    unlistenResult = null
  }
}

async function handleSearch() {
  const q = pattern.value.trim()
  if (!q) return

  if (searching.value) {
    await handleCancel()
  }

  cleanupListener()

  searching.value = true
  searched.value = true
  cancelled.value = false
  results.value = []

  const searchId = ++currentSearchId

  // 监听流式结果
  unlistenResult = await listen<SearchResult>('search:result', (event) => {
    if (searchId !== currentSearchId) return
    results.value.push(event.payload)
  })

  try {
    const done = await sftpSearchFiles(
      props.connectionId,
      props.currentPath,
      q,
      caseSensitive.value,
      maxDepth.value,
    )
    if (searchId === currentSearchId) {
      cancelled.value = done?.cancelled ?? false
    }
  } catch (e) {
    console.error('Search failed:', e)
  } finally {
    if (searchId === currentSearchId) {
      searching.value = false
      cleanupListener()
    }
  }
}

async function handleCancel() {
  try {
    await sftpCancelSearch(props.connectionId)
  } catch {
    // 忽略取消错误
  }
}

function handleResultClick(result: SearchResult) {
  if (result.isDir) {
    emit('navigate', result.path)
  } else {
    const lastSlash = result.path.lastIndexOf('/')
    const dir = lastSlash > 0 ? result.path.substring(0, lastSlash) : '/'
    emit('navigate', dir)
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

onUnmounted(() => {
  cleanupListener()
  if (searching.value) {
    sftpCancelSearch(props.connectionId).catch(() => {})
  }
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 搜索头部 -->
    <div class="flex items-center gap-1 border-b border-border px-2 py-1.5">
      <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {{ t('fileEditor.search') }}
      </span>
      <span class="flex-1" />
      <Button variant="ghost" size="sm" class="h-5 w-5 p-0" @click="emit('close')">
        <X class="h-3 w-3" />
      </Button>
    </div>

    <!-- 搜索表单 -->
    <div class="space-y-2 border-b border-border p-2">
      <form class="flex gap-1" @submit.prevent="handleSearch">
        <Input
          v-model="pattern"
          :placeholder="t('fileEditor.searchPlaceholder')"
          class="h-7 text-xs"
          autofocus
        />
        <Button
          v-if="searching"
          type="button"
          size="sm"
          variant="destructive"
          class="h-7 shrink-0 px-2"
          @click="handleCancel"
        >
          <StopCircle class="h-3.5 w-3.5" />
        </Button>
        <Button v-else type="submit" size="sm" class="h-7 shrink-0 px-2" :disabled="!pattern.trim()">
          <Search class="h-3.5 w-3.5" />
        </Button>
      </form>
      <div class="flex items-center gap-3">
        <label class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <input type="checkbox" v-model="caseSensitive" class="accent-primary h-3 w-3 cursor-pointer" />
          {{ t('fileEditor.caseSensitive') }}
        </label>
        <label class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {{ t('fileEditor.maxDepth') }}:
          <Input v-model.number="maxDepth" type="number" min="1" max="50" class="h-5 w-12 text-[10px]" />
        </label>
      </div>
      <div class="text-[10px] text-muted-foreground">
        {{ t('fileEditor.searchIn') }}: {{ currentPath }}
      </div>
      <div class="text-[10px] text-muted-foreground/60">
        {{ t('fileEditor.searchGlobHint') }}
      </div>
    </div>

    <!-- 搜索结果 -->
    <div class="min-h-0 flex-1 overflow-auto">
      <!-- 搜索中但还没结果 -->
      <div v-if="searching && results.length === 0" class="flex flex-col items-center justify-center gap-2 py-8">
        <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
        <span class="text-[10px] text-muted-foreground">{{ t('fileEditor.searching') }}</span>
      </div>
      <!-- 搜索完成无结果 -->
      <div v-else-if="searched && !searching && results.length === 0" class="py-8 text-center text-xs text-muted-foreground">
        {{ cancelled ? t('fileEditor.searchCancelled') : t('fileEditor.noSearchResults') }}
      </div>
      <!-- 有结果（搜索中或已完成） -->
      <div v-else-if="results.length > 0">
        <div
          v-for="result in results"
          :key="result.path"
          class="flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-accent"
          @click="handleResultClick(result)"
        >
          <component :is="result.isDir ? Folder : File" class="h-3.5 w-3.5 shrink-0" :class="result.isDir ? 'text-[var(--df-warning)]' : 'text-muted-foreground'" />
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium">{{ result.name }}</div>
            <div class="truncate text-[10px] text-muted-foreground">{{ result.path }}</div>
          </div>
          <span v-if="!result.isDir" class="shrink-0 text-[10px] text-muted-foreground">
            {{ formatSize(result.size) }}
          </span>
        </div>
      </div>
    </div>

    <!-- 状态栏 -->
    <div v-if="searched" class="flex items-center gap-1 border-t border-border px-2 py-1 text-[10px] text-muted-foreground">
      <Loader2 v-if="searching" class="h-3 w-3 animate-spin" />
      <span>{{ t('fileEditor.searchResults', { count: resultCount }) }}</span>
      <span v-if="searching" class="text-muted-foreground/60">...</span>
    </div>
  </div>
</template>
