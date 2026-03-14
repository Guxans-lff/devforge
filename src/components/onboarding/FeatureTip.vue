<script setup lang="ts">
import { computed } from 'vue'
import { X, Lightbulb } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { useOnboarding } from '@/composables/useOnboarding'

const props = withDefaults(defineProps<{
  /** 引导步骤 ID */
  stepId: string
  /** 提示标题 */
  title: string
  /** 提示描述 */
  description: string
  /** 定位方向 */
  position?: 'top' | 'bottom' | 'left' | 'right'
}>(), {
  position: 'bottom',
})

const { isStepCompleted, completeStep, dismissAll } = useOnboarding()

/** 是否显示（未完成且未全局关闭） */
const visible = computed(() => !isStepCompleted(props.stepId))

function handleDismiss() {
  completeStep(props.stepId)
}

function handleDismissAll() {
  dismissAll()
}
</script>

<template>
  <div
    v-if="visible"
    class="absolute z-40 w-60 rounded-lg border border-primary/20 bg-popover p-3 shadow-lg animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
    :class="{
      'top-full mt-2': position === 'bottom',
      'bottom-full mb-2': position === 'top',
      'left-full ml-2': position === 'right',
      'right-full mr-2': position === 'left',
    }"
  >
    <!-- 标题 -->
    <div class="flex items-center gap-2 mb-1.5">
      <Lightbulb class="h-3.5 w-3.5 text-primary shrink-0" />
      <span class="text-xs font-bold text-foreground">{{ title }}</span>
      <button
        class="ml-auto h-4 w-4 shrink-0 rounded-sm flex items-center justify-center text-muted-foreground hover:text-foreground"
        @click="handleDismiss"
      >
        <X class="h-3 w-3" />
      </button>
    </div>

    <!-- 描述 -->
    <p class="text-[10px] text-muted-foreground leading-relaxed mb-2.5">
      {{ description }}
    </p>

    <!-- 操作 -->
    <div class="flex items-center gap-2">
      <Button
        variant="default"
        size="sm"
        class="h-6 px-2.5 text-[10px] font-bold"
        @click="handleDismiss"
      >
        {{ $t('onboarding.gotIt') }}
      </Button>
      <button
        class="text-[9px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        @click="handleDismissAll"
      >
        {{ $t('onboarding.dontShowAgain') }}
      </button>
    </div>
  </div>
</template>
