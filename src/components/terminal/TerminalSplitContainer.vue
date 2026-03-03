<script setup lang="ts">
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import TerminalPanel from '@/components/terminal/TerminalPanelLazy.vue'

export interface SplitLayout {
  type: 'leaf' | 'horizontal' | 'vertical'
  // leaf
  id?: string
  connectionId?: string
  connectionName?: string
  // branch
  children?: SplitLayout[]
  sizes?: number[]
}

const props = defineProps<{
  layout: SplitLayout
  activeLeafId?: string
}>()

const emit = defineEmits<{
  'status-change': [status: string]
  'leaf-focus': [leafId: string]
  'leaf-close': [leafId: string]
}>()

function onStatusChange(status: string) {
  emit('status-change', status)
}

function onLeafFocus(leafId: string) {
  emit('leaf-focus', leafId)
}

function onLeafClose(leafId: string) {
  emit('leaf-close', leafId)
}

function handlePaneClick(leafId?: string) {
  if (leafId) {
    emit('leaf-focus', leafId)
  }
}
</script>

<template>
  <!-- Leaf node: render a terminal -->
  <div
    v-if="layout.type === 'leaf'"
    class="h-full w-full relative"
    :class="{ 'ring-1 ring-primary/50': activeLeafId === layout.id }"
    @click="handlePaneClick(layout.id)"
  >
    <TerminalPanel
      :connection-id="layout.connectionId!"
      :connection-name="layout.connectionName ?? ''"
      @status-change="onStatusChange"
    />
  </div>

  <!-- Horizontal split -->
  <Splitpanes
    v-else-if="layout.type === 'horizontal'"
    horizontal
    class="h-full"
  >
    <Pane
      v-for="(child, i) in layout.children"
      :key="child.id ?? i"
      :size="layout.sizes?.[i]"
    >
      <TerminalSplitContainer
        :layout="child"
        :active-leaf-id="activeLeafId"
        @status-change="onStatusChange"
        @leaf-focus="onLeafFocus"
        @leaf-close="onLeafClose"
      />
    </Pane>
  </Splitpanes>

  <!-- Vertical split -->
  <Splitpanes
    v-else-if="layout.type === 'vertical'"
    class="h-full"
  >
    <Pane
      v-for="(child, i) in layout.children"
      :key="child.id ?? i"
      :size="layout.sizes?.[i]"
    >
      <TerminalSplitContainer
        :layout="child"
        :active-leaf-id="activeLeafId"
        @status-change="onStatusChange"
        @leaf-focus="onLeafFocus"
        @leaf-close="onLeafClose"
      />
    </Pane>
  </Splitpanes>
</template>

<script lang="ts">
// 递归组件需要显式命名
export default { name: 'TerminalSplitContainer' }
</script>
