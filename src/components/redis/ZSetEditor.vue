<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Plus, Trash2 } from 'lucide-vue-next'
import { redisZsetRange, redisZsetAdd, redisZsetRem } from '@/api/redis'
import { useToast } from '@/composables/useToast'
import type { ZSetMember } from '@/types/redis'

const props = defineProps<{
  connectionId: string
  redisKey: string
}>()

const { t } = useI18n()
const toast = useToast()

const members = ref<ZSetMember[]>([])
const loading = ref(false)
const newMember = ref('')
const newScore = ref('0')

async function loadMembers() {
  loading.value = true
  try {
    members.value = await redisZsetRange(props.connectionId, props.redisKey, 0, -1)
  } catch (e) {
    toast.error('加载 ZSet 失败', (e as any)?.message ?? String(e))
  } finally {
    loading.value = false
  }
}

async function handleAdd() {
  const member = newMember.value.trim()
  if (!member) return
  const score = parseFloat(newScore.value) || 0
  try {
    await redisZsetAdd(props.connectionId, props.redisKey, member, score)
    newMember.value = ''
    newScore.value = '0'
    await loadMembers()
  } catch (e) {
    toast.error('添加失败', (e as any)?.message ?? String(e))
  }
}

async function handleDelete(member: string) {
  try {
    await redisZsetRem(props.connectionId, props.redisKey, [member])
    await loadMembers()
  } catch (e) {
    toast.error('删除失败', (e as any)?.message ?? String(e))
  }
}

watch(() => props.redisKey, () => { loadMembers() })
onMounted(() => { loadMembers() })
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 添加成员 -->
    <div class="flex items-center gap-2 px-4 py-2 border-b border-border/20">
      <Input v-model="newMember" :placeholder="t('redis.member')" class="h-7 text-[11px] flex-1" @keydown.enter="handleAdd" />
      <Input v-model="newScore" type="number" placeholder="Score" class="h-7 text-[11px] w-24" @keydown.enter="handleAdd" />
      <Button variant="ghost" size="sm" class="h-7 px-2" :disabled="!newMember.trim()" @click="handleAdd">
        <Plus class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- 成员列表 -->
    <ScrollArea class="flex-1">
      <table class="w-full text-[11px]">
        <thead class="sticky top-0 bg-muted/30 z-10">
          <tr class="border-b border-border/20">
            <th class="px-4 py-2 text-left font-bold text-muted-foreground/60 w-24">Score</th>
            <th class="px-4 py-2 text-left font-bold text-muted-foreground/60">Member</th>
            <th class="px-4 py-2 w-16"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in members"
            :key="item.member"
            class="border-b border-border/10 hover:bg-muted/20 group"
          >
            <td class="px-4 py-1.5 font-mono text-primary/70 font-bold">{{ item.score }}</td>
            <td class="px-4 py-1.5 font-mono text-foreground/60 truncate max-w-[400px]">{{ item.member }}</td>
            <td class="px-4 py-1.5 text-right">
              <Trash2
                class="h-3 w-3 inline-block text-muted-foreground/20 opacity-0 group-hover:opacity-100 hover:text-destructive cursor-pointer transition-all"
                @click="handleDelete(item.member)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </ScrollArea>
  </div>
</template>
