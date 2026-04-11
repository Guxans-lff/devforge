<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { useGitWorkspaceStore, type GitWorkspaceState } from '@/stores/git-workspace'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'
import { AlertTriangle, X } from 'lucide-vue-next'

const props = defineProps<{
  repoPath: string
  workspace: GitWorkspaceState
}>()

const { t } = useI18n()
const toast = useToast()
const store = useGitWorkspaceStore()

async function handleAbortMerge() {
  try {
    await store.abortMerge(props.repoPath)
    toast.success(t('git.mergeAborted'))
  } catch (e) {
    toast.error(t('git.abortFailed'), parseBackendError(e).message)
  }
}
</script>

<template>
  <div
    v-if="workspace.status?.hasConflicts"
    class="flex items-center gap-2 px-3 py-1.5 bg-df-warning/10 border-b border-df-warning/30 text-xs"
  >
    <AlertTriangle class="h-4 w-4 text-df-warning shrink-0" />
    <span class="text-df-warning font-medium">
      {{ t('git.conflictDetected') }}
    </span>
    <div class="flex-1" />
    <Button variant="outline" size="sm" class="h-6 text-xs border-df-warning/30 text-df-warning" @click="handleAbortMerge">
      <X class="h-3.5 w-3.5 mr-0.5" /> {{ t('git.abortMerge') }}
    </Button>
  </div>
</template>
