<script setup lang="ts">
/**
 * Git 文件历史
 * 显示单个文件的提交历史
 */
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { gitFileHistory } from '@/api/git'
import type { GitCommit } from '@/types/git'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'
import { formatTimestamp as formatTime } from '@/composables/useGitUtils'
import { Loader2, X } from 'lucide-vue-next'

const props = defineProps<{
  repoPath: string
  filePath: string
}>()

const emit = defineEmits<{
  close: []
  viewCommitDiff: [hash: string]
}>()

const { t } = useI18n()
const toast = useToast()

const commits = ref<GitCommit[]>([])
const loading = ref(false)
const hasMore = ref(true)
const PAGE_SIZE = 50

const fileName = computed(() => props.filePath.split('/').pop() ?? props.filePath)

onMounted(async () => {
  await loadHistory(0)
})

async function loadHistory(skip: number) {
  loading.value = true
  try {
    const data = await gitFileHistory(props.repoPath, props.filePath, skip, PAGE_SIZE)
    if (skip === 0) {
      commits.value = data
    } else {
      commits.value = [...commits.value, ...data]
    }
    hasMore.value = data.length >= PAGE_SIZE
  } catch (e) {
    toast.error(t('git.fileHistoryFailed'), parseBackendError(e).message)
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loading.value || !hasMore.value) return
  await loadHistory(commits.value.length)
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 头部 -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/30">
      <span class="text-xs font-medium">{{ t('git.fileHistory') }}</span>
      <span class="text-xs font-mono text-muted-foreground truncate">{{ fileName }}</span>
      <div class="flex-1" />
      <Button variant="ghost" size="icon" class="h-6 w-6" :aria-label="t('common.close')" @click="emit('close')">
        <X class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- 列表 -->
    <ScrollArea class="flex-1">
      <div v-if="loading && commits.length === 0" class="flex items-center justify-center py-8">
        <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
      <div v-else class="p-2 space-y-0.5">
        <div
          v-for="c in commits" :key="c.hash"
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

        <div v-if="hasMore" class="flex justify-center py-2">
          <Button variant="ghost" size="sm" class="h-7 text-xs" :disabled="loading" @click="loadMore">
            <Loader2 v-if="loading" class="h-3.5 w-3.5 animate-spin mr-1" />
            {{ t('git.loadMore') }}
          </Button>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
