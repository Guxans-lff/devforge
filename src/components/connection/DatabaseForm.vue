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
  <div class="space-y-8">
    <!-- Section 1: Network Configuration -->
    <section class="space-y-4">
      <div class="flex items-center gap-2">
        <div class="h-1.5 w-1.5 rounded-full bg-primary/40"></div>
        <h3 class="text-[10px] font-black uppercase tracking-widest text-muted-foreground/80">{{ t('connection.networkLayer') || 'Network Protocol' }}</h3>
        <div class="flex-1 h-[1px] bg-border/40"></div>
      </div>

      <div class="grid grid-cols-12 gap-4">
        <!-- Driver -->
        <div class="col-span-4 space-y-2">
          <div class="flex items-center justify-between px-1">
            <Label class="text-[10px] uppercase font-bold tracking-tight text-muted-foreground/70">{{ t('connection.driver') }}</Label>
            <span class="text-[8px] font-mono text-muted-foreground/50 font-black tracking-tighter uppercase bg-muted/30 px-1 rounded-sm">Protocol</span>
          </div>
          <Select :model-value="localValue.driver" @update:model-value="updateField('driver', $event as string)">
            <SelectTrigger class="h-10 bg-muted/10 border-border rounded-lg transition-all focus:ring-2 focus:ring-primary/5 text-xs shadow-none">
              <template #default>
                <div class="flex items-center gap-1.5 min-w-0 font-bold">
                  <div class="h-5 w-5 rounded flex items-center justify-center bg-background/50 border border-border/50">
                    <DbIcon class="h-3 w-3 text-primary/70 shrink-0" />
                  </div>
                  <SelectValue class="truncate" />
                </div>
              </template>
            </SelectTrigger>
            <SelectContent class="bg-popover border-border rounded-xl shadow-2xl">
              <SelectItem value="mysql">MySQL</SelectItem>
              <SelectItem value="postgresql">PostgreSQL</SelectItem>
              <SelectItem value="sqlite">SQLite</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- Host -->
        <div class="col-span-8 space-y-2">
          <div class="flex items-center justify-between px-1">
            <Label class="text-[10px] uppercase font-bold tracking-tight text-muted-foreground/70 flex items-center gap-1">
              {{ t('connection.host') }}
              <span class="text-destructive font-black">*</span>
            </Label>
            <span class="text-[8px] font-mono text-muted-foreground/50 font-black tracking-tighter uppercase bg-muted/30 px-1 rounded-sm">Network EndPoint</span>
          </div>
          <div class="relative group">
            <Globe class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/20 group-focus-within:text-primary transition-colors" />
            <Input
              :model-value="localValue.host"
              @update:model-value="updateField('host', $event as string)"
              placeholder="127.0.0.1"
              autocomplete="off"
              class="pl-10 h-10 bg-muted/10 border-border rounded-lg transition-all focus:ring-2 focus:ring-primary/5 text-xs font-mono tracking-tight text-foreground placeholder:text-muted-foreground/30"
            />
          </div>
        </div>
      </div>
      
      <div class="space-y-2">
        <div class="flex items-center justify-between px-1">
          <Label class="text-[10px] uppercase font-bold tracking-tight text-muted-foreground/70">{{ t('connection.port') }}</Label>
          <span class="text-[8px] font-mono text-muted-foreground/50 font-black tracking-tighter uppercase bg-muted/30 px-1 rounded-sm">0-65535 TCP</span>
        </div>
        <div class="relative group">
          <Hash class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/20 group-focus-within:text-primary transition-colors" />
          <Input
            :model-value="localValue.port"
            @update:model-value="updateField('port', Number($event))"
            type="number"
            :placeholder="String(defaultPorts[localValue.driver] || 3306)"
            autocomplete="off"
            class="pl-10 h-10 bg-muted/10 border-border rounded-lg transition-all focus:ring-2 focus:ring-primary/5 text-xs font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none w-full text-foreground font-bold placeholder:text-muted-foreground/30"
            :class="{ 'border-destructive/40 bg-destructive/5': portError }"
          />
          <div class="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-muted/30 border border-border/50 text-[8px] font-mono font-black text-muted-foreground/60 uppercase">Port</div>
        </div>
      </div>
    </section>

    <!-- Section 2: Access Control -->
    <section class="space-y-4">
      <div class="flex items-center gap-2">
        <div class="h-1.5 w-1.5 rounded-full bg-primary/40"></div>
        <h3 class="text-[10px] font-black uppercase tracking-widest text-muted-foreground/80">{{ t('connection.authLayer') || 'Access Credentials' }}</h3>
        <div class="flex-1 h-[1px] bg-border/40"></div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <!-- Username -->
        <div class="space-y-2">
          <Label class="text-[10px] uppercase font-bold tracking-tight text-muted-foreground/60 px-1">{{ t('connection.username') }}</Label>
          <div class="relative group">
            <User class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
            <Input
              :model-value="localValue.username"
              @update:model-value="updateField('username', $event as string)"
              placeholder="root"
              autocomplete="off"
              class="pl-10 h-10 bg-muted/10 border-border rounded-lg transition-all focus:ring-2 focus:ring-primary/5 text-xs font-semibold text-foreground placeholder:text-muted-foreground/30"
            />
          </div>
        </div>

        <!-- Password -->
        <div class="space-y-2">
          <Label class="text-[10px] uppercase font-bold tracking-tight text-muted-foreground/60 px-1">{{ t('connection.password') }}</Label>
          <div class="relative group">
            <Lock class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
            <Input
              :model-value="localValue.password"
              @update:model-value="updateField('password', $event as string)"
              :type="showPassword ? 'text' : 'password'"
              :placeholder="isEditing ? t('connection.passwordUnchanged') : ''"
              class="pl-10 pr-10 h-10 bg-muted/10 border-border rounded-lg transition-all focus:ring-primary/5 text-xs font-mono"
            />
            <button
              type="button"
              class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/30 hover:text-primary transition-all"
              @click="togglePasswordVisibility"
              tabindex="-1"
            >
              <EyeOff v-if="showPassword" class="h-4 w-4" />
              <Eye v-else class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 3: Targeted Resources -->
    <section class="space-y-4">
      <div class="flex items-center gap-2">
        <div class="h-1.5 w-1.5 rounded-full bg-primary/40"></div>
        <h3 class="text-[10px] font-black uppercase tracking-widest text-muted-foreground/80">{{ t('connection.targetLayer') || 'Target Environment' }}</h3>
        <div class="flex-1 h-[1px] bg-border/40"></div>
      </div>

      <div class="space-y-2">
        <Label class="text-[10px] uppercase font-bold tracking-tight text-muted-foreground/60 px-1">{{ t('connection.database') }}</Label>
        <div class="relative group">
          <DbIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
          <Input
            :model-value="localValue.database"
            @update:model-value="updateField('database', $event as string)"
            :placeholder="t('connection.databasePlaceholder')"
            autocomplete="off"
            class="pl-10 h-10 bg-muted/10 border-border rounded-lg transition-all focus:ring-2 focus:ring-primary/5 text-xs font-semibold text-foreground placeholder:text-muted-foreground/30"
          />
        </div>
      </div>
    </section>
  </div>
</template>
