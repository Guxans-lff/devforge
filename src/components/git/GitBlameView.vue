<script setup lang="ts">
/**
 * Git Blame 视图
 * 显示每一行的最后修改者和提交信息
 */
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { gitBlameFile } from '@/api/git'
import type { GitBlameLine } from '@/types/git'
import { useToast } from '@/composables/useToast'
import { Loader2, X } from 'lucide-vue-next'

const props = defineProps<{
  repoPath: string
  filePath: string
}>()

const emit = defineEmits<{
  close: []
  viewCommit: [hash: string]
}>()

const { t } = useI18n()
const toast = useToast()

const lines = ref<GitBlameLine[]>([])
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    lines.value = await gitBlameFile(props.repoPath, props.filePath)
  } catch (e) {
    toast.error(t('git.blameFailed'), String(e))
  } finally {
    loading.value = false
  }
})

/** 文件名 */
const fileName = computed(() => props.filePath.split('/').pop() ?? props.filePath)

/** 同一 commit 的行用相同背景色，交替显示 */
function blameGroupClass(index: number): string {
  if (index === 0) return ''
  const prev = lines.value[index - 1]
  const curr = lines.value[index]
  if (prev && curr && prev.commitHash !== curr.commitHash) return 'border-t border-border/30'
  return ''
}

function formatTime(ts: number) {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shortHash(hash: string) {
  return hash.substring(0, 7)
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 头部 -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/30">
      <span class="text-xs font-medium">Blame</span>
      <span class="text-xs font-mono text-muted-foreground truncate">{{ fileName }}</span>
      <div class="flex-1" />
      <Button variant="ghost" size="icon" class="h-6 w-6" @click="emit('close')">
        <X class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- 内容 -->
    <div v-if="loading" class="flex items-center justify-center flex-1">
      <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
    </div>

    <ScrollArea v-else class="flex-1">
      <div class="font-mono text-xs">
        <div
          v-for="(line, i) in lines" :key="i"
          class="flex hover:bg-accent/30"
          :class="blameGroupClass(i)"
        >
          <!-- Blame 信息列 -->
          <div class="w-[200px] shrink-0 flex items-start gap-1 px-2 py-1 text-muted-foreground/70 border-r border-border/30 bg-muted/10">
            <span
              class="text-primary/70 cursor-pointer hover:underline"
              @click="emit('viewCommit', line.commitHash)"
            >
              {{ shortHash(line.commitHash) }}
            </span>
            <span class="truncate flex-1" :title="line.author">{{ line.author }}</span>
            <span class="text-xs shrink-0">{{ formatTime(line.timestamp) }}</span>
          </div>
          <!-- 行号 -->
          <span class="w-10 shrink-0 text-right pr-2 text-muted-foreground/50 select-none py-1">
            {{ line.lineNumber }}
          </span>
          <!-- 代码内容 -->
          <pre class="flex-1 whitespace-pre-wrap break-all px-2 py-1">{{ line.content }}</pre>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
