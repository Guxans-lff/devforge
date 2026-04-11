<script setup lang="ts">
/**
 * ExplainComparePanel - EXPLAIN 执行计划对比面板（独家功能）
 * 从 KV 存储加载历史保存的执行计划，左右对比分析性能变化
 */
import { ref, computed, onMounted } from 'vue'
import { listAppState, deleteAppState } from '@/api/app-state'
import type { AppStateRecord } from '@/api/app-state'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { useMessage } from '@/stores/message-center'
import { RefreshCw, GitCompare, Trash2, ArrowRight, TrendingUp, TrendingDown, Minus } from 'lucide-vue-next'

interface SavedPlan {
  id: string
  sql: string
  connectionId: string
  database: string
  result: Record<string, unknown>
  summary: PlanSummary | null
  savedAt: string
}

interface PlanSummary {
  totalCost: number | null
  totalRows: number
  tableCount: number
  fullScanCount: number
  indexUsedCount: number
  warnings: string[]
}

const message = useMessage()
const plans = ref<SavedPlan[]>([])
const isLoading = ref(false)

/** 选中的左右两个计划 */
const leftPlanId = ref<string | null>(null)
const rightPlanId = ref<string | null>(null)

const leftPlan = computed(() => plans.value.find(p => p.id === leftPlanId.value) ?? null)
const rightPlan = computed(() => plans.value.find(p => p.id === rightPlanId.value) ?? null)

/** 加载所有已保存的执行计划 */
async function loadPlans() {
  isLoading.value = true
  try {
    const records: AppStateRecord[] = await listAppState('explain_plan:')
    plans.value = records
      .map(r => {
        try { return JSON.parse(r.value) as SavedPlan } catch { return null }
      })
      .filter((p): p is SavedPlan => p !== null)
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
  } catch (e) {
    message.error('加载执行计划失败: ' + e)
  } finally {
    isLoading.value = false
  }
}

/** 删除某个保存的计划 */
async function deletePlan(id: string) {
  try {
    await deleteAppState(id)
    plans.value = plans.value.filter(p => p.id !== id)
    if (leftPlanId.value === id) leftPlanId.value = null
    if (rightPlanId.value === id) rightPlanId.value = null
    message.success('已删除')
  } catch (e) {
    message.error('删除失败: ' + e)
  }
}

/** 对比指标变化方向 */
function delta(left: number | null | undefined, right: number | null | undefined): 'better' | 'worse' | 'same' | 'na' {
  if (left == null || right == null) return 'na'
  if (left < right) return 'better'
  if (left > right) return 'worse'
  return 'same'
}

/** 格式化日期 */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

