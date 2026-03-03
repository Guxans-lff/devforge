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
import { Eye, EyeOff, Globe, User, Lock, Database as DbIcon, Hash } from 'lucide-vue-next'

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

const portError = computed(() => {
  const port = localValue.value.port
  if (port < 0 || port > 65535) return t('connection.portOutOfRange')
  return ''
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

const driverIcons: Record<string, string> = {
  mysql: '/icons/mysql.svg',
  postgresql: '/icons/postgresql.svg',
  sqlite: '/icons/sqlite.svg',
}
</script>

<template>
  <div class="grid gap-4">
    <!-- Core Connection Group (Tightened) -->
    <div class="p-3 bg-muted/20 border border-border/10 rounded-xl space-y-3">
      <div class="flex gap-2.5">
        <!-- Driver Select (Denser) -->
        <div class="space-y-1 flex-1">
          <Label class="text-[10px] uppercase font-black tracking-widest text-muted-foreground/70 px-1">{{ t('connection.driver') }}</Label>
          <Select :model-value="localValue.driver" @update:model-value="updateField('driver', $event as string)">
            <SelectTrigger class="h-9 bg-background/40 border-white/5 rounded-lg transition-all focus:ring-primary/10 text-xs shadow-none text-foreground">
              <template #default>
                <div class="flex items-center gap-1.5 min-w-0">
                  <DbIcon class="h-3.5 w-3.5 text-primary/70 shrink-0" />
                  <SelectValue class="truncate font-bold" />
                </div>
              </template>
            </SelectTrigger>
            <SelectContent class="backdrop-blur-xl bg-background/80 border-border/20 rounded-xl">
              <SelectItem value="mysql">MySQL</SelectItem>
              <SelectItem value="postgresql">PostgreSQL</SelectItem>
              <SelectItem value="sqlite">SQLite</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- Host (Middle) -->
        <div class="space-y-1 flex-[2.5]">
          <Label class="text-[10px] uppercase font-black tracking-widest text-muted-foreground/70 px-1">{{ t('connection.host') }}</Label>
          <div class="relative group">
            <Globe class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within:text-primary transition-all" />
            <Input
              :model-value="localValue.host"
              @update:model-value="updateField('host', $event as string)"
              placeholder="127.0.0.1"
              class="pl-9 h-9 bg-background/40 border-white/5 rounded-lg transition-all focus:ring-primary/10 focus:border-primary/20 text-xs text-foreground placeholder:text-muted-foreground/30 font-medium"
            />
          </div>
        </div>

        <!-- Port (Right) -->
        <div class="space-y-1 w-20">
          <Label class="text-[10px] uppercase font-black tracking-widest text-muted-foreground/70 px-1">{{ t('connection.port') }}</Label>
          <div class="relative group">
            <Hash class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within:text-primary transition-all" />
            <Input
              :model-value="localValue.port"
              @update:model-value="updateField('port', Number($event))"
              type="number"
              :placeholder="String(defaultPorts[localValue.driver] || 3306)"
              class="pl-8 h-9 bg-background/40 border-white/5 rounded-lg transition-all focus:ring-primary/10 focus:border-primary/20 text-xs text-center text-foreground placeholder:text-muted-foreground/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-bold"
              :class="{ 'border-destructive/30': portError }"
            />
          </div>
        </div>
      </div>

      <!-- Database Name (Integrated in Group) -->
      <div class="space-y-1">
        <Label class="text-[10px] uppercase font-black tracking-widest text-muted-foreground/70 px-1">{{ t('connection.database') }}</Label>
        <div class="relative group">
          <DbIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within:text-primary transition-all" />
          <Input
            :model-value="localValue.database"
            @update:model-value="updateField('database', $event as string)"
            :placeholder="t('connection.databasePlaceholder')"
            class="pl-9 h-9 bg-background/40 border-white/5 rounded-lg transition-all focus:ring-primary/10 focus:border-primary/20 text-xs text-foreground placeholder:text-muted-foreground/30 font-medium"
          />
        </div>
      </div>
    </div>

    <!-- Credentials Group (Tightened) -->
    <div class="p-3 bg-muted/20 border border-border/10 rounded-xl grid grid-cols-2 gap-2.5">
      <!-- Username -->
      <div class="space-y-1">
        <Label class="text-[10px] uppercase font-black tracking-widest text-muted-foreground/70 px-1">{{ t('connection.username') }}</Label>
        <div class="relative group">
          <User class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within:text-primary transition-all" />
          <Input
            :model-value="localValue.username"
            @update:model-value="updateField('username', $event as string)"
            placeholder="root"
            class="pl-9 h-9 bg-background/40 border-white/5 rounded-lg transition-all focus:ring-primary/10 focus:border-primary/20 text-xs text-foreground placeholder:text-muted-foreground/30 font-medium"
          />
        </div>
      </div>

      <!-- Password -->
      <div class="space-y-1">
        <Label class="text-[10px] uppercase font-black tracking-widest text-muted-foreground/70 px-1">{{ t('connection.password') }}</Label>
        <div class="relative group">
          <Lock class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within:text-primary transition-all" />
          <Input
            :model-value="localValue.password"
            @update:model-value="updateField('password', $event as string)"
            :type="showPassword ? 'text' : 'password'"
            :placeholder="isEditing ? t('connection.passwordUnchanged') : ''"
            class="pl-9 pr-9 h-9 bg-background/40 border-white/5 rounded-lg transition-all focus:ring-primary/10 focus:border-primary/20 text-xs text-foreground placeholder:text-muted-foreground/30 font-medium"
          />
          <button
            type="button"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-primary transition-all"
            @click="togglePasswordVisibility"
            tabindex="-1"
          >
            <EyeOff v-if="showPassword" class="h-3.5 w-3.5" />
            <Eye v-else class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
