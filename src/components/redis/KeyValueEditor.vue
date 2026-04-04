<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Trash2, Edit3, Clock, Save } from 'lucide-vue-next'
import StringEditor from './StringEditor.vue'
import HashEditor from './HashEditor.vue'
import ListEditor from './ListEditor.vue'
import SetEditor from './SetEditor.vue'
import ZSetEditor from './ZSetEditor.vue'
import StreamEditor from './StreamEditor.vue'
import { redisDeleteKeys, redisRenameKey, redisSetTtl, redisRemoveTtl } from '@/api/redis'
import { useToast } from '@/composables/useToast'
import type { RedisKeyInfo } from '@/types/redis'

const props = defineProps<{
  connectionId: string
  redisKey: string
  keyInfo: RedisKeyInfo
}>()

const emit = defineEmits<{
  deleted: []
  renamed: [newKey: string]
  refresh: []
}>()

const { t } = useI18n()
const toast = useToast()

// TTL 编辑
const ttlEditing = ref(false)
const ttlInput = ref('')
const localKeyInfo = ref<RedisKeyInfo>({ ...props.keyInfo })

// 重命名
const renaming = ref(false)
const renameInput = ref('')

watch(() => props.keyInfo, (info) => {
  localKeyInfo.value = { ...info }
}, { immediate: true })

const ttlDisplay = computed(() => {
  const ttl = localKeyInfo.value.ttl
  if (ttl === -1) return t('redis.noExpiry')
  if (ttl === -2) return t('redis.keyExpired')
  if (ttl >= 86400) return `${Math.floor(ttl / 86400)}d ${Math.floor((ttl % 86400) / 3600)}h`
  if (ttl >= 3600) return `${Math.floor(ttl / 3600)}h ${Math.floor((ttl % 3600) / 60)}m`
  if (ttl >= 60) return `${Math.floor(ttl / 60)}m ${ttl % 60}s`
  return `${ttl}s`
})

const typeColors: Record<string, string> = {
  string: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  hash: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  list: 'bg-green-500/15 text-green-400 border-green-500/30',
  set: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  zset: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
  stream: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
}

/** 删除键 */
async function handleDelete() {
  try {
    await redisDeleteKeys(props.connectionId, [props.redisKey])
    toast.success('键已删除')
    emit('deleted')
  } catch (e) {
    toast.error('删除失败', (e as any)?.message ?? String(e))
  }
}

/** 重命名 */
async function handleRename() {
  const newKey = renameInput.value.trim()
  if (!newKey || newKey === props.redisKey) {
    renaming.value = false
    return
  }
  try {
    await redisRenameKey(props.connectionId, props.redisKey, newKey)
    renaming.value = false
    toast.success('重命名成功')
    emit('renamed', newKey)
  } catch (e) {
    toast.error('重命名失败', (e as any)?.message ?? String(e))
  }
}

/** 设置 TTL */
async function handleSetTtl() {
  const seconds = parseInt(ttlInput.value)
  if (isNaN(seconds) || seconds < 0) {
    ttlEditing.value = false
    return
  }
  try {
    if (seconds === 0) {
      await redisRemoveTtl(props.connectionId, props.redisKey)
      // 本地更新 TTL 为 -1（永不过期），避免冗余 API 调用
      localKeyInfo.value = { ...localKeyInfo.value, ttl: -1 }
    } else {
      await redisSetTtl(props.connectionId, props.redisKey, seconds)
      // 本地更新 TTL 为设置的值
      localKeyInfo.value = { ...localKeyInfo.value, ttl: seconds }
    }
    ttlEditing.value = false
  } catch (e) {
    toast.error('设置 TTL 失败', (e as any)?.message ?? String(e))
  }
}

function startRename() {
  renameInput.value = props.redisKey
  renaming.value = true
}

