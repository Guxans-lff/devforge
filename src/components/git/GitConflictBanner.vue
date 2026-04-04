<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { useGitWorkspaceStore, type GitWorkspaceState } from '@/stores/git-workspace'
import { useToast } from '@/composables/useToast'
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
    toast.error(t('git.abortFailed'), String(e))
  }
}
</script>

<template>
  <div
    v-if="workspace.status?.hasConflicts"
    class="flex items-center gap-2 px-3 py-1.5 bg-orange-500/10 border-b border-orange-500/30 text-xs"
  >
    <AlertTriangle class="h-4 w-4 text-orange-500 shrink-0" />
    <span class="text-orange-600 dark:text-orange-400 font-medium">
      {{ t('git.conflictDetected') }}
    </span>
    <div class="flex-1" />
    <Button variant="outline" size="sm" class="h-6 text-xs border-orange-500/30 text-orange-600" @click="handleAbortMerge">
      <X class="h-3.5 w-3.5 mr-0.5" /> {{ t('git.abortMerge') }}
    </Button>
  </div>
</template>
