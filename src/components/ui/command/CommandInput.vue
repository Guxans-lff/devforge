<script setup lang="ts">
import type { ListboxFilterProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { Search } from "lucide-vue-next"
import { ListboxFilter, useForwardProps } from "reka-ui"
import { cn } from "@/lib/utils"
import { useCommand } from "."

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<ListboxFilterProps & {
  class?: HTMLAttributes["class"]
}>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)

const { filterState } = useCommand()
</script>

<template>
  <div
    data-slot="command-input-wrapper"
    :class="cn('flex items-center gap-3 border-b border-border bg-transparent px-2', $attrs.class)"
  >
    <Search class="size-3.5 shrink-0 text-muted-foreground/50 ml-1" />
    <ListboxFilter
      v-bind="forwardedProps"
      v-model="filterState.search"
      data-slot="command-input"
      auto-focus
      :class="cn('placeholder:text-muted-foreground/30 flex h-9 w-full bg-transparent py-2 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50 font-normal', props.class)"
    />
  </div>
</template>
