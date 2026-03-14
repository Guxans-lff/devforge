<script setup lang="ts">
import { ref } from 'vue'
import ChartConfigPanel from '@/components/database/chart/ChartConfigPanel.vue'
import ResultChart from '@/components/database/chart/ResultChart.vue'
import type { ChartConfig } from '@/components/database/chart/ChartConfigPanel.vue'
import type { ColumnDef } from '@/types/database'

const props = defineProps<{
  /** 行数据 */
  rows: unknown[][]
  /** 列定义 */
  columns: ColumnDef[]
}>()

const chartConfig = ref<ChartConfig | null>(null)
const columnNames = props.columns.map(c => c.name)

function handleConfigChange(config: ChartConfig) {
  chartConfig.value = config
}
</script>

<template>
  <div class="flex h-full overflow-hidden border-t border-border">
    <!-- 左侧：配置面板 -->
    <div class="w-[240px] shrink-0 border-r border-border bg-muted/10 overflow-hidden">
      <ChartConfigPanel
        :columns="columns"
        @config-change="handleConfigChange"
      />
    </div>

    <!-- 右侧：图表区域 -->
    <div class="flex-1 min-w-0 p-2">
      <ResultChart
        :rows="rows"
        :column-names="columnNames"
        :config="chartConfig"
      />
    </div>
  </div>
</template>
