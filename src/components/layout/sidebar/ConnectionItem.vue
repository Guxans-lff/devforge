<script setup lang="ts">
/**
 * 连接项组件 — 从 Sidebar.vue 提取的可复用连接展示单元
 * 包含：图标卡片、LED 状态灯、名称/环境标记、右键菜单
 * 同时承载 P0 键盘可操作性、P1 design tokens、P1-3 语义化、P2-3 精确过渡
 */
import {
  Database, Terminal, FolderOpen, Container, GitBranch,
  Plug, FlaskConical, Pencil, Copy, Trash2, Star, StarOff,
} from 'lucide-vue-next'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { ENV_PRESETS, type EnvironmentType } from '@/types/environment'
import { getEnvironment } from '@/api/connection'
import type { ConnectionRecord } from '@/api/connection'
import type { ConnectionState } from '@/stores/connections'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  conn: ConnectionState
  isActive: boolean
  isFavorite: boolean
  isDragging: boolean
  isDragOver: boolean
}>()

const emit = defineEmits<{
  open: [conn: ConnectionState]
  edit: [record: ConnectionRecord]
  duplicate: [record: ConnectionRecord]
  delete: [id: string, name: string]
  test: [id: string]
  toggleFavorite: [id: string]
  dragStart: [e: DragEvent, id: string]
  dragOver: [e: DragEvent, id: string]
  dragLeave: []
  drop: [e: DragEvent, id: string]
  dragEnd: []
}>()

// 类型图标映射
const typeIcons: Record<string, typeof Database> = {
  database: Database,
  ssh: Terminal,
  sftp: FolderOpen,
  redis: Container,
  git: GitBranch,
}

// 类型颜色 — 使用 design tokens
const typeBadgeColors: Record<string, string> = {
  database: 'text-blue-500',
  ssh: 'text-df-success',
  sftp: 'text-df-warning',
  redis: 'text-destructive',
  git: 'text-df-info',
}

// 状态颜色 — connected 使用 df-success token
const statusColors: Record<string, string> = {
  connected: 'bg-df-success shadow-[0_0_6px_var(--df-success)]',
  disconnected: 'bg-muted-foreground/30',
  connecting: 'bg-df-warning animate-[pulse_1.5s_ease-in-out_infinite]',
  error: 'bg-destructive shadow-[0_0_6px_rgba(239,68,68,0.5)]',
}

/** 环境类型缩写 */
const ENV_SHORT_LABELS: Record<EnvironmentType, string> = {
  production: 'PROD',
  staging: 'STG',
  development: 'DEV',
  testing: 'TEST',
  local: 'LOCAL',
}

/** 图标动画 class */
function iconAnimClass(status: string): string {
  if (status === 'connecting') return 'animate-spin'
  if (status === 'error') return 'text-destructive'
  return ''
}

/** 获取环境类型 */
function getRecordEnvironment(record: ConnectionRecord): EnvironmentType | null {
  if (record.type !== 'database') return null
  return getEnvironment(props.conn.parsedConfig) || null
}

