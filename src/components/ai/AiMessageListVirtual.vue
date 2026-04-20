<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
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
}>(), {
  sessionId: undefined,
  isLoading: false,
  canLoadMoreHistory: false,
})

const emit = defineEmits<{
  (e: 'continue'): void
  (e: 'bumpMaxOutput', value: number): void
  (e: 'loadMoreHistory'): void
  (e: 'scroll', event: Event): void
}>()

const scrollContainer = ref<HTMLElement | null>(null)
const virtualItemEls = shallowRef<HTMLElement[]>([])

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
  overscan: 6,
  measureElement: (el: Element) => el.getBoundingClientRect().height,
})))

const virtualItems = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())
const stickyItem = computed(() =>
  [...props.items].reverse().find(item => item.message.role === 'user' && item.stickyCompact) ?? null,
)

function measureAllVisible(): void {
  nextTick(() => {
    for (const item of virtualItems.value) {
      const el = virtualItemEls.value[item.index]
      if (el) virtualizer.value.measureElement(el)
    }
  })
}

function setVirtualItemRef(index: number, el: Element | ComponentPublicInstance | null): void {
  if (!(el instanceof HTMLElement)) return
  virtualItemEls.value[index] = el
  virtualizer.value.measureElement(el)
}

function scrollToBottom(): void {
  const container = scrollContainer.value
  if (!container) return
  nextTick(() => {
    container.scrollTop = container.scrollHeight
    requestAnimationFrame(() => {
      const latest = scrollContainer.value
      if (latest) latest.scrollTop = latest.scrollHeight
    })
  })
}

defineExpose({
  scrollToBottom,
  measureAllVisible,
  scrollContainer,
})
</script>

<template>
  <div ref="scrollContainer" class="min-h-0 flex-1 overflow-y-auto" @scroll="emit('scroll', $event)">
    <div
      v-if="stickyItem"
      class="sticky top-0 z-20 border-b border-border/20 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <AiMessageBubble
        :message="stickyItem.message"
        :session-id="sessionId"
        :sticky-compact="true"
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
                {{ items[virtualRow.index]!.message.dividerText }}
              </span>
              <Button
                v-if="items[virtualRow.index]!.message.id.startsWith('history-window-') && canLoadMoreHistory"
                variant="ghost"
                size="sm"
                class="h-6 px-2 text-[10px] text-muted-foreground"
                :disabled="isLoading"
                @click="emit('loadMoreHistory')"
              >
                加载更早历史
              </Button>
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