function startEditTtl() {
  ttlInput.value = localKeyInfo.value.ttl > 0 ? String(localKeyInfo.value.ttl) : ''
  ttlEditing.value = true
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 键信息头部 -->
    <div class="px-4 py-3 border-b border-border/30 bg-muted/5 space-y-2 shrink-0">
      <!-- 键名 -->
      <div class="flex items-center gap-2">
        <template v-if="renaming">
          <Input
            v-model="renameInput"
            class="h-8 text-xs font-mono flex-1"
            @keydown.enter="handleRename"
            @keydown.escape="renaming = false"
            autofocus
          />
          <Button variant="ghost" size="sm" class="h-7 px-2" @click="handleRename">
            <Save class="h-3.5 w-3.5" />
          </Button>
        </template>
        <template v-else>
          <span class="text-sm font-mono font-bold text-foreground truncate flex-1" :title="redisKey">{{ redisKey }}</span>
          <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="startRename">
            <Edit3 class="h-3 w-3 text-muted-foreground/50" />
          </Button>
        </template>
      </div>

      <!-- 元信息 -->
      <div class="flex items-center gap-3 text-xs">
        <Badge variant="outline" class="text-xs font-semibold px-2 py-0.5" :class="typeColors[localKeyInfo.keyType] || ''">
          {{ localKeyInfo.keyType.toUpperCase() }}
        </Badge>

        <!-- TTL -->
        <div class="flex items-center gap-1.5 text-muted-foreground/70">
          <Clock class="h-3.5 w-3.5" />
          <template v-if="ttlEditing">
            <Input
              v-model="ttlInput"
              type="number"
              placeholder="0 = 永不过期"
              class="h-7 w-28 text-xs font-mono"
              @keydown.enter="handleSetTtl"
              @keydown.escape="ttlEditing = false"
              autofocus
            />
            <Button variant="ghost" size="sm" class="h-7 px-1.5" @click="handleSetTtl">
              <Save class="h-3.5 w-3.5" />
            </Button>
          </template>
          <template v-else>
            <span class="cursor-pointer hover:text-foreground transition-colors" @click="startEditTtl">{{ ttlDisplay }}</span>
          </template>
        </div>

        <!-- 大小 -->
        <span v-if="localKeyInfo.memoryUsage" class="text-muted-foreground/50 font-mono">
          {{ localKeyInfo.memoryUsage > 1024 ? `${(localKeyInfo.memoryUsage / 1024).toFixed(1)}KB` : `${localKeyInfo.memoryUsage}B` }}
        </span>

        <span class="text-muted-foreground/50 font-mono">
          {{ t('redis.size') }}: {{ localKeyInfo.size }}
        </span>

        <div class="flex-1" />

        <Button variant="ghost" size="sm" class="h-7 px-2 text-xs text-destructive/60 hover:text-destructive" @click="handleDelete">
          <Trash2 class="h-3.5 w-3.5 mr-1" />
          {{ t('redis.deleteKey') }}
        </Button>
      </div>
    </div>

    <!-- 类型编辑器 -->
    <div class="flex-1 min-h-0 overflow-auto">
      <StringEditor
        v-if="localKeyInfo.keyType === 'string'"
        :connection-id="connectionId"
        :redis-key="redisKey"
      />
      <HashEditor
        v-else-if="localKeyInfo.keyType === 'hash'"
        :connection-id="connectionId"
        :redis-key="redisKey"
      />
      <ListEditor
        v-else-if="localKeyInfo.keyType === 'list'"
        :connection-id="connectionId"
        :redis-key="redisKey"
        :total="localKeyInfo.size"
      />
      <SetEditor
        v-else-if="localKeyInfo.keyType === 'set'"
        :connection-id="connectionId"
        :redis-key="redisKey"
      />
      <ZSetEditor
        v-else-if="localKeyInfo.keyType === 'zset'"
        :connection-id="connectionId"
        :redis-key="redisKey"
      />
      <StreamEditor
        v-else-if="localKeyInfo.keyType === 'stream'"
        :connection-id="connectionId"
        :redis-key="redisKey"
        :total="localKeyInfo.size"
        @refresh="emit('refresh')"
      />
      <div v-else class="p-4 text-sm text-muted-foreground">
        {{ t('redis.unsupportedType') }}: {{ localKeyInfo.keyType }}
      </div>
    </div>
  </div>
</template>
