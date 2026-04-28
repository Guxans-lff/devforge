<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useGitWorkspaceStore, type GitWorkspaceState } from '@/stores/git-workspace'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'
import { confirmGitRisk } from '@/composables/git/gitRisk'
import { Archive, ArrowDownCircle, Trash2, ArrowUpFromDot } from 'lucide-vue-next'

const props = defineProps<{
  repoPath: string
  workspace: GitWorkspaceState
}>()

const { t } = useI18n()
const toast = useToast()
const store = useGitWorkspaceStore()

const stashMessage = ref('')

const totalChanges = computed(() => {
  const s = props.workspace.status
  return (s?.staged.length ?? 0) + (s?.unstaged.length ?? 0) + (s?.untracked.length ?? 0)
})

async function handleCreateStash() {
  try {
    await store.createStash(props.repoPath, stashMessage.value || undefined)
    toast.success(t('git.stashCreated'))
    stashMessage.value = ''
  } catch (e) {
    toast.error(t('git.stashFailed'), parseBackendError(e).message)
  }
}

async function handleApplyStash(index: number) {
  if (!confirmGitRisk({ operation: 'stash_apply', stashIndex: index })) return
  try {
    await store.applyStash(props.repoPath, index)
    toast.success(t('git.stashApplied'))
  } catch (e) {
    toast.error(t('git.stashApplyFailed'), parseBackendError(e).message)
  }
}

async function handlePopStash(index: number) {
  if (!confirmGitRisk({ operation: 'stash_pop', stashIndex: index })) return
  try {
    await store.popStash(props.repoPath, index)
    toast.success(t('git.stashPopped'))
  } catch (e) {
    toast.error(t('git.stashPopFailed'), parseBackendError(e).message)
  }
}

async function handleDropStash(index: number) {
  if (!confirmGitRisk({ operation: 'stash_drop', stashIndex: index })) return
  try {
    await store.dropStash(props.repoPath, index)
    toast.success(t('git.stashDropped'))
  } catch (e) {
    toast.error(t('git.stashDropFailed'), parseBackendError(e).message)
  }
}
</script>

<template>
  <ScrollArea class="h-full">
    <div class="p-3 space-y-2">
      <!-- 创建 stash -->
      <div class="flex items-center gap-2">
        <Input
          v-model="stashMessage"
          :placeholder="t('git.stashPlaceholder')"
          class="h-8 text-xs flex-1"
          @keydown.enter="handleCreateStash"
        />
        <Button size="sm" class="h-8 text-xs" @click="handleCreateStash" :disabled="totalChanges === 0">
          <Archive class="h-3.5 w-3.5 mr-1" /> {{ t('git.stash') }}
        </Button>
      </div>

      <!-- 列表 -->
      <div v-if="workspace.stashes.length === 0" class="text-center text-xs text-muted-foreground py-4">
        {{ t('git.noStashes') }}
      </div>
      <div
        v-for="s in workspace.stashes" :key="s.index"
        class="flex items-center gap-2 px-2 py-1.5 rounded border border-border/50 hover:bg-accent/50 text-xs"
      >
        <Archive class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div class="flex-1 min-w-0">
          <div class="truncate">stash@{<span>{{ s.index }}</span>}: {{ s.message }}</div>
          <div class="text-[10px] text-muted-foreground font-mono">{{ s.commitHash.substring(0, 7) }}</div>
        </div>
        <TooltipProvider :delay-duration="300">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" class="h-6 w-6" :aria-label="t('git.applyStash')" @click="handleApplyStash(s.index)">
                <ArrowDownCircle class="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p class="text-xs">{{ t('git.applyStash') }}</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" class="h-6 w-6" :aria-label="t('git.popStash')" @click="handlePopStash(s.index)">
                <ArrowUpFromDot class="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p class="text-xs">{{ t('git.popStash') }}</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" class="h-6 w-6 text-destructive" :aria-label="t('git.dropStash')" @click="handleDropStash(s.index)">
                <Trash2 class="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p class="text-xs">{{ t('git.dropStash') }}</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  </ScrollArea>
</template>
