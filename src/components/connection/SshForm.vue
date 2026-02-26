<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Eye, EyeOff } from 'lucide-vue-next'

interface SshFormData {
  host: string
  port: number
  username: string
  password: string
  authMethod: 'password' | 'key'
  privateKeyPath: string
}

const props = defineProps<{
  modelValue: SshFormData
  isEditing: boolean
  showPassword: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SshFormData]
  'update:showPassword': [value: boolean]
}>()

const { t } = useI18n()

const localValue = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

function updateField<K extends keyof SshFormData>(field: K, value: SshFormData[K]) {
  localValue.value = {
    ...localValue.value,
    [field]: value,
  }
}

function togglePasswordVisibility() {
  emit('update:showPassword', !props.showPassword)
}
</script>

<template>
  <div class="grid gap-4">
    <!-- Host & Port -->
    <div class="grid grid-cols-4 items-center gap-4">
      <Label class="text-right">{{ t('connection.host') }}</Label>
      <Input
        :model-value="localValue.host"
        @update:model-value="updateField('host', $event)"
        placeholder="127.0.0.1"
        class="col-span-2"
      />
      <Input
        :model-value="localValue.port"
        @update:model-value="updateField('port', Number($event))"
        type="number"
        placeholder="22"
        class="col-span-1"
      />
    </div>

    <!-- Username -->
    <div class="grid grid-cols-4 items-center gap-4">
      <Label class="text-right">{{ t('connection.username') }}</Label>
      <Input
        :model-value="localValue.username"
        @update:model-value="updateField('username', $event)"
        placeholder="root"
        class="col-span-3"
      />
    </div>

    <!-- Auth Method -->
    <div class="grid grid-cols-4 items-center gap-4">
      <Label class="text-right">{{ t('connection.authMethod') }}</Label>
      <Select :model-value="localValue.authMethod" @update:model-value="updateField('authMethod', $event as 'password' | 'key')">
        <SelectTrigger class="col-span-3">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="password">{{ t('connection.authPassword') }}</SelectItem>
          <SelectItem value="key">{{ t('connection.authKey') }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Password (if password auth) -->
    <div v-if="localValue.authMethod === 'password'" class="grid grid-cols-4 items-center gap-4">
      <Label class="text-right">{{ t('connection.password') }}</Label>
      <div class="col-span-3 relative">
        <Input
          :model-value="localValue.password"
          @update:model-value="updateField('password', $event)"
          :type="showPassword ? 'text' : 'password'"
          :placeholder="isEditing ? t('connection.passwordUnchanged') : ''"
          class="pr-9"
        />
        <button
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          @click="togglePasswordVisibility"
          tabindex="-1"
        >
          <EyeOff v-if="showPassword" class="h-4 w-4" />
          <Eye v-else class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Private Key Path (if key auth) -->
    <div v-if="localValue.authMethod === 'key'" class="grid grid-cols-4 items-center gap-4">
      <Label class="text-right">{{ t('connection.privateKey') }}</Label>
      <Input
        :model-value="localValue.privateKeyPath"
        @update:model-value="updateField('privateKeyPath', $event)"
        :placeholder="t('connection.privateKeyPlaceholder')"
        class="col-span-3"
      />
    </div>
  </div>
</template>
