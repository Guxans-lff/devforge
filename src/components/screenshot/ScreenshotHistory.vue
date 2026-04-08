<script setup lang="ts">
/**
 * 截图历史网格
 * 缩略图 + 操作按钮
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { convertFileSrc } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Trash2,
  Copy,
  ImageOff,
  Loader2,
} from 'lucide-vue-next'
import type { ScreenshotHistoryItem } from '@/types/screenshot'

const props = defineProps<{
  items: ScreenshotHistoryItem[]
  loading: boolean
}>()

const emit = defineEmits<{
  open: [item: ScreenshotHistoryItem]
  delete: [id: string]
  cleanup: [days?: number]
  copy: [item: ScreenshotHistoryItem]
}>()

const { t } = useI18n()

/** 图片加载失败的 id 集合 */
const brokenImages = ref(new Set<string>())

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 格式化时间 */
function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  return d.toLocaleDateString()
}

/** 获取图片 src（通过 Tauri asset 协议） */
function getImageSrc(filePath: string): string {
  return convertFileSrc(filePath)
}

function handleImageError(id: string) {
  brokenImages.value.add(id)
}
</script>

<template>
  <ScrollArea class="h-full">
    <div class="p-4">
      <!-- 加载状态 -->
      <div v-if="loading" class="flex items-center justify-center py-12">
        <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
      </div>

      <!-- 空状态 -->
      <div
        v-else-if="items.length === 0"
        class="flex flex-col items-center justify-center py-16 text-muted-foreground"
      >
        <ImageOff class="h-12 w-12 mb-3 opacity-30" />
        <p class="text-sm">{{ t('screenshot.history.empty') }}</p>
        <p class="text-xs mt-1 opacity-60">{{ t('screenshot.history.emptyHint') }}</p>
      </div>

      <!-- 历史网格 -->
      <template v-else>
        <!-- 清理按钮 -->
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {{ t('screenshot.history.title') }}
            <span class="ml-1 text-foreground/60">({{ items.length }})</span>
          </h3>
          <Button
            v-if="items.length > 0"
            variant="ghost"
            size="sm"
            class="text-xs h-7 text-destructive hover:text-destructive"
            @click="emit('cleanup', 0)"
          >
            {{ t('screenshot.history.cleanup') }}
          </Button>
        </div>

        <!-- 网格 -->
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          <div
            v-for="item in items"
            :key="item.id"
            class="group relative rounded-lg border border-border/50 bg-muted/20 overflow-hidden hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer"
            @click="emit('open', item)"
          >
            <!-- 缩略图 -->
            <div class="aspect-video bg-muted/50 overflow-hidden">
              <img
                v-if="!brokenImages.has(item.id)"
                :src="getImageSrc(item.filePath)"
                :alt="`Screenshot ${item.id}`"
                class="w-full h-full object-cover"
                loading="lazy"
                @error="handleImageError(item.id)"
              />
              <div v-else class="flex items-center justify-center h-full">
                <ImageOff class="h-6 w-6 text-muted-foreground/30" />
              </div>
            </div>

            <!-- 信息 -->
            <div class="px-2 py-1.5">
              <div class="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{{ item.width }}×{{ item.height }}</span>
                <span>{{ formatSize(item.fileSize) }}</span>
              </div>
              <div class="text-[10px] text-muted-foreground/60 mt-0.5">
                {{ formatTime(item.capturedAt) }}
              </div>
            </div>

            <!-- 悬浮操作按钮 -->
            <div
              class="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <button
                class="p-1 rounded bg-background/80 backdrop-blur-sm border border-border/50 hover:bg-accent text-muted-foreground hover:text-foreground"
                :title="t('screenshot.action.copy')"
                @click.stop="emit('copy', item)"
              >
                <Copy class="h-3 w-3" />
              </button>
              <button
                class="p-1 rounded bg-background/80 backdrop-blur-sm border border-border/50 hover:bg-accent text-muted-foreground hover:text-foreground"
                :title="t('screenshot.action.delete')"
                @click.stop="emit('delete', item.id)"
              >
                <Trash2 class="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>
  </ScrollArea>
</template>
