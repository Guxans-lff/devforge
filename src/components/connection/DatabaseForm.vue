<script setup lang="ts">
import { computed, watch } from 'vue'
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

interface DatabaseFormData {
  driver: string
  host: string
  port: number
  username: string
  password: string
  database: string
}

const props = defineProps<{
  modelValue: DatabaseFormData
  isEditing: boolean
  showPassword: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: DatabaseFormData]
  'update:showPassword': [value: boolean]
}>()

const { t } = useI18n()

const localValue = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const defaultPorts: Record<string, number> = {
  mysql: 3306,
  postgresql: 5432,
  sqlite: 0,
}

watch(
  () => localValue.value.driver,
  (driver) => {
    if (!props.isEditing) {
      localValue.value = {
        ...localValue.value,
        port: defaultPorts[driver] ?? 3306,
      }
    }
  },
)

function updateField<K extends keyof DatabaseFormData>(field: K, value: DatabaseFormData[K]) {
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
    <!-- Driver -->
    <div class="grid grid-cols-4 items-center gap-4">
      <Label class="text-right">{{ t('connection.driver') }}</Label>
      <Select :model-value="localValue.driver" @update:model-value="updateField('driver', $event)">
        <SelectTrigger class="col-span-3">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="mysql">MySQL</SelectItem>
          <SelectItem value="postgresql">PostgreSQL</SelectItem>
          <SelectItem value="sqlite">SQLite</SelectItem>
        </SelectContent>
      </Select>
    </div>

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
        :placeholder="String(defaultPorts[localValue.driver])"
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

    <!-- Password -->
    <div class="grid grid-cols-4 items-center gap-4">
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

    <!-- Database Name -->
    <div class="grid grid-cols-4 items-center gap-4">
      <Label class="text-right">{{ t('connection.database') }}</Label>
      <Input
        :model-value="localValue.database"
        @update:model-value="updateField('database', $event)"
        :placeholder="t('connection.databasePlaceholder')"
        class="col-span-3"
      />
    </div>
  </div>
</template>
