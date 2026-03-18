<script setup lang="ts">
import { ref, computed, watch } from 'vue' // Added 'computed' and 'watch' import
import ChartConfigPanel from '@/components/database/chart/ChartConfigPanel.vue'
import ResultChart from '@/components/database/chart/ResultChart.vue'
import type { ChartConfig } from '@/components/database/chart/ChartConfigPanel.vue'
import type { ColumnDef } from '@/types/database'
import { Settings2 } from 'lucide-vue-next' // Removed Loader2, Table as TableIcon as they are not used in this file and the instruction refers to QueryResult.vue
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

const props = defineProps<{
  /** 行数据 */
  rows: unknown[][]
  /** 列定义 */
  columns: ColumnDef[]
}>()

const configOpen = defineModel<boolean>('configOpen', { default: false })
const chartConfig = ref<ChartConfig | null>(null)
const columnNames = computed(() => props.columns.map(c => c.name))

/** 自动智能推荐配置 */
watch(() => props.columns, (cols) => {
  if (cols.length > 0 && !chartConfig.value) {
    // 识别数值列
    const numericCols = cols.filter(c => {
      const t = (c.dataType ?? '').toLowerCase()
      return /int|float|double|decimal|numeric|real|number|money|serial|bigint|smallint|tinyint/i.test(t)
    })
    // 识别分类列 (除数值外的第一列)
    const categoricalCols = cols.filter(c => !numericCols.includes(c))

    chartConfig.value = {
      chartType: 'bar',
      xColumn: categoricalCols[0]?.name ?? cols[0]?.name ?? '',
      yColumns: [numericCols[0]?.name ?? cols[1]?.name ?? cols[0]?.name ?? ''],
      aggregation: 'none',
    }
  }
}, { immediate: true })

function handleConfigChange(config: ChartConfig) {
  chartConfig.value = config
}
</script>

<template>
  <div class="relative flex h-full w-full flex-col overflow-hidden bg-background">
    <!-- 图表主区域 -->
    <div class="flex-1 min-h-0 relative">
      <ResultChart
        v-if="chartConfig"
        :rows="rows"
        :column-names="columnNames"
        :config="chartConfig"
      />
      <template v-else>
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="flex flex-col items-center gap-3 text-muted-foreground/40">
            <div class="rounded-full bg-muted/20 p-4">
              <Settings2 class="h-8 w-8 opacity-20" />
            </div>
            <div class="text-sm font-medium tracking-wide">
              点击上方“配置”按钮生成图表
            </div>
          </div>
        </div>
      </template>

    <!-- 抽屉内容 (由外部控制开关) -->
    <Sheet v-model:open="configOpen">
      <SheetContent side="right" class="w-[320px] p-0 sm:max-w-[320px]">
        <SheetHeader class="p-4 border-b bg-muted/20">
          <SheetTitle class="text-sm font-bold flex items-center gap-2">
            <Settings2 class="h-4 w-4 text-primary" />
            可视化分析配置
          </SheetTitle>
        </SheetHeader>
        <div class="h-full overflow-hidden">
          <ChartConfigPanel
            :columns="columns"
            :config="chartConfig"
            @config-change="handleConfigChange"
          />
        </div>
      </SheetContent>
    </Sheet>
    </div>
  </div>
</template>
