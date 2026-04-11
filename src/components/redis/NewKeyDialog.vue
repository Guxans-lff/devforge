<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { redisSetString, redisHashSet, redisListPush, redisSetAdd, redisZsetAdd, redisStreamAdd } from '@/api/redis'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'

const props = defineProps<{
  open: boolean
  connectionId: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  created: [key: string]
}>()

const { t } = useI18n()
const toast = useToast()

const keyName = ref('')
const keyType = ref('string')
const value = ref('')
const ttl = ref('')
const saving = ref(false)

watch(() => props.open, (open) => {
  if (open) {
    keyName.value = ''
    keyType.value = 'string'
    value.value = ''
    ttl.value = ''
  }
})

async function handleCreate() {
  const key = keyName.value.trim()
  if (!key) return
  saving.value = true
  try {
    const ttlNum = parseInt(ttl.value) || undefined
    switch (keyType.value) {
      case 'string':
        await redisSetString(props.connectionId, key, value.value || '', ttlNum)
        break
      case 'hash':
        await redisHashSet(props.connectionId, key, 'field1', value.value || '')
        break
      case 'list':
        await redisListPush(props.connectionId, key, [value.value || ''], false)
        break
      case 'set':
        await redisSetAdd(props.connectionId, key, [value.value || 'member1'])
        break
      case 'zset':
        await redisZsetAdd(props.connectionId, key, value.value || 'member1', 0)
        break
      case 'stream':
        await redisStreamAdd({
          connectionId: props.connectionId,
          key,
          fields: [['field1', value.value || 'value1']],
        })
        break
    }
    emit('created', key)
    emit('update:open', false)
    toast.success(t('redis.createSuccess'))
  } catch (e: unknown) {
    toast.error(t('redis.createFailed'), parseBackendError(e).message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[420px] p-0 overflow-hidden border border-border/40 shadow-2xl rounded-2xl bg-background/98 backdrop-blur-3xl">
      <DialogHeader class="px-5 pt-5 pb-3">
        <DialogTitle class="text-sm font-bold">{{ t('redis.createKey') }}</DialogTitle>
      </DialogHeader>

      <div class="space-y-4 px-5 pb-2">
        <!-- 键名 -->
        <div class="space-y-1.5">
          <Label class="text-[11px] font-bold text-muted-foreground/70">{{ t('redis.keyName') }}</Label>
          <Input v-model="keyName" placeholder="mykey" class="h-8 text-[12px] font-mono" autofocus />
        </div>

        <!-- 类型 -->
        <div class="space-y-1.5">
          <Label class="text-[11px] font-bold text-muted-foreground/70">{{ t('redis.keyType') }}</Label>
          <Select v-model="keyType">
            <SelectTrigger class="h-8 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="string">String</SelectItem>
              <SelectItem value="hash">Hash</SelectItem>
              <SelectItem value="list">List</SelectItem>
              <SelectItem value="set">Set</SelectItem>
              <SelectItem value="zset">Sorted Set</SelectItem>
              <SelectItem value="stream">Stream</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 初始值 -->
        <div class="space-y-1.5">
          <Label class="text-[11px] font-bold text-muted-foreground/70">{{ t('redis.initialValue') }}</Label>
          <Input v-model="value" :placeholder="t('redis.initialValueHint')" class="h-8 text-[12px] font-mono" />
        </div>

        <!-- TTL -->
        <div class="space-y-1.5">
          <Label class="text-[11px] font-bold text-muted-foreground/70">
            TTL
            <span class="text-muted-foreground/30 font-normal">({{ t('redis.optional') }})</span>
          </Label>
          <Input v-model="ttl" type="number" :placeholder="t('redis.ttlPlaceholder')" class="h-8 text-[12px] font-mono w-32" />
        </div>
      </div>

      <div class="flex justify-end gap-2 px-5 py-4 border-t border-border/20">
        <Button variant="ghost" size="sm" @click="emit('update:open', false)">{{ t('common.cancel') }}</Button>
        <Button size="sm" :disabled="!keyName.trim() || saving" @click="handleCreate">
          {{ t('redis.create') }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
