<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useGitWorkspaceStore } from '@/stores/git-workspace'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'
import { formatTimestamp as formatTime } from '@/composables/useGitUtils'
import type { GitCommit } from '@/types/git'
import { Search, Loader2, X } from 'lucide-vue-next'

const props = defineProps<{
  repoPath: string
}>()

const emit = defineEmits<{
  viewCommitDiff: [hash: string]
}>()

const { t } = useI18n()
const toast = useToast()
const store = useGitWorkspaceStore()

const query = ref('')
const field = ref<'message' | 'author' | 'hash'>('message')
const results = ref<GitCommit[]>([])
const searching = ref(false)
const hasSearched = ref(false)

async function handleSearch() {
  if (!query.value.trim() || searching.value) return
  searching.value = true
  hasSearched.value = true
  try {
    results.value = await store.searchCommits(props.repoPath, query.value, field.value, 0, 50)
  } catch (e) {
    toast.error(t('git.searchFailed'), parseBackendError(e).message)
    results.value = []
  } finally {
    searching.value = false
  }
}

function clearSearch() {
  query.value = ''
  results.value = []
  hasSearched.value = false
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 搜索栏 -->
    <div class="flex items-center gap-1 p-2 border-b border-border">
      <div class="relative flex-1">
        <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          v-model="query"
          :placeholder="t('git.searchPlaceholder')"
          :aria-label="t('git.searchPlaceholder')"
          class="h-8 text-xs pl-7 pr-7"
          @keydown.enter="handleSearch"
        />
        <button
          v-if="query"
          :aria-label="t('git.clearSearch')"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          @click="clearSearch"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
      <!-- 搜索字段切换 -->
      <select
        v-model="field"
        :aria-label="t('git.searchField')"
        class="h-8 px-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="message">{{ t('git.searchByMessage') }}</option>
        <option value="author">{{ t('git.searchByAuthor') }}</option>
        <option value="hash">{{ t('git.searchByHash') }}</option>
      </select>
      <Button size="sm" class="h-8 text-xs" :disabled="!query.trim() || searching" @click="handleSearch">
        <Loader2 v-if="searching" class="h-3.5 w-3.5 animate-spin" />
        <Search v-else class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- 结果 -->
    <ScrollArea class="flex-1">
      <div v-if="searching" class="flex items-center justify-center py-8">
        <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
      <div v-else-if="results.length > 0" class="p-2 space-y-0.5">
        <div
          v-for="c in results" :key="c.hash"
          class="flex flex-col gap-0.5 px-2 py-1.5 rounded cursor-pointer hover:bg-accent/50 text-xs"
          @click="emit('viewCommitDiff', c.hash)"
        >
          <div class="flex items-center gap-1.5">
            <span class="font-mono text-primary text-xs shrink-0">{{ c.shortHash }}</span>
            <span class="truncate font-medium">{{ c.message }}</span>
          </div>
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{{ c.author }}</span>
            <span>{{ formatTime(c.timestamp) }}</span>
          </div>
        </div>
      </div>
      <div v-else-if="hasSearched" class="text-center text-xs text-muted-foreground py-8">
        {{ t('git.noResults') }}
      </div>
      <div v-else class="text-center text-xs text-muted-foreground py-8">
        {{ t('git.searchHint') }}
      </div>
    </ScrollArea>
  </div>
</template>