/** P0: 键盘 Enter/Space 打开连接 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    emit('open', props.conn)
  }
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger>
      <!-- P0: role="option" + tabindex + keyboard handler; P2-3: 精确 transition 属性 -->
      <div
        role="option"
        :tabindex="0"
        :aria-selected="isActive"
        :aria-label="conn.record.name"
        class="group relative flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 mx-1.5 mb-[3px] transform-gpu will-change-transform transition-[background-color,box-shadow,opacity,scale] duration-300 hover:bg-accent active:scale-[0.98] outline-none focus-visible:ring-1 focus-visible:ring-ring"
        :class="[
          isActive ? 'bg-accent shadow-[inset_0_0_0_1px_rgba(var(--primary-rgb),0.2)]' : '',
          isDragging ? 'opacity-40 grayscale' : '',
          isDragOver ? 'bg-accent' : '',
        ]"
        draggable="true"
        @dragstart="emit('dragStart', $event, conn.record.id)"
        @dragover="emit('dragOver', $event, conn.record.id)"
        @dragleave="emit('dragLeave')"
        @drop="emit('drop', $event, conn.record.id)"
        @dragend="emit('dragEnd')"
        @dblclick="emit('open', conn)"
        @keydown="onKeydown"
      >
        <!-- 左侧激活指示条 -->
        <div
          class="absolute left-[-2px] top-2 bottom-2 w-[3px] rounded-full bg-primary transition-[scale,opacity] duration-500 transform-gpu origin-center"
          :class="isActive ? 'scale-y-100 opacity-100' : 'scale-y-0 opacity-0'"
        />

        <!-- 颜色标签指示条 -->
        <div
          v-if="conn.record.color"
          class="absolute right-1 top-1.5 bottom-1.5 w-[3px] rounded-full opacity-60"
          :style="{ backgroundColor: conn.record.color }"
        />

        <!-- 类型图标 + 状态 LED -->
        <div
          class="relative flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-b from-white to-zinc-100/80 dark:from-zinc-700/50 dark:to-zinc-800/50 shadow-[0_2px_5px_rgba(0,0,0,0.04),inset_0_0_0_1px_rgba(255,255,255,0.7),inset_0_-1px_0_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_2px_8px_rgba(0,0,0,0.3)] transition-[scale,box-shadow] duration-300 group-hover:scale-[1.02] group-hover:shadow-[0_4px_8px_rgba(0,0,0,0.08),inset_0_0_0_1px_rgba(255,255,255,1),inset_0_-1px_0_rgba(0,0,0,0.05)] dark:group-hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_4px_12px_rgba(0,0,0,0.5)]"
          :class="[typeBadgeColors[conn.record.type] ?? 'text-muted-foreground']"
        >
          <component :is="typeIcons[conn.record.type] ?? Database" class="h-[15px] w-[15px]" :class="iconAnimClass(conn.status)" />
          <!-- 镶嵌式 LED 状态灯 -->
          <div class="absolute -bottom-1 -right-1 flex h-[14px] w-[14px] items-center justify-center rounded-full border-[1.5px] border-background bg-background/50 backdrop-blur-sm shadow-[0_1px_2px_rgba(0,0,0,0.1)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
            <div class="relative h-[8px] w-[8px] rounded-full overflow-hidden" :class="statusColors[conn.status] ?? statusColors.disconnected">
              <div v-if="conn.status === 'connected'" class="absolute inset-0 rounded-full bg-df-success/70 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] opacity-75" />
            </div>
          </div>
        </div>

        <!-- 信息 -->
        <div class="min-w-0 flex-1 flex flex-col justify-center h-8 relative top-[-0.5px]">
          <div class="flex items-center gap-1.5 mb-[2px]">
            <p class="truncate text-[13px] font-semibold tracking-tight text-foreground/90 group-hover:text-primary transition-colors leading-none">{{ conn.record.name }}</p>
            <!-- 收藏星标 -->
            <Star v-if="isFavorite" class="h-[10px] w-[10px] shrink-0 text-df-warning fill-df-warning" />
            <!-- 环境标记 -->
            <span
              v-if="getRecordEnvironment(conn.record)"
              class="shrink-0 rounded-full px-1.5 h-3.5 text-[8px] font-extrabold uppercase tracking-widest inline-flex items-center justify-center ring-1 ring-inset ring-current/20 backdrop-blur-sm leading-none -translate-y-px"
              :style="{
                color: ENV_PRESETS[getRecordEnvironment(conn.record)!].color,
                backgroundColor: ENV_PRESETS[getRecordEnvironment(conn.record)!].color + '18',
              }"
            >{{ ENV_SHORT_LABELS[getRecordEnvironment(conn.record)!] }}</span>
          </div>
          <p class="truncate text-[10px] font-medium text-muted-foreground font-mono tracking-[0.02em] leading-none">{{ conn.record.host }}</p>
        </div>
      </div>
    </ContextMenuTrigger>

    <!-- 右键菜单 -->
    <ContextMenuContent class="w-52">
      <ContextMenuItem @click="emit('open', conn)">
        <Plug class="mr-2 h-4 w-4" />
        {{ t('connection.connect') }}
      </ContextMenuItem>
      <ContextMenuItem @click="emit('test', conn.record.id)">
        <FlaskConical class="mr-2 h-4 w-4" />
        {{ t('connection.testConnection') }}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @click="emit('edit', conn.record)">
        <Pencil class="mr-2 h-4 w-4" />
        {{ t('connection.edit') }}
      </ContextMenuItem>
      <ContextMenuItem @click="emit('duplicate', conn.record)">
        <Copy class="mr-2 h-4 w-4" />
        {{ t('connection.copyConnection') }}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @click="emit('toggleFavorite', conn.record.id)">
        <component :is="isFavorite ? StarOff : Star" class="mr-2 h-4 w-4" />
        {{ isFavorite ? t('connection.unfavorite') : t('connection.favorite') }}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        class="text-destructive focus:text-destructive"
        @click="emit('delete', conn.record.id, conn.record.name)"
      >
        <Trash2 class="mr-2 h-4 w-4" />
        {{ t('connection.delete') }}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
