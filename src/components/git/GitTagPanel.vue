<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useGitWorkspaceStore, type GitWorkspaceState } from '@/stores/git-workspace'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'
import { formatTimestamp as formatTime } from '@/composables/useGitUtils'
import { Tag, Plus, Check, Trash2 } from 'lucide-vue-next'

const props = defineProps<{
  repoPath: string
  workspace: GitWorkspaceState
}>()

const { t } = useI18n()
const toast = useToast()
const store = useGitWorkspaceStore()

const showTagInput = ref(false)
const newTagName = ref('')
const newTagMessage = ref('')

async function handleCreateTag() {
  if (!newTagName.value.trim()) return
  try {
    await store.createTag(props.repoPath, newTagName.value, newTagMessage.value || undefined)
    toast.success(t('git.tagCreated', { name: newTagName.value }))
    newTagName.value = ''
    newTagMessage.value = ''
    showTagInput.value = false
  } catch (e) {
    toast.error(t('git.tagCreateFailed'), parseBackendError(e).message)
  }
}

async function handleDeleteTag(name: string) {
  try {
    await store.deleteTag(props.repoPath, name)
    toast.success(t('git.tagDeleted', { name }))
  } catch (e) {
    toast.error(t('git.tagDeleteFailed'), parseBackendError(e).message)
  }
}
</script>

<template>
  <ScrollArea class="h-full">
    <div class="p-3 space-y-2">
      <!-- 新建 Tag -->
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <template v-if="showTagInput">
            <Input
              v-model="newTagName"
              :placeholder="t('git.tagName')"
              :aria-label="t('git.tagName')"
              class="h-8 text-xs flex-1"
              @keydown.enter="handleCreateTag"
              @keydown.escape="showTagInput = false"
              autofocus
            />
            <Button size="sm" class="h-8 text-xs" @click="handleCreateTag">
              <Check class="h-3.5 w-3.5" />
            </Button>
          </template>
          <Button v-else variant="outline" size="sm" class="h-8 text-xs" @click="showTagInput = true">
            <Plus class="h-3.5 w-3.5 mr-1" /> {{ t('git.newTag') }}
          </Button>
        </div>
        <Input
          v-if="showTagInput"
          v-model="newTagMessage"
          :placeholder="t('git.tagMessage')"
          :aria-label="t('git.tagMessage')"
          class="h-8 text-xs"
        />
      </div>

      <!-- Tag 列表 -->
      <div v-if="workspace.tags.length === 0" class="text-center text-xs text-muted-foreground py-4">
        {{ t('git.noTags') }}
      </div>
      <div
        v-for="tag in workspace.tags" :key="tag.name"
        class="flex items-center gap-2 px-2 py-1.5 rounded border border-border/50 hover:bg-accent/50 text-xs"
      >
        <Tag class="h-3.5 w-3.5 shrink-0 text-df-warning" />
        <div class="flex-1 min-w-0">
          <div class="truncate font-medium">{{ tag.name }}</div>
          <div class="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span class="font-mono">{{ tag.hash.substring(0, 7) }}</span>
            <span>{{ formatTime(tag.timestamp) }}</span>
            <span v-if="tag.isLightweight" class="text-muted-foreground/50">{{ t('git.lightweight') }}</span>
          </div>
          <div v-if="tag.message" class="text-[10px] text-muted-foreground truncate">{{ tag.message }}</div>
        </div>
        <TooltipProvider :delay-duration="300">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" class="h-6 w-6 text-destructive" @click="handleDeleteTag(tag.name)">
                <Trash2 class="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p class="text-xs">{{ t('git.deleteTag') }}</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  </ScrollArea>
</template>
