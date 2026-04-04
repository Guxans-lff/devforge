<script setup lang="ts">
/**
 * Git 贡献者统计面板
 * 显示提交数、时间跨度等信息
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { gitGetContributors } from '@/api/git'
import type { GitContributor } from '@/types/git'
import { useToast } from '@/composables/useToast'
import { Loader2, RefreshCw, Users } from 'lucide-vue-next'

const props = defineProps<{
  repoPath: string
}>()

const { t } = useI18n()
const toast = useToast()

const contributors = ref<GitContributor[]>([])
const loading = ref(false)

const totalCommits = computed(() => contributors.value.reduce((sum, c) => sum + c.commits, 0))

onMounted(() => loadContributors())

async function loadContributors() {
  loading.value = true
  try {
    contributors.value = await gitGetContributors(props.repoPath)
  } catch (e) {
    toast.error(t('git.contributorsFailed'), String(e))
  } finally {
    loading.value = false
  }
}

/** 提交数 → 百分比条宽度 */
function barWidth(commits: number) {
  if (!contributors.value.length) return '0%'
  const max = contributors.value[0]?.commits ?? 1
  return `${(commits / max) * 100}%`
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString()
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 头部 -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/20">
      <Users class="h-3.5 w-3.5 text-muted-foreground" />
      <span class="text-xs font-medium">{{ t('git.contributors') }}</span>
      <span class="text-[10px] text-muted-foreground">
        {{ contributors.length }} {{ t('git.contributorsCount') }} · {{ totalCommits }} {{ t('git.totalCommits') }}
      </span>
      <div class="flex-1" />
      <Button variant="ghost" size="icon" class="h-7 w-7" :disabled="loading" @click="loadContributors">
        <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': loading }" />
      </Button>
    </div>

    <!-- 列表 -->
    <ScrollArea class="flex-1">
      <div v-if="loading && contributors.length === 0" class="flex items-center justify-center py-12">
        <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
      <div v-else class="p-2 space-y-1">
        <div
          v-for="(c, i) in contributors" :key="c.email"
          class="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-accent/30"
        >
          <!-- 排名 -->
          <span class="text-[10px] text-muted-foreground font-mono w-5 text-right shrink-0">{{ i + 1 }}</span>

          <!-- 头像占位（首字母） -->
          <div class="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary shrink-0">
            {{ c.name.charAt(0).toUpperCase() }}
          </div>

          <!-- 信息 -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium truncate">{{ c.name }}</span>
              <span class="text-[10px] text-muted-foreground truncate">{{ c.email }}</span>
            </div>
            <!-- 提交条 -->
            <div class="mt-0.5 flex items-center gap-2">
              <div class="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                <div class="h-full rounded-full bg-primary/60" :style="{ width: barWidth(c.commits) }" />
              </div>
              <span class="text-[10px] font-mono text-muted-foreground shrink-0">{{ c.commits }}</span>
            </div>
            <!-- 时间跨度 -->
            <div class="text-[10px] text-muted-foreground mt-0.5">
              {{ formatDate(c.firstCommit) }} — {{ formatDate(c.lastCommit) }}
            </div>
          </div>
        </div>

        <div v-if="contributors.length === 0 && !loading" class="px-2 py-8 text-center text-xs text-muted-foreground">
          {{ t('git.noContributors') }}
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
