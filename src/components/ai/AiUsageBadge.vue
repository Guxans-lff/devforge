<script setup lang="ts">
/**
 * AI Token 用量徽章
 *
 * 显示当前会话的 token 用量和估算费用。
 */
import { computed } from 'vue'
import { Coins } from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const props = withDefaults(defineProps<{
  promptTokens?: number
  completionTokens?: number
  cacheReadTokens?: number
  maxContext?: number
  pricing?: { inputPer1m: number; outputPer1m: number; currency: string }
}>(), {
  promptTokens: 0,
  completionTokens: 0,
  cacheReadTokens: 0,
  maxContext: 0,
})

/** 总 token 数 */
const totalTokens = computed(() => props.promptTokens + props.completionTokens)

/** 用量百分比 */
const usagePercent = computed(() =>
  props.maxContext > 0 ? Math.min((totalTokens.value / props.maxContext) * 100, 100) : 0,
)

/** 进度条颜色 */
const barColor = computed(() => {
  if (usagePercent.value > 90) return 'bg-destructive'
  if (usagePercent.value > 70) return 'bg-df-warning'
  return 'bg-primary'
})

/** 估算费用 */
const estimatedCost = computed(() => {
  if (!props.pricing) return null
  const inputCost = (props.promptTokens / 1_000_000) * props.pricing.inputPer1m
  const outputCost = (props.completionTokens / 1_000_000) * props.pricing.outputPer1m
  return inputCost + outputCost
})

/** 格式化 token 数 */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
</script>

<template>
  <TooltipProvider :delay-duration="200">
    <Tooltip>
      <TooltipTrigger as-child>
        <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-default">
          <Coins class="h-3 w-3" />
          <span class="font-mono">{{ formatTokens(totalTokens) }}</span>
          <!-- 费用 -->
          <span v-if="estimatedCost != null" class="font-mono">
            ≈ {{ props.pricing?.currency === 'CNY' ? '¥' : '$' }}{{ estimatedCost.toFixed(4) }}
          </span>
          <!-- 进度条 -->
          <div v-if="maxContext > 0" class="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-300"
              :class="barColor"
              :style="{ width: `${usagePercent}%` }"
            />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" class="text-[11px]">
        <div class="space-y-0.5">
          <p>输入: {{ formatTokens(promptTokens) }} tokens</p>
          <p v-if="cacheReadTokens > 0" class="text-emerald-500">
            缓存命中: {{ formatTokens(cacheReadTokens) }} tokens
          </p>
          <p>输出: {{ formatTokens(completionTokens) }} tokens</p>
          <p v-if="maxContext > 0">上下文: {{ formatTokens(totalTokens) }} / {{ formatTokens(maxContext) }}</p>
          <p v-if="estimatedCost != null">
            估算费用: {{ props.pricing?.currency === 'CNY' ? '¥' : '$' }}{{ estimatedCost.toFixed(6) }}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
