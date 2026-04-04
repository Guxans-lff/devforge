<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RefreshCw, ChevronRight } from 'lucide-vue-next'
import { redisGetInfo, redisClusterNodes } from '@/api/redis'
import { useToast } from '@/composables/useToast'
import type { RedisServerInfo, ClusterNodeInfo } from '@/types/redis'

const props = defineProps<{
  connectionId: string
  isCluster?: boolean
}>()

const { t } = useI18n()
const toast = useToast()

const info = ref<RedisServerInfo | null>(null)
const clusterNodeList = ref<ClusterNodeInfo[]>([])
const loading = ref(false)
const expandedSections = ref<Set<string>>(new Set(['Server', 'Memory', 'Clients', 'Stats', 'ClusterNodes']))

async function loadInfo() {
  loading.value = true
  try {
    info.value = await redisGetInfo(props.connectionId)
    // Cluster 模式下加载节点拓扑
    if (props.isCluster) {
      try {
        clusterNodeList.value = await redisClusterNodes(props.connectionId)
      } catch { /* 忽略 */ }
    }
  } catch (e) {
    toast.error('获取服务器信息失败', (e as any)?.message ?? String(e))
  } finally {
    loading.value = false
  }
}

function toggleSection(name: string) {
  if (expandedSections.value.has(name)) {
    expandedSections.value.delete(name)
  } else {
    expandedSections.value.add(name)
  }
}

onMounted(() => { loadInfo() })
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 头部 -->
    <div class="flex items-center justify-between px-4 py-2 border-b border-border/30 shrink-0">
      <span class="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-wider">{{ t('redis.serverInfo') }}</span>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" :disabled="loading" @click="loadInfo">
        <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': loading }" />
      </Button>
    </div>

    <!-- 信息内容 -->
    <ScrollArea class="flex-1">
      <div class="py-2">
        <template v-if="info">
          <!-- Cluster 节点拓扑（仅 Cluster 模式） -->
          <div v-if="isCluster && clusterNodeList.length" class="border-b border-border/10">
            <button
              class="w-full flex items-center gap-2 px-4 py-2 hover:bg-muted/20 transition-colors text-left"
              @click="toggleSection('ClusterNodes')"
            >
              <ChevronRight
                class="h-3 w-3 text-muted-foreground/40 transition-transform"
                :class="{ 'rotate-90': expandedSections.has('ClusterNodes') }"
              />
              <span class="text-[11px] font-bold text-foreground/80">{{ t('redis.cluster.nodes') }}</span>
              <span class="text-[9px] text-muted-foreground/30 font-mono">{{ clusterNodeList.length }}</span>
            </button>

            <div v-if="expandedSections.has('ClusterNodes')" class="pb-2 px-4">
              <div
                v-for="node in clusterNodeList"
                :key="node.id"
                class="flex items-center gap-3 py-1.5 px-4 text-[11px] hover:bg-muted/10 rounded"
              >
                <!-- 状态指示灯 -->
                <div
                  class="h-2 w-2 rounded-full shrink-0"
                  :class="node.connected ? 'bg-df-success shadow-[0_0_4px_var(--df-success)]' : 'bg-destructive'"
                />
                <!-- 角色标签 -->
                <span
                  class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 min-w-[48px] text-center"
                  :class="node.flags.includes('master')
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted/40 text-muted-foreground/60'"
                >
                  {{ node.flags.includes('master') ? t('redis.cluster.master') : t('redis.cluster.slave') }}
                </span>
                <!-- 地址 -->
                <span class="font-mono text-foreground/70 min-w-[160px]">{{ node.addr }}</span>
                <!-- 哈希槽 -->
                <span v-if="node.slots" class="font-mono text-muted-foreground/50 text-[10px]">
                  {{ t('redis.cluster.slots') }}: {{ node.slots }}
                </span>
                <!-- Master ID（从节点显示） -->
                <span
                  v-if="node.flags.includes('slave') && node.masterId !== '-'"
                  class="font-mono text-muted-foreground/30 text-[9px] truncate"
                >
                  → {{ node.masterId.slice(0, 8) }}
                </span>
              </div>
            </div>
          </div>

          <div v-for="section in info.sections" :key="section.name" class="border-b border-border/10">
            <!-- Section 头 -->
            <button
              class="w-full flex items-center gap-2 px-4 py-2 hover:bg-muted/20 transition-colors text-left"
              @click="toggleSection(section.name)"
            >
              <ChevronRight
                class="h-3 w-3 text-muted-foreground/40 transition-transform"
                :class="{ 'rotate-90': expandedSections.has(section.name) }"
              />
              <span class="text-[11px] font-bold text-foreground/80">{{ section.name }}</span>
              <span class="text-[9px] text-muted-foreground/30 font-mono">{{ section.entries.length }}</span>
            </button>

            <!-- Section 内容 -->
            <div v-if="expandedSections.has(section.name)" class="pb-2">
              <div
                v-for="entry in section.entries"
                :key="entry.key"
                class="flex items-center px-8 py-0.5 text-[11px] hover:bg-muted/10"
              >
                <span class="w-[200px] shrink-0 font-mono text-muted-foreground/60 truncate">{{ entry.key }}</span>
                <span class="font-mono text-foreground/70 truncate">{{ entry.value }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </ScrollArea>
  </div>
</template>