onMounted(() => { loadPlans() })
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden px-6 pt-4">
    <!-- 标题栏 -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="p-2 rounded-xl bg-primary/10 text-primary shadow-sm">
          <GitCompare class="h-5 w-5" />
        </div>
        <div>
          <h3 class="text-sm font-black tracking-tight uppercase">执行计划对比 (Plan Compare)</h3>
          <p class="text-[10px] text-muted-foreground/40 font-medium">选择两个已保存的 EXPLAIN 计划进行对比分析</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold px-3 py-1 rounded-full bg-muted border border-border/10 text-muted-foreground">
          {{ plans.length }} 个已保存计划
        </span>
        <Button size="icon" variant="ghost" class="h-8 w-8 rounded-full" @click="loadPlans">
          <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isLoading }" />
        </Button>
      </div>
    </div>

    <!-- 无计划提示 -->
    <div v-if="plans.length === 0 && !isLoading" class="flex-1 flex items-center justify-center">
      <div class="text-center opacity-30">
        <GitCompare class="mx-auto h-12 w-12 mb-3" />
        <p class="text-xs font-black uppercase tracking-widest">暂无保存的执行计划</p>
        <p class="text-[10px] mt-1">在 EXPLAIN 面板中点击"保存计划"按钮保存执行计划</p>
      </div>
    </div>

    <!-- 有计划时的对比界面 -->
    <div v-else class="flex-1 flex flex-col overflow-hidden gap-4">
      <!-- 选择器 -->
      <div class="grid grid-cols-2 gap-4">
        <!-- 左侧：基准计划 -->
        <div class="rounded-xl border border-border/20 bg-card/30 p-3">
          <div class="text-[10px] font-black uppercase text-muted-foreground/60 mb-2">基准计划 (Before)</div>
          <select
            v-model="leftPlanId"
            aria-label="基准计划 (Before)"
            class="w-full h-8 rounded-lg border border-border/20 bg-muted/20 px-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option :value="null">选择计划...</option>
            <option v-for="p in plans" :key="p.id" :value="p.id">
              [{{ formatDate(p.savedAt) }}] {{ p.sql.slice(0, 60) }}{{ p.sql.length > 60 ? '...' : '' }}
            </option>
          </select>
        </div>
        <!-- 右侧：对比计划 -->
        <div class="rounded-xl border border-border/20 bg-card/30 p-3">
          <div class="text-[10px] font-black uppercase text-muted-foreground/60 mb-2">对比计划 (After)</div>
          <select
            v-model="rightPlanId"
            aria-label="对比计划 (After)"
            class="w-full h-8 rounded-lg border border-border/20 bg-muted/20 px-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option :value="null">选择计划...</option>
            <option v-for="p in plans" :key="p.id" :value="p.id">
              [{{ formatDate(p.savedAt) }}] {{ p.sql.slice(0, 60) }}{{ p.sql.length > 60 ? '...' : '' }}
            </option>
          </select>
        </div>
      </div>

      <!-- 对比结果 -->
      <div v-if="leftPlan && rightPlan" class="flex-1 overflow-auto space-y-4">
        <!-- 核心指标对比 -->
        <div class="rounded-2xl border border-border/20 bg-card/30 p-5">
          <h4 class="text-xs font-black uppercase text-muted-foreground/80 mb-4">核心指标对比</h4>
          <div class="grid grid-cols-5 gap-4">
            <!-- 总成本 -->
            <div class="text-center">
              <div class="text-[10px] text-muted-foreground/50 mb-1">总成本</div>
              <div class="flex items-center justify-center gap-2">
                <span class="text-sm font-mono font-bold">{{ leftPlan.summary?.totalCost?.toFixed(2) ?? '-' }}</span>
                <ArrowRight class="h-3 w-3 text-muted-foreground/30" />
                <span
                  class="text-sm font-mono font-bold"
                  :class="{
                    'text-df-success': delta(rightPlan.summary?.totalCost, leftPlan.summary?.totalCost) === 'better',
                    'text-destructive': delta(rightPlan.summary?.totalCost, leftPlan.summary?.totalCost) === 'worse',
                  }"
                >
                  {{ rightPlan.summary?.totalCost?.toFixed(2) ?? '-' }}
                </span>
                <TrendingDown v-if="delta(rightPlan.summary?.totalCost, leftPlan.summary?.totalCost) === 'better'" class="h-3 w-3 text-df-success" />
                <TrendingUp v-else-if="delta(rightPlan.summary?.totalCost, leftPlan.summary?.totalCost) === 'worse'" class="h-3 w-3 text-destructive" />
                <Minus v-else class="h-3 w-3 text-muted-foreground/30" />
              </div>
            </div>
            <!-- 扫描行数 -->
            <div class="text-center">
              <div class="text-[10px] text-muted-foreground/50 mb-1">扫描行数</div>
              <div class="flex items-center justify-center gap-2">
                <span class="text-sm font-mono font-bold">{{ leftPlan.summary?.totalRows?.toLocaleString() ?? '-' }}</span>
                <ArrowRight class="h-3 w-3 text-muted-foreground/30" />
                <span
                  class="text-sm font-mono font-bold"
                  :class="{
                    'text-df-success': delta(rightPlan.summary?.totalRows, leftPlan.summary?.totalRows) === 'better',
                    'text-destructive': delta(rightPlan.summary?.totalRows, leftPlan.summary?.totalRows) === 'worse',
                  }"
                >
                  {{ rightPlan.summary?.totalRows?.toLocaleString() ?? '-' }}
                </span>
                <TrendingDown v-if="delta(rightPlan.summary?.totalRows, leftPlan.summary?.totalRows) === 'better'" class="h-3 w-3 text-df-success" />
                <TrendingUp v-else-if="delta(rightPlan.summary?.totalRows, leftPlan.summary?.totalRows) === 'worse'" class="h-3 w-3 text-destructive" />
                <Minus v-else class="h-3 w-3 text-muted-foreground/30" />
              </div>
            </div>
            <!-- 涉及表数 -->
            <div class="text-center">
              <div class="text-[10px] text-muted-foreground/50 mb-1">涉及表数</div>
              <div class="flex items-center justify-center gap-2">
                <span class="text-sm font-mono font-bold">{{ leftPlan.summary?.tableCount ?? '-' }}</span>
                <ArrowRight class="h-3 w-3 text-muted-foreground/30" />
                <span class="text-sm font-mono font-bold">{{ rightPlan.summary?.tableCount ?? '-' }}</span>
              </div>
            </div>
            <!-- 全表扫描数 -->
            <div class="text-center">
              <div class="text-[10px] text-muted-foreground/50 mb-1">全表扫描</div>
              <div class="flex items-center justify-center gap-2">
                <span class="text-sm font-mono font-bold" :class="(leftPlan.summary?.fullScanCount ?? 0) > 0 ? 'text-destructive' : 'text-df-success'">
                  {{ leftPlan.summary?.fullScanCount ?? '-' }}
                </span>
                <ArrowRight class="h-3 w-3 text-muted-foreground/30" />
                <span class="text-sm font-mono font-bold" :class="(rightPlan.summary?.fullScanCount ?? 0) > 0 ? 'text-destructive' : 'text-df-success'">
                  {{ rightPlan.summary?.fullScanCount ?? '-' }}
                </span>
                <TrendingDown v-if="delta(rightPlan.summary?.fullScanCount, leftPlan.summary?.fullScanCount) === 'better'" class="h-3 w-3 text-df-success" />
                <TrendingUp v-else-if="delta(rightPlan.summary?.fullScanCount, leftPlan.summary?.fullScanCount) === 'worse'" class="h-3 w-3 text-destructive" />
                <Minus v-else class="h-3 w-3 text-muted-foreground/30" />
              </div>
            </div>
            <!-- 索引使用率 -->
            <div class="text-center">
              <div class="text-[10px] text-muted-foreground/50 mb-1">索引使用</div>
              <div class="flex items-center justify-center gap-2">
                <span class="text-sm font-mono font-bold">
                  {{ leftPlan.summary?.indexUsedCount ?? 0 }}/{{ leftPlan.summary?.tableCount ?? 0 }}
                </span>
                <ArrowRight class="h-3 w-3 text-muted-foreground/30" />
                <span class="text-sm font-mono font-bold">
                  {{ rightPlan.summary?.indexUsedCount ?? 0 }}/{{ rightPlan.summary?.tableCount ?? 0 }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- SQL 对比 -->
        <div class="grid grid-cols-2 gap-4">
          <div class="rounded-xl border border-border/20 bg-muted/5 p-3">
            <div class="text-[10px] font-black uppercase text-muted-foreground/50 mb-2">SQL (Before)</div>
            <pre class="text-[11px] font-mono text-foreground/80 whitespace-pre-wrap break-all leading-relaxed">{{ leftPlan.sql }}</pre>
            <div class="text-[10px] text-muted-foreground/30 mt-2">{{ formatDate(leftPlan.savedAt) }} · {{ leftPlan.database }}</div>
          </div>
          <div class="rounded-xl border border-border/20 bg-muted/5 p-3">
            <div class="text-[10px] font-black uppercase text-muted-foreground/50 mb-2">SQL (After)</div>
            <pre class="text-[11px] font-mono text-foreground/80 whitespace-pre-wrap break-all leading-relaxed">{{ rightPlan.sql }}</pre>
            <div class="text-[10px] text-muted-foreground/30 mt-2">{{ formatDate(rightPlan.savedAt) }} · {{ rightPlan.database }}</div>
          </div>
        </div>

        <!-- JSON 对比 -->
        <div class="grid grid-cols-2 gap-4">
          <div class="rounded-xl border border-border/20 bg-muted/5 p-3">
            <div class="text-[10px] font-black uppercase text-muted-foreground/50 mb-2">EXPLAIN JSON (Before)</div>
            <ScrollArea class="max-h-[400px]">
              <pre class="text-[10px] font-mono text-foreground/60 whitespace-pre-wrap break-all leading-relaxed">{{ JSON.stringify(leftPlan.result, null, 2) }}</pre>
            </ScrollArea>
          </div>
          <div class="rounded-xl border border-border/20 bg-muted/5 p-3">
            <div class="text-[10px] font-black uppercase text-muted-foreground/50 mb-2">EXPLAIN JSON (After)</div>
            <ScrollArea class="max-h-[400px]">
              <pre class="text-[10px] font-mono text-foreground/60 whitespace-pre-wrap break-all leading-relaxed">{{ JSON.stringify(rightPlan.result, null, 2) }}</pre>
            </ScrollArea>
          </div>
        </div>
      </div>

      <!-- 未选择对比计划时显示历史列表 -->
      <div v-if="!leftPlan || !rightPlan" class="flex-1 overflow-auto">
        <div class="text-[10px] font-black uppercase text-muted-foreground/50 mb-2">已保存的执行计划</div>
        <div class="space-y-2">
          <div
            v-for="p in plans"
            :key="p.id"
            class="flex items-center gap-3 rounded-xl border border-border/10 bg-muted/5 px-4 py-3 group hover:bg-primary/[0.03] transition-colors"
          >
            <div class="flex-1 min-w-0">
              <div class="text-xs font-mono text-foreground/80 truncate">{{ p.sql }}</div>
              <div class="flex items-center gap-3 mt-1">
                <span class="text-[10px] text-muted-foreground/40">{{ formatDate(p.savedAt) }}</span>
                <span v-if="p.database" class="text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border/10 text-muted-foreground/60">{{ p.database }}</span>
                <span v-if="p.summary" class="text-[10px] text-muted-foreground/40">
                  cost: {{ p.summary.totalCost?.toFixed(2) ?? '-' }} · rows: {{ p.summary.totalRows?.toLocaleString() ?? '-' }}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              @click="deletePlan(p.id)"
            >
              <Trash2 class="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
