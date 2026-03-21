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
    sftpCancelSearch(props.connectionId).catch((e: unknown) => console.warn('[FileSearch]', e))
  }
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 搜索头部 -->
    <div class="flex items-center gap-2 border-b border-border/40 px-3 py-2.5 bg-muted/10">
      <Search class="h-3 w-3 text-muted-foreground/60" />
      <span class="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/80">
        {{ t('fileEditor.search') }}
      </span>
      <span class="flex-1" />
      <Button variant="ghost" size="sm" class="h-6 w-6 p-0 rounded-md hover:bg-muted/60 transition-colors" @click="emit('close')">
        <X class="h-3.5 w-3.5 text-muted-foreground/60" />
      </Button>
    </div>

    <!-- 搜索表单 -->
    <div class="space-y-4 border-b border-border/40 p-3">
      <form class="relative group" @submit.prevent="handleSearch">
        <Input
          v-model="pattern"
          :placeholder="t('fileEditor.searchPlaceholder')"
          class="h-8 pl-8 pr-10 text-xs bg-muted/20 border-border/40 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all rounded-lg"
          autofocus
        />
        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 group-focus-within:text-primary/70 transition-colors" />
        
        <div class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <Button
            v-if="searching"
            type="button"
            size="sm"
            variant="ghost"
            class="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive text-muted-foreground/60"
            @click="handleCancel"
          >
            <StopCircle class="h-3.5 w-3.5" />
          </Button>
          <Button 
            v-else 
            type="submit" 
            size="sm" 
            variant="ghost"
            class="h-6 w-6 p-0 hover:bg-primary/10 hover:text-primary text-muted-foreground/40" 
            :disabled="!pattern.trim()"
          >
            <Search class="h-3.5 w-3.5" />
          </Button>
        </div>
      </form>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label class="flex items-center gap-2 text-[11px] text-muted-foreground/80 cursor-pointer hover:text-foreground transition-colors group">
          <div class="relative flex items-center justify-center h-3.5 w-3.5 rounded border border-border/60 bg-muted/40 group-hover:border-primary/50 transition-all overflow-hidden">
            <input type="checkbox" v-model="caseSensitive" class="absolute inset-0 opacity-0 cursor-pointer z-10" />
            <div v-if="caseSensitive" class="h-full w-full bg-primary flex items-center justify-center">
              <div class="h-1.5 w-1.5 rounded-full bg-primary-foreground transform scale-100 transition-transform"></div>
            </div>
          </div>
          {{ t('fileEditor.caseSensitive') }}
        </label>

        <div class="flex items-center gap-2 text-[11px] text-muted-foreground/80 group">
          <span class="shrink-0">{{ t('fileEditor.maxDepth') }}</span>
          <div class="relative flex items-center">
            <input 
              v-model.number="maxDepth" 
              type="number" 
              min="1" 
              max="50" 
              class="h-5 w-10 text-center bg-muted/40 border border-border/40 rounded px-1 text-[10px] focus:border-primary/50 focus:outline-none transition-all" 
            />
          </div>
        </div>
      </div>

      <div class="space-y-1">
        <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 italic truncate">
          <Folder class="h-2.5 w-2.5 shrink-0" />
          {{ t('fileEditor.searchIn') }}: {{ currentPath }}
        </div>
        <div class="text-[9px] text-muted-foreground/40 leading-relaxed px-1">
          {{ t('fileEditor.searchGlobHint') }}
        </div>
      </div>
    </div>

    <!-- 搜索结果 -->
    <div class="min-h-0 flex-1 overflow-auto custom-scrollbar">
      <!-- 搜索中但还没结果 -->
      <div v-if="searching && results.length === 0" class="flex flex-col items-center justify-center gap-3 py-12">
        <div class="relative">
          <Loader2 class="h-6 w-6 animate-spin text-primary/60" />
          <Search class="absolute inset-0 m-auto h-2.5 w-2.5 text-primary/40" />
        </div>
        <span class="text-[11px] text-muted-foreground/60 animate-pulse">{{ t('fileEditor.searching') }}</span>
      </div>
      <!-- 搜索完成无结果 -->
      <div v-else-if="searched && !searching && results.length === 0" class="flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
        <Search class="h-8 w-8 text-muted-foreground/20" />
        <p class="text-[11px] text-muted-foreground/60">
          {{ cancelled ? t('fileEditor.searchCancelled') : t('fileEditor.noSearchResults') }}
        </p>
      </div>
      <!-- 有结果（搜索中或已完成） -->
      <div v-else-if="results.length > 0" class="p-1 space-y-0.5">
        <div
          v-for="result in results"
          :key="result.path"
          class="flex cursor-pointer items-center gap-3 px-2.5 py-2 text-xs rounded-md transition-all hover:bg-muted/40 group active:scale-[0.99]"
          @click="handleResultClick(result)"
        >
          <div class="relative flex items-center justify-center h-8 w-8 shrink-0 rounded-lg bg-muted/30 group-hover:bg-background transition-colors shadow-sm border border-border/10">
            <component 
              :is="result.isDir ? Folder : File" 
              class="h-4 w-4 shrink-0 transition-transform group-hover:scale-110" 
              :class="result.isDir ? 'text-[var(--df-warning)]' : 'text-muted-foreground/70'" 
            />
          </div>
          <div class="min-w-0 flex-1 space-y-0.5">
            <div class="truncate font-medium text-foreground/90 group-hover:text-primary transition-colors text-[11px]">{{ result.name }}</div>
            <div class="truncate text-[10px] text-muted-foreground/50 font-mono">{{ result.path }}</div>
          </div>
          <div v-if="!result.isDir" class="shrink-0 text-[9px] font-medium text-muted-foreground/40 bg-muted/20 px-1.5 py-0.5 rounded border border-border/5 group-hover:bg-muted/40 transition-colors">
            {{ formatSize(result.size) }}
          </div>
        </div>
      </div>
    </div>

    <!-- 状态栏 -->
    <div v-if="searched" class="flex items-center gap-2 border-t border-border/40 px-3 py-1.5 text-[9px] font-medium text-muted-foreground/60 bg-muted/5">
      <Loader2 v-if="searching" class="h-2.5 w-2.5 animate-spin text-primary/60" />
      <span class="tracking-tight">{{ t('fileEditor.searchResults', { count: resultCount }) }}</span>
      <span v-if="searching" class="text-muted-foreground/40 animate-pulse">...</span>
    </div>
  </div>
</template>
