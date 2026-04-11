<script setup lang="ts">
/**
 * IndexAdvisorPanel - 索引分析顾问面板
 * 冗余索引检测 + 未使用索引检测 + EXPLAIN 索引建议
 */
import { ref, onMounted } from 'vue'
import { dbAnalyzeIndexes, dbExecuteQuery } from '@/api/database'
import type { IndexAnalysisResult } from '@/types/database'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { useMessage } from '@/stores/message-center'
import { RefreshCw, AlertTriangle, Copy, Search, Trash2, FileWarning } from 'lucide-vue-next'

const props = defineProps<{
  connectionId: string
  isConnected: boolean
}>()

const message = useMessage()
const isLoading = ref(false)
const result = ref<IndexAnalysisResult | null>(null)
const errorMsg = ref<string | null>(null)
const selectedDb = ref('')

/** 获取当前连接的数据库列表 */
const databases = ref<string[]>([])

async function loadDatabases() {
  try {
    const queryResult = await dbExecuteQuery(props.connectionId, 'SHOW DATABASES')
    databases.value = queryResult.rows.map(row => String(row[0]))
    if (!selectedDb.value && databases.value.length > 0) {
      selectedDb.value = databases.value[0]!
    }
  } catch {
    // 获取数据库列表失败时忽略，用户可手动输入
  }
}

/** 执行索引分析 */
async function analyze() {
  if (!props.isConnected || !selectedDb.value) return
  isLoading.value = true
  errorMsg.value = null
  result.value = null
  try {
    result.value = await dbAnalyzeIndexes(props.connectionId, selectedDb.value)
  } catch (e) {
    errorMsg.value = String(e)
  } finally {
    isLoading.value = false
  }
}

/** 复制 SQL 到剪贴板 */
async function copySql(sql: string) {
  try {
    await navigator.clipboard.writeText(sql)
    message.success('已复制到剪贴板')
  } catch {
    message.error('复制失败')
  }
}

/** 冗余索引总数 */
function redundantCount(): number {
  return result.value?.redundantIndexes.length ?? 0
}

/** 未使用索引总数 */
function unusedCount(): number {
  return result.value?.unusedIndexes.length ?? 0
}

