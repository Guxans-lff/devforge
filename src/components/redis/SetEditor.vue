<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Plus, Trash2 } from 'lucide-vue-next'
import { redisSetMembers, redisSetAdd, redisSetRem } from '@/api/redis'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'

const props = defineProps<{
  connectionId: string
  redisKey: string
}>()

const { t } = useI18n()
const toast = useToast()

const members = ref<string[]>([])
const loading = ref(false)
const newMember = ref('')

async function loadMembers() {
  loading.value = true
  try {
    members.value = await redisSetMembers(props.connectionId, props.redisKey)
    members.value.sort()
  } catch (e: unknown) {
    toast.error(t('redis.loadSetFailed'), parseBackendError(e).message)
  } finally {
    loading.value = false
  }
}

async function handleAdd() {
  const val = newMember.value.trim()
  if (!val) return
  try {
    await redisSetAdd(props.connectionId, props.redisKey, [val])
    newMember.value = ''
    await loadMembers()
  } catch (e: unknown) {
    toast.error(t('redis.addFailed'), parseBackendError(e).message)
  }
}

async function handleDelete(member: string) {
  try {
    await redisSetRem(props.connectionId, props.redisKey, [member])
    await loadMembers()
  } catch (e: unknown) {
    toast.error(t('redis.deleteKeyFailed'), parseBackendError(e).message)
  }
}

watch(() => props.redisKey, () => { loadMembers() })
onMounted(() => { loadMembers() })
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 添加成员 -->
    <div class="flex items-center gap-2 px-4 py-2 border-b border-border/20">
      <Input v-model="newMember" :placeholder="t('redis.newMember')" class="h-7 text-[11px] flex-1" @keydown.enter="handleAdd" />
      <Button variant="ghost" size="sm" class="h-7 px-2" :disabled="!newMember.trim()" @click="handleAdd">
        <Plus class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- 成员列表 -->
    <ScrollArea class="flex-1">
      <div class="py-1">
        <div
          v-for="member in members"
          :key="member"
          class="flex items-center gap-2 px-4 py-1.5 hover:bg-muted/20 group text-[11px]"
        >
          <span class="font-mono text-foreground/70 truncate flex-1">{{ member }}</span>
          <Trash2
            class="h-3 w-3 shrink-0 text-muted-foreground/20 opacity-0 group-hover:opacity-100 hover:text-destructive cursor-pointer transition-all"
            @click="handleDelete(member)"
          />
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
