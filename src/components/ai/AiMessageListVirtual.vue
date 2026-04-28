<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import AiMessageBubble from '@/components/ai/AiMessageBubble.vue'
import type { AiMessage } from '@/types/ai'

interface MessageListItem {
  key: string
  message: AiMessage
  hideHeader?: boolean
  isGroupEnd?: boolean
  inGroup?: boolean
  stickyCompact?: boolean
}

const props = withDefaults(defineProps<{
  items: MessageListItem[]
  sessionId?: string
  isLoading?: boolean
  canLoadMoreHistory?: boolean
  historyRemainingRecords?: number
  historyLoadMorePending?: boolean
  historyLoadMoreError?: string | null
}>(), {
  sessionId: undefined,
  isLoading: false,
  canLoadMoreHistory: false,
  historyRemainingRecords: 0,
  historyLoadMorePending: false,
  historyLoadMoreError: null,
})

const emit = defineEmits<{
  (e: 'continue'): void
  (e: 'bumpMaxOutput', value: number): void
  (e: 'loadMoreHistory'): void
  (e: 'scroll', event: Event): void
}>()

const scrollContainer = ref<HTMLElement | null>(null)
const virtualItemEls = shallowRef<HTMLElement[]>([])
const { t } = useI18n()
const pendingMeasureIndexes = new Set<number>()
let measureRafId: number | null = null

function estimateItemHeight(item: MessageListItem): number {
  if (item.message.type === 'divider') return 44
  if (item.message.role === 'user') return item.stickyCompact ? 88 : 112
  if (item.message.role === 'error') return 120
  if ((item.message.toolCalls?.length ?? 0) > 0) return 260
  if (item.message.notice) return 140
  return 140
}

const virtualizer = useVirtualizer(computed(() => ({
  count: props.items.length,
  getScrollElement: () => scrollContainer.value,
  estimateSize: (index: number) => estimateItemHeight(props.items[index]!),
  overscan: 3,
  measureElement: (el: Element) => el.getBoundingClientRect().height,
})))

const virtualItems = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

let prevItemCount = 0
watch(() => props.items.length, (count) => {
  if (count > 0 && prevItemCount === 0 && scrollContainer.value?.clientHeight) {
    nextTick(() => {
      virtualizer.value.scrollToIndex(count - 1, { align: 'end' })
    })
  }
  prevItemCount = count
})

const stickyItem = computed(() => {
  for (let i = props.items.length - 1; i >= 0; i--) {
    const item = props.items[i]!
    if (item.message.role === 'user' && item.stickyCompact) return item
  }
  return null
})
const stickyItemIndex = computed(() =>
  stickyItem.value ? props.items.findIndex(item => item.key === stickyItem.value?.key) : -1,
)
const showStickyItem = computed(() => {
  const index = stickyItemIndex.value
  if (index < 0) return false
  const item = virtualItems.value.find(row => row.index === index)
  return Boolean(item && item.start < (scrollContainer.value?.scrollTop ?? 0))
})

function measureAllVisible(): void {
  for (const item of virtualItems.value) {
    scheduleMeasure(item.index)
  }
}

function scheduleMeasure(index: number): void {
  pendingMeasureIndexes.add(index)
  if (measureRafId !== null) return

  measureRafId = requestAnimationFrame(() => {
    measureRafId = null
    const indexes = Array.from(pendingMeasureIndexes)
    pendingMeasureIndexes.clear()

    for (const itemIndex of indexes) {
      const el = virtualItemEls.value[itemIndex]
      if (el?.isConnected) virtualizer.value.measureElement(el)
    }
  })
}

function setVirtualItemRef(index: number, el: Element | ComponentPublicInstance | null): void {
  if (!(el instanceof HTMLElement)) return
  virtualItemEls.value[index] = el
  scheduleMeasure(index)
}

function scrollToBottom(): void {
  if (props.items.length > 0) {
    virtualizer.value.scrollToIndex(props.items.length - 1, { align: 'end' })
  }
}

function getDividerText(message: AiMessage): string {
  if (message.dividerMeta?.kind === 'history-window') {
    return t('ai.history.windowLoaded', {
      loaded: message.dividerMeta.loadedRecords,
      total: message.dividerMeta.totalRecords,
    })
  }
  return message.dividerText ?? ''
}

const loadMoreButtonText = computed(() =>
  props.historyLoadMorePending
    ? t('ai.history.loadingMore')
    : t('ai.history.loadMore', { count: props.historyRemainingRecords }),
)

defineExpose({
  scrollToBottom,
  measureAllVisible,
  scrollContainer,
})

onBeforeUnmount(() => {
  if (measureRafId !== null) {
    cancelAnimationFrame(measureRafId)
    measureRafId = null
  }
  pendingMeasureIndexes.clear()
})
</script>

<template>
  <div ref="scrollContainer" class="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" @scroll="emit('scroll', $event)">
    <div
      v-if="showStickyItem && stickyItem"
      class="pointer-events-none absolute left-0 right-0 top-0 z-20 border-b border-border/20 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <AiMessageBubble
        :message="stickyItem.message"
        :session-id="sessionId"
        :sticky-compact="true"
        class="pointer-events-auto"
      />
    </div>

    <div
      :style="{ height: `${totalSize}px`, width: '100%', position: 'relative' }"
    >
      <div
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
        }"
      >
        <div
          v-for="virtualRow in virtualItems"
          :key="items[virtualRow.index]!.key"
          :data-index="virtualRow.index"
          :ref="el => setVirtualItemRef(virtualRow.index, el)"
          class="px-4 py-0.5"
        >
          <div
            v-if="items[virtualRow.index]!.message.type === 'divider'"
            class="flex items-center justify-center gap-3 py-1.5 select-none"
          >
            <div class="flex-1 h-px bg-border/40" />
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-[10px] text-muted-foreground/40 font-medium shrink-0">
                {{ getDividerText(items[virtualRow.index]!.message) }}
              </span>
              <Button
                v-if="items[virtualRow.index]!.message.dividerMeta?.kind === 'history-window' && canLoadMoreHistory"
                variant="ghost"
                size="sm"
                class="h-6 px-2 text-[10px] text-muted-foreground"
                :disabled="isLoading || historyLoadMorePending"
                @click="emit('loadMoreHistory')"
              >
                {{ loadMoreButtonText }}
              </Button>
              <span
                v-if="items[virtualRow.index]!.message.dividerMeta?.kind === 'history-window' && historyLoadMoreError"
                class="text-[10px] text-destructive/80"
              >
                {{ t('ai.history.loadMoreFailed') }}
              </span>
            </div>
            <div class="flex-1 h-px bg-border/40" />
          </div>

          <AiMessageBubble
            v-else
            :message="items[virtualRow.index]!.message"
            :session-id="sessionId"
            :hide-header="items[virtualRow.index]!.hideHeader"
            :is-group-end="items[virtualRow.index]!.isGroupEnd"
            :in-group="items[virtualRow.index]!.inGroup"
            :sticky-compact="items[virtualRow.index]!.stickyCompact"
            @continue="emit('continue')"
            @bump-max-output="emit('bumpMaxOutput', $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
