<script setup lang="ts">
import type { ListboxItemEmits, ListboxItemProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit, useCurrentElement } from "@vueuse/core"
import { ListboxItem, useForwardPropsEmits, useId } from "reka-ui"
import { computed, onMounted, onUnmounted, ref } from "vue"
import { cn } from "@/lib/utils"
import { useCommand, useCommandGroup } from "."

const props = defineProps<ListboxItemProps & { class?: HTMLAttributes["class"] }>()
const emits = defineEmits<ListboxItemEmits>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardPropsEmits(delegatedProps, emits)

const id = useId()
const { filterState, allItems, allGroups } = useCommand()
const groupContext = useCommandGroup()

const isRender = computed(() => {
  if (!filterState.search) {
    return true
  }
  else {
    const filteredCurrentItem = filterState.filtered.items.get(id)
    // If the filtered items is undefined means not in the all times map yet
    // Do the first render to add into the map
    if (filteredCurrentItem === undefined) {
      return true
    }

    // Check with filter
    return filteredCurrentItem > 0
  }
})

const itemRef = ref()
const currentElement = useCurrentElement(itemRef)
onMounted(() => {
  if (!(currentElement.value instanceof HTMLElement))
    return

  // textValue to perform filter
  allItems.value.set(id, currentElement.value.textContent ?? (props.value?.toString() ?? ""))

  const groupId = groupContext?.id
  if (groupId) {
    if (!allGroups.value.has(groupId)) {
      allGroups.value.set(groupId, new Set([id]))
    }
    else {
      allGroups.value.get(groupId)?.add(id)
    }
  }
})
onUnmounted(() => {
  allItems.value.delete(id)
})
</script>

<template>
  <ListboxItem
    v-if="isRender"
    v-bind="forwarded"
    :id="id"
    ref="itemRef"
    data-slot="command-item"
    :class="cn('group/item relative flex cursor-pointer items-center gap-4 rounded-md px-4 py-3 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4.5 transition-all duration-200 [&_svg:not([class*=\'text-\'])]:text-muted-foreground',
          'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground hover:bg-accent hover:text-accent-foreground',
          'data-[highlighted]:translate-x-1 hover:translate-x-1',
          'before:absolute before:left-0 before:top-1/2 before:h-6 before:w-1 before:-translate-y-1/2 before:rounded-full before:bg-primary before:opacity-0 transition-all duration-200 before:transition-opacity',
          'data-[highlighted]:before:opacity-100 hover:before:opacity-100',
          props.class)"
    @select="(e) => {
      filterState.search = ''
      emits('select', e)
    }"
  >
    <slot />
  </ListboxItem>
</template>
