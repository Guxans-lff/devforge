<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { open } from '@tauri-apps/plugin-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { FolderOpen, GitBranch } from 'lucide-vue-next'
import { gitValidateRepo } from '@/api/git'

export interface GitFormData {
  repositoryPath: string
}

const props = defineProps<{
  modelValue: GitFormData
}>()

const emit = defineEmits<{
  'update:modelValue': [value: GitFormData]
}>()

const { t } = useI18n()

const repoError = ref('')

const localValue = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

function updateField<K extends keyof GitFormData>(field: K, value: GitFormData[K]) {
  localValue.value = {
    ...localValue.value,
    [field]: value,
  }
}

async function browseRepository() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: t('git.selectRepository'),
  })
  if (selected) {
    const path = typeof selected === 'string' ? selected : selected[0]
    repoError.value = ''

    try {
      const valid = await gitValidateRepo(path)
      if (!valid) {
        repoError.value = t('git.notAGitRepo')
        updateField('repositoryPath', '')
        return
      }
    } catch {
      repoError.value = t('git.notAGitRepo')
      updateField('repositoryPath', '')
      return
    }

    updateField('repositoryPath', path)
  }
}
</script>

<template>
  <div class="space-y-10">
    <!-- Section: Repository Path -->
    <section class="space-y-5">
      <div class="flex items-center gap-2">
        <div class="h-1.5 w-1.5 rounded-full bg-primary/40"></div>
        <h3 class="text-xs font-black uppercase tracking-widest text-muted-foreground/80">{{ t('connection.typeGit') }}</h3>
        <div class="flex-1 h-[1px] bg-border/40"></div>
      </div>

      <!-- Repository Path -->
      <div class="space-y-2">
        <div class="flex items-center gap-2 px-1">
          <GitBranch class="h-3 w-3 text-muted-foreground/40" />
          <Label class="text-[11px] font-bold text-muted-foreground/70">{{ t('git.repositoryPath') }}</Label>
        </div>
        <div class="flex gap-2">
          <Input
            :model-value="localValue.repositoryPath"
            :placeholder="t('git.repositoryPathPlaceholder')"
            readonly
            class="flex-1 h-9 bg-muted/20 border-border/40 rounded-md text-[11px] font-semibold text-foreground placeholder:text-muted-foreground/40 cursor-pointer"
            @click="browseRepository"
          />
          <Button
            variant="outline"
            size="sm"
            class="h-9 px-3 border-border/40 hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors"
            @click="browseRepository"
          >
            <FolderOpen class="h-3.5 w-3.5" />
          </Button>
        </div>
        <p v-if="repoError" class="text-[10px] text-destructive px-1">{{ repoError }}</p>
        <p v-else class="text-[10px] text-muted-foreground/50 px-1">{{ t('git.repositoryPathHint') }}</p>
      </div>
    </section>
  </div>
</template>
