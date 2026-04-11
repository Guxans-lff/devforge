<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Save } from 'lucide-vue-next'
import { redisGetValue, redisSetString } from '@/api/redis'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'

const props = defineProps<{
  connectionId: string
  redisKey: string
}>()

const { t } = useI18n()
const toast = useToast()

const value = ref('')
const originalValue = ref('')
const loading = ref(false)
const saving = ref(false)

const isDirty = ref(false)

async function loadValue() {
  loading.value = true
  try {
    const result = await redisGetValue(props.connectionId, props.redisKey)
    if (result.type === 'string') {
      value.value = result.value
      originalValue.value = result.value
      isDirty.value = false
    }
  } catch (e: unknown) {
    toast.error(t('redis.loadStringFailed'), parseBackendError(e).message)
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  saving.value = true
  try {
    await redisSetString(props.connectionId, props.redisKey, value.value)
    originalValue.value = value.value
    isDirty.value = false
    toast.success(t('redis.saveSuccess'))
  } catch (e: unknown) {
    toast.error(t('redis.saveFailed'), parseBackendError(e).message)
  } finally {
    saving.value = false
  }
}

function handleInput(e: Event) {
  value.value = (e.target as HTMLTextAreaElement).value
  isDirty.value = value.value !== originalValue.value
}

watch(() => props.redisKey, () => { loadValue() })
onMounted(() => { loadValue() })
</script>

<template>
  <div class="flex h-full flex-col p-4 gap-3">
    <div class="flex items-center justify-between">
      <span class="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-wider">{{ t('redis.stringValue') }}</span>
      <Button
        size="sm"
        class="h-7 px-3 text-[11px]"
        :disabled="!isDirty || saving"
        @click="handleSave"
      >
        <Save class="h-3.5 w-3.5 mr-1" />
        {{ t('common.save') }}
      </Button>
    </div>
    <textarea
      :value="value"
      @input="handleInput"
      class="flex-1 w-full resize-none rounded-md border border-border/40 bg-muted/10 px-3 py-2 text-[12px] font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
      :placeholder="loading ? t('redis.loading') : ''"
    />
  </div>
</template>