onMounted(() => { loadDatabases() })
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden px-6 pt-4">
    <!-- 标题栏 -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="p-2 rounded-xl bg-df-warning/10 text-df-warning shadow-sm">
          <Search class="h-5 w-5" />
        </div>
        <div>
          <h3 class="text-sm font-black tracking-tight uppercase">索引分析顾问 (Index Advisor)</h3>
          <p class="text-[10px] text-muted-foreground/40 font-medium">检测冗余索引和未使用索引，释放存储空间</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <select
          v-model="selectedDb"
          aria-label="选择分析的数据库"
          class="h-8 rounded-lg border border-border/20 bg-muted/20 px-3 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option v-for="db in databases" :key="db" :value="db">{{ db }}</option>
        </select>
        <Button
          size="sm"
          variant="default"
          class="h-8 rounded-lg text-xs font-bold"
          :disabled="!selectedDb || isLoading"
          @click="analyze"
        >
          <RefreshCw class="h-3.5 w-3.5 mr-1.5" :class="{ 'animate-spin': isLoading }" />
          分析索引
        </Button>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="errorMsg" class="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-center gap-2">
      <AlertTriangle class="h-4 w-4 shrink-0" />
      {{ errorMsg }}
    </div>

    <!-- 未分析前提示 -->
    <div v-if="!result && !isLoading && !errorMsg" class="flex-1 flex items-center justify-center">
      <div class="text-center opacity-30">
        <Search class="mx-auto h-12 w-12 mb-3" />
        <p class="text-xs font-black uppercase tracking-widest">选择数据库并点击"分析索引"</p>
        <p class="text-[10px] mt-1">将检测冗余索引、未使用索引</p>
      </div>
    </div>

    <!-- 分析结果 -->
    <div v-if="result" class="flex-1 overflow-auto space-y-4">
      <!-- 概览统计 -->
      <div class="grid grid-cols-2 gap-4">
        <div class="rounded-2xl border border-df-warning/20 bg-df-warning/5 p-4">
          <div class="flex items-center gap-2 mb-2">
            <Trash2 class="h-4 w-4 text-df-warning" />
            <span class="text-xs font-black uppercase text-df-warning">冗余索引</span>
          </div>
          <div class="text-2xl font-black" :class="redundantCount() > 0 ? 'text-df-warning' : 'text-df-success'">
            {{ redundantCount() }}
          </div>
          <p class="text-[10px] text-muted-foreground/50 mt-1">被其他索引完全覆盖的前缀索引</p>
        </div>
        <div class="rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
          <div class="flex items-center gap-2 mb-2">
            <FileWarning class="h-4 w-4 text-destructive" />
            <span class="text-xs font-black uppercase text-destructive">未使用索引</span>
          </div>
          <div class="text-2xl font-black" :class="unusedCount() > 0 ? 'text-destructive' : 'text-df-success'">
            {{ unusedCount() }}
          </div>
          <p class="text-[10px] text-muted-foreground/50 mt-1">自服务器启动以来未被任何查询读取</p>
        </div>
      </div>

      <!-- 冗余索引列表 -->
      <div v-if="redundantCount() > 0" class="rounded-2xl border border-border/10 overflow-hidden bg-muted/5">
        <div class="px-4 py-3 border-b border-border/10 bg-background/50">
          <h4 class="text-xs font-black uppercase text-df-warning flex items-center gap-2">
            <Trash2 class="h-3.5 w-3.5" />
            冗余索引详情
          </h4>
        </div>
        <ScrollArea class="max-h-[300px]">
          <table class="w-full text-left border-collapse">
            <thead class="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/20">
              <tr class="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest h-10">
                <th class="px-4">表名</th>
                <th class="px-4">冗余索引</th>
                <th class="px-4">索引列</th>
                <th class="px-4">被覆盖于</th>
                <th class="px-4">覆盖索引列</th>
                <th class="px-4 w-12"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/5">
              <tr v-for="(idx, i) in result.redundantIndexes" :key="i" class="text-xs hover:bg-primary/[0.03] transition-colors group">
                <td class="px-4 py-2 font-mono font-bold text-foreground/80">{{ idx.tableName }}</td>
                <td class="px-4 py-2 font-mono text-df-warning">{{ idx.indexName }}</td>
                <td class="px-4 py-2 font-mono text-[11px] text-muted-foreground/60">{{ idx.indexColumns.join(', ') }}</td>
                <td class="px-4 py-2 font-mono text-df-success">{{ idx.coveredBy }}</td>
                <td class="px-4 py-2 font-mono text-[11px] text-muted-foreground/60">{{ idx.coveredByColumns.join(', ') }}</td>
                <td class="px-4 py-2">
                  <Button variant="ghost" size="icon" class="h-7 w-7 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" @click="copySql(idx.dropSql)" title="复制 DROP 语句">
                    <Copy class="h-3 w-3" />
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </ScrollArea>
      </div>

      <!-- 未使用索引列表 -->
      <div v-if="unusedCount() > 0" class="rounded-2xl border border-border/10 overflow-hidden bg-muted/5">
        <div class="px-4 py-3 border-b border-border/10 bg-background/50">
          <h4 class="text-xs font-black uppercase text-destructive flex items-center gap-2">
            <FileWarning class="h-3.5 w-3.5" />
            未使用索引详情
          </h4>
        </div>
        <ScrollArea class="max-h-[300px]">
          <table class="w-full text-left border-collapse">
            <thead class="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/20">
              <tr class="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest h-10">
                <th class="px-4">表名</th>
                <th class="px-4">索引名</th>
                <th class="px-4">索引列</th>
                <th class="px-4 text-right">预估大小</th>
                <th class="px-4 w-12"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/5">
              <tr v-for="(idx, i) in result.unusedIndexes" :key="i" class="text-xs hover:bg-primary/[0.03] transition-colors group">
                <td class="px-4 py-2 font-mono font-bold text-foreground/80">{{ idx.tableName }}</td>
                <td class="px-4 py-2 font-mono text-destructive">{{ idx.indexName }}</td>
                <td class="px-4 py-2 font-mono text-[11px] text-muted-foreground/60">{{ idx.indexColumns.join(', ') }}</td>
                <td class="px-4 py-2 text-right font-mono text-foreground/60">{{ idx.sizeEstimate }}</td>
                <td class="px-4 py-2">
                  <Button variant="ghost" size="icon" class="h-7 w-7 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" @click="copySql(idx.dropSql)" title="复制 DROP 语句">
                    <Copy class="h-3 w-3" />
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </ScrollArea>
      </div>

      <!-- 全部正常 -->
      <div v-if="redundantCount() === 0 && unusedCount() === 0" class="rounded-2xl border border-df-success/20 bg-df-success/5 p-6 text-center">
        <div class="text-df-success text-2xl mb-2">&#10003;</div>
        <p class="text-sm font-bold text-df-success">索引状态健康</p>
        <p class="text-[10px] text-muted-foreground/50 mt-1">未检测到冗余或未使用的索引</p>
      </div>
    </div>
  </div>
</template>
