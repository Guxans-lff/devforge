<script setup lang="ts">
/**
 * 磁盘使用率进度条列表
 * 替代 ECharts 柱状图 + 详情表格，纯 CSS 无溢出问题
 */
import type { DiskInfo } from '@/types/server-monitor'
import { HardDrive } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

defineProps<{
  disks: DiskInfo[]
}>()

const { t } = useI18n()

/** MB → 可读容量 */
function formatSize(mb: number): string {
  if (mb === 0) return '0'
  if (mb < 1024) return `${mb}M`
  if (mb < 1024 * 1024) return `${(mb / 1024).toFixed(1)}G`
  return `${(mb / 1024 / 1024).toFixed(2)}T`
}

/** 进度条颜色 class */
function barColor(pct: number): string {
  if (pct > 90) return 'bg-destructive'
  if (pct > 70) return 'bg-df-warning'
  return 'bg-df-success'
}
</script>

<template>
  <div class="rounded-lg border border-border/50 bg-card/50 p-3 backdrop-blur-sm">
    <div class="flex items-center gap-2 text-muted-foreground mb-3">
      <HardDrive class="h-3 w-3 text-df-warning" />
      <span class="text-[11px] font-medium">{{ t('monitor.diskUsage') }}</span>
    </div>
    <div class="space-y-2.5">
      <div v-for="disk in disks" :key="disk.mountPoint">
        <!-- 第一行：挂载点 + 文件系统 + 容量 + 百分比 -->
        <div class="flex items-center justify-between text-[11px] mb-1">
          <div class="flex items-center gap-2 min-w-0">
            <span class="font-mono text-foreground truncate max-w-[180px]">{{ disk.mountPoint }}</span>
            <span class="text-muted-foreground/50 text-[10px] truncate hidden sm:inline">{{ disk.filesystem }}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0 ml-2">
            <span class="tabular-nums text-muted-foreground">
              {{ formatSize(disk.usedMb) }} / {{ formatSize(disk.totalMb) }}
            </span>
            <span
              class="tabular-nums w-10 text-right font-medium"
              :class="disk.usePercent > 90 ? 'text-destructive' : 'text-foreground'"
            >
              {{ disk.usePercent.toFixed(0) }}%
            </span>
          </div>
        </div>
        <!-- 第二行：进度条 -->
        <div class="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-500"
            :class="barColor(disk.usePercent)"
            :style="{ width: `${Math.min(disk.usePercent, 100)}%` }"
          />
        </div>
      </div>
    </div>
    <!-- 空状态 -->
    <div v-if="!disks.length" class="text-center text-[11px] text-muted-foreground/50 py-4">
      {{ t('monitor.noData') }}
    </div>
  </div>
</template>
