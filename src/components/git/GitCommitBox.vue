<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { useGitWorkspaceStore, type GitWorkspaceState } from '@/stores/git-workspace'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'
import { Check, RotateCw } from 'lucide-vue-next'

const props = defineProps<{
  repoPath: string
  workspace: GitWorkspaceState
}>()

const { t } = useI18n()
const toast = useToast()
const store = useGitWorkspaceStore()

const stagedCount = computed(() => props.workspace.status?.staged.length ?? 0)

/** 双向绑定 commitMessage 到 store */
const commitMessage = computed({
  get: () => props.workspace.commitMessage,
  set: (v: string) => store.update(props.repoPath, { commitMessage: v }),
})

const isAmend = computed({
  get: () => props.workspace.isAmend,
  set: (v: boolean) => store.update(props.repoPath, { isAmend: v }),
})

/** 作者/邮箱自动从 config 读取 */
const authorDisplay = computed(() => {
  const cfg = props.workspace.config
  if (cfg?.userName && cfg?.userEmail) {
    return `${cfg.userName} <${cfg.userEmail}>`
  }
  return null
})

async function handleCommit() {
  if (!commitMessage.value.trim()) {
    toast.warning(t('git.commitMessageRequired'))
    return
  }
  if (stagedCount.value === 0) {
    toast.warning(t('git.noStagedFiles'))
    return
  }
  try {
    const hash = await store.commit(props.repoPath)
    toast.success(t('git.commitSuccess', { hash: hash.substring(0, 7) }))
  } catch (e) {
    toast.error(t('git.commitFailed'), parseBackendError(e).message)
  }
}
</script>

<template>
  <div class="border-t border-border p-2 space-y-2">
    <!-- 提交消息 -->
    <textarea
      v-model="commitMessage"
      :placeholder="t('git.commitPlaceholder')"
      :aria-label="t('git.commitPlaceholder')"
      class="w-full h-20 px-2 py-1.5 text-xs bg-background border border-border rounded resize-none focus:outline-none focus:ring-1 focus:ring-primary"
      @keydown.ctrl.enter="handleCommit"
    />

    <!-- Amend + 作者信息 -->
    <div class="flex items-center gap-2 text-xs">
      <label class="flex items-center gap-1 cursor-pointer text-muted-foreground hover:text-foreground">
        <input type="checkbox" v-model="isAmend" class="h-3.5 w-3.5 rounded border-border" />
        <RotateCw class="h-3.5 w-3.5" />
        {{ t('git.amend') }}
      </label>
      <span v-if="authorDisplay" class="flex-1 text-right text-muted-foreground truncate" :title="authorDisplay">
        {{ authorDisplay }}
      </span>
    </div>

    <!-- 提交按钮 -->
    <Button
      class="w-full h-8 text-xs"
      :disabled="!commitMessage.trim() || stagedCount === 0"
      @click="handleCommit"
    >
      <Check class="h-3.5 w-3.5 mr-1" />
      {{ isAmend ? t('git.amend') : t('git.commit') }} ({{ stagedCount }})
    </Button>
  </div>
</template>
