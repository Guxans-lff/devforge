<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** 原始值（字符串或二进制） */
  value: string
}>()

/** 每行显示的字节数 */
const BYTES_PER_ROW = 16

/** 将字符串转为字节数组 */
const bytes = computed(() => {
  const encoder = new TextEncoder()
  return encoder.encode(props.value)
})

/** Hex 行数据 */
const hexRows = computed(() => {
  const rows: { offset: string; hex: string[]; ascii: string }[] = []
  const data = bytes.value

  for (let i = 0; i < data.length; i += BYTES_PER_ROW) {
    const slice = data.slice(i, i + BYTES_PER_ROW)
    const offset = i.toString(16).padStart(8, '0').toUpperCase()
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0').toUpperCase())
    const ascii = Array.from(slice).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.').join('')
    rows.push({ offset, hex, ascii })
  }
  return rows
})

const totalBytes = computed(() => bytes.value.length)
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex-1 overflow-auto p-2">
      <div class="font-mono text-xs leading-relaxed select-text">
        <!-- 表头 -->
        <div class="flex gap-3 text-muted-foreground/50 text-[10px] font-bold mb-1 border-b border-border/30 pb-1">
          <span class="w-[72px] shrink-0">偏移量</span>
          <span class="flex-1">十六进制</span>
          <span class="w-[136px] shrink-0">ASCII</span>
        </div>
        <!-- 数据行 -->
        <div
          v-for="(row, i) in hexRows"
          :key="i"
          class="flex gap-3 hover:bg-muted/20 rounded-sm py-0.5"
        >
          <!-- 偏移量 -->
          <span class="w-[72px] shrink-0 text-muted-foreground/40 tabular-nums">{{ row.offset }}</span>
          <!-- 十六进制 -->
          <span class="flex-1 tabular-nums">
            <template v-for="(byte, j) in row.hex" :key="j">
              <span class="text-blue-600 dark:text-blue-400">{{ byte }}</span>
              <span class="text-muted-foreground/20">{{ j === 7 ? '  ' : ' ' }}</span>
            </template>
          </span>
          <!-- ASCII -->
          <span class="w-[136px] shrink-0 text-green-600 dark:text-green-400">{{ row.ascii }}</span>
        </div>
      </div>
    </div>
    <div class="flex items-center gap-3 border-t border-border/50 px-3 py-1 text-[10px] text-muted-foreground shrink-0">
      <span>{{ totalBytes }} 字节</span>
      <span>{{ hexRows.length }} 行</span>
    </div>
  </div>
</template>
