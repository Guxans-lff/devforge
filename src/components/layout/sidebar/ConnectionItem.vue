<script setup lang="ts">
/**
 * 连接项组件 — 从 Sidebar.vue 提取的可复用连接展示单元
 * 包含：图标卡片、LED 状态灯、名称/环境标记、右键菜单
 * 同时承载 P0 键盘可操作性、P1 design tokens、P1-3 语义化、P2-3 精确过渡
 */
import {
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

// 类型颜色 — 对齐 Welcome demo 的 6 类连接色
const typeDotClassMap: Record<string, string> = {
  database: 'df-conn-dot df-conn-dot-database',
  ssh: 'df-conn-dot df-conn-dot-ssh',
  sftp: 'df-conn-dot df-conn-dot-sftp',
  redis: 'df-conn-dot df-conn-dot-redis',
  git: 'df-conn-dot df-conn-dot-git',
}

const activeTypeDotClassMap: Record<string, string> = {
  database: 'df-conn-dot-active-database',
  ssh: 'df-conn-dot-active-ssh',
  sftp: 'df-conn-dot-active-sftp',
  redis: 'df-conn-dot-active-redis',
  git: 'df-conn-dot-active-git',
}

// 右侧元信息：优先端口，Git 展示 main/dev 等 host 片段，空则不显示
function getConnectionMeta(record: ConnectionRecord): string {
  if (record.type === 'git') {
    const segments = record.host.split(/[\\/]/).filter(Boolean)
    const lastSegment = segments.length > 0 ? segments[segments.length - 1] : ''
    return lastSegment || record.port?.toString() || ''
  }
  return record.port?.toString() || ''
}

const statusClassMap = {
  connected: 'df-conn-status-connected',
  connecting: 'df-conn-status-connecting',
  error: 'df-conn-status-error',
  disconnected: 'df-conn-status-disconnected',
} as const

function getStatusDotClass(status: string): string {
  return statusClassMap[status as keyof typeof statusClassMap] ?? statusClassMap.disconnected
}

/** 环境类型缩写 */
const ENV_SHORT_LABELS: Record<EnvironmentType, string> = {
  production: 'PROD',
  staging: 'STG',
  development: 'DEV',
  testing: 'TEST',
  local: 'LOCAL',
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

function dotClass(type: string): string {
  return typeDotClassMap[type] ?? 'df-conn-dot df-conn-dot-default'
}

function activeDotClass(type: string): string {
  return activeTypeDotClassMap[type] ?? 'df-conn-dot-active-default'
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
        class="group relative flex min-h-8 cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 mx-2 mb-0.5 outline-none transition-[background-color,color,opacity] duration-150 hover:bg-accent/70 focus-visible:ring-1 focus-visible:ring-ring"
        :class="[
          isActive ? 'bg-accent text-foreground' : '',
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
          class="absolute left-[-8px] top-2 bottom-2 w-[2px] rounded-r-full bg-primary transition-[scale,opacity] duration-300 origin-center"
          :class="isActive ? 'scale-y-100 opacity-100' : 'scale-y-0 opacity-0'"
        />

        <!-- 颜色标签指示条 -->
        <div
          v-if="conn.record.color"
          class="absolute right-1 top-1.5 bottom-1.5 w-[3px] rounded-full opacity-60"
          :style="{ backgroundColor: conn.record.color }"
        />

        <!-- 类型彩点 + 状态变体 -->
        <div
          class="relative flex h-4 w-4 shrink-0 items-center justify-center"
          :class="getStatusDotClass(conn.status)"
        >
          <span class="h-2 w-2 rounded-full transition-[box-shadow,background-color,border-color,opacity] duration-200" :class="[dotClass(conn.record.type), isActive ? activeDotClass(conn.record.type) : '']" />
        </div>

        <!-- 信息 -->
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-1.5">
            <p class="truncate text-[13px] font-medium tracking-tight text-foreground/90 transition-colors group-hover:text-foreground">{{ conn.record.name }}</p>
            <!-- 收藏星标 -->
            <Star v-if="isFavorite" class="h-[10px] w-[10px] shrink-0 text-df-warning fill-df-warning" />
            <!-- 环境标记 -->
            <span
              v-if="getRecordEnvironment(conn.record)"
              class="shrink-0 rounded px-1 h-3.5 text-[8px] font-bold uppercase tracking-wider inline-flex items-center justify-center ring-1 ring-inset ring-current/20 leading-none"
              :style="{
                color: ENV_PRESETS[getRecordEnvironment(conn.record)!].color,
                backgroundColor: ENV_PRESETS[getRecordEnvironment(conn.record)!].color + '18',
              }"
            >{{ ENV_SHORT_LABELS[getRecordEnvironment(conn.record)!] }}</span>
          </div>
        </div>

        <span class="shrink-0 font-mono text-[10.5px] leading-none text-muted-foreground/55 tabular-nums tracking-wide group-hover:text-muted-foreground">
          {{ getConnectionMeta(conn.record) }}
        </span>
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

<style scoped>
.df-conn-dot {
  display: block;
  border-radius: 9999px;
  border: 1px solid transparent;
}

.df-conn-dot-database { background: #ffb347; box-shadow: 0 0 0 2px rgba(255, 179, 71, 0.14); }
.df-conn-dot-ssh { background: #67d4f5; box-shadow: 0 0 0 2px rgba(103, 212, 245, 0.16); }
.df-conn-dot-sftp { background: #a899f2; box-shadow: 0 0 0 2px rgba(168, 153, 242, 0.14); }
.df-conn-dot-redis { background: #ff7a6b; box-shadow: 0 0 0 2px rgba(255, 122, 107, 0.16); }
.df-conn-dot-git { background: #f5a663; box-shadow: 0 0 0 2px rgba(245, 166, 99, 0.14); }
.df-conn-dot-default { background: rgb(var(--muted-foreground)); opacity: 0.6; }

.df-conn-dot-active-database { box-shadow: 0 0 0 3px rgba(255, 179, 71, 0.18); }
.df-conn-dot-active-ssh { box-shadow: 0 0 0 3px rgba(103, 212, 245, 0.18); }
.df-conn-dot-active-sftp { box-shadow: 0 0 0 3px rgba(168, 153, 242, 0.18); }
.df-conn-dot-active-redis { box-shadow: 0 0 0 3px rgba(255, 122, 107, 0.2); }
.df-conn-dot-active-git { box-shadow: 0 0 0 3px rgba(245, 166, 99, 0.18); }
.df-conn-dot-active-default { box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.08); }

.df-conn-status-connected .df-conn-dot {
  box-shadow: inherit, 0 0 8px currentColor;
}

.df-conn-status-connecting .df-conn-dot {
  animation: df-conn-pulse 1.5s ease-in-out infinite;
}

.df-conn-status-error .df-conn-dot {
  border-color: rgba(248, 113, 113, 0.8);
  box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.2);
}

.df-conn-status-disconnected .df-conn-dot {
  opacity: 0.45;
  box-shadow: none;
}

@keyframes df-conn-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.18); opacity: 0.7; }
}
</style>