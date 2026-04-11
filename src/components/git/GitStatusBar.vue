<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GitWorkspaceState } from '@/stores/git-workspace'
import { Loader2, GitBranch as GitBranchIcon } from 'lucide-vue-next'

const props = defineProps<{
  workspace: GitWorkspaceState
}>()

const { t } = useI18n()

const statusText = computed(() => {
  const s = props.workspace.status
  if (!s) return ''
  const parts: string[] = []
  if (s.staged.length > 0) parts.push(`${s.staged.length} ${t('git.statusStaged')}`)
  if (s.unstaged.length > 0) parts.push(`${s.unstaged.length} ${t('git.statusModified')}`)
  if (s.untracked.length > 0) parts.push(`${s.untracked.length} ${t('git.statusUntracked')}`)
  return parts.join(' · ') || t('git.statusClean')
})
</script>

<template>
  <div class="flex items-center gap-2 border-t border-border px-3 py-1 bg-muted/30 text-xs text-muted-foreground">
    <GitBranchIcon class="h-3.5 w-3.5" />
    <span>{{ workspace.status?.currentBranch ?? '—' }}</span>
    <span class="text-muted-foreground/50">|</span>
    <span>{{ statusText }}</span>
    <div class="flex-1" />
    <template v-if="workspace.operating">
      <Loader2 class="h-3.5 w-3.5 animate-spin" />
      <span>{{ workspace.operating }}...</span>
    </template>
  </div>
</template>
