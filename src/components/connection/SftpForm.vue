<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { open } from '@tauri-apps/plugin-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Eye, EyeOff, FolderOpen, Globe, Hash, User, Lock, Key, Shield, FolderSearch } from 'lucide-vue-next'

interface SftpFormData {
  host: string
  port: number
  username: string
  password: string
  authMethod: 'password' | 'key'
  privateKeyPath: string
  passphrase: string
  remotePath: string
  sshConnectionId: string
}

const props = defineProps<{
  modelValue: SftpFormData
  isEditing: boolean
  showPassword: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SftpFormData]
  'update:showPassword': [value: boolean]
}>()

const { t } = useI18n()

const localValue = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

function updateField<K extends keyof SftpFormData>(field: K, value: SftpFormData[K]) {
  localValue.value = {
    ...localValue.value,
    [field]: value,
  }
}

function togglePasswordVisibility() {
  emit('update:showPassword', !props.showPassword)
}

async function browsePrivateKey() {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Key Files', extensions: ['pem', 'key', 'pub', 'ppk', '*'] }],
  })
  if (selected) {
    updateField('privateKeyPath', selected as string)
  }
}
</script>

<template>
  <div class="grid gap-5">
    <!-- Server Connection Group (Compressed) -->
    <div class="p-3 bg-muted/20 border border-border/10 rounded-xl space-y-3">
      <div class="flex gap-2.5">
        <!-- Host -->
        <div class="space-y-1 flex-[2.5]">
          <Label class="text-[10px] uppercase font-black tracking-widest text-muted-foreground/70 px-1">{{ t('connection.host') }}</Label>
          <div class="relative group">
            <Globe class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 group-focus-within:text-primary transition-all" />
            <Input
              :model-value="localValue.host"
              @update:model-value="updateField('host', $event as string)"
              placeholder="127.0.0.1"
              class="pl-9 h-9 bg-background/40 border-white/5 rounded-lg transition-all focus:ring-primary/10 focus:border-primary/20 text-xs text-foreground placeholder:text-muted-foreground/30 font-medium"
            />
          </div>
        </div>
        <!-- Port -->
        <div class="space-y-1 w-20">
          <Label class="text-[10px] uppercase font-black tracking-widest text-muted-foreground/70 px-1">{{ t('connection.port') }}</Label>
          <div class="relative group">
            <Hash class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 group-focus-within:text-primary transition-all" />
            <Input
              :model-value="localValue.port"
              @update:model-value="updateField('port', Number($event))"
              type="number"
              placeholder="22"
              class="pl-8 h-9 bg-background/40 border-white/5 rounded-lg transition-all focus:ring-primary/10 focus:border-primary/20 text-xs text-center text-foreground placeholder:text-muted-foreground/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-bold"
            />
          </div>
        </div>
      </div>

      <!-- Username -->
      <div class="space-y-1">
        <Label class="text-[10px] uppercase font-black tracking-widest text-muted-foreground/70 px-1">{{ t('connection.username') }}</Label>
        <div class="relative group">
          <User class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 group-focus-within:text-primary transition-all" />
          <Input
            :model-value="localValue.username"
            @update:model-value="updateField('username', $event as string)"
            placeholder="root"
            class="pl-9 h-9 bg-background/40 border-white/5 rounded-lg transition-all focus:ring-primary/10 focus:border-primary/20 text-xs text-foreground placeholder:text-muted-foreground/30 font-medium"
          />
        </div>
      </div>
    </div>

    <!-- Auth & Path Group (Compressed) -->
    <div class="p-3 bg-muted/20 border border-border/10 rounded-xl space-y-3">
      <!-- Auth Method -->
      <div class="space-y-1">
        <Label class="text-[10px] uppercase font-black tracking-widest text-muted-foreground/70 px-1">{{ t('connection.authMethod') }}</Label>
        <Select :model-value="localValue.authMethod" @update:model-value="updateField('authMethod', $event as 'password' | 'key')">
          <SelectTrigger class="h-9 bg-background/40 border-white/5 rounded-lg transition-all focus:ring-primary/10 text-xs shadow-none text-foreground">
            <template #default>
              <div class="flex items-center gap-1.5 px-1 font-bold">
                <Shield class="h-3.5 w-3.5 text-primary/70" />
                <SelectValue />
              </div>
            </template>
          </SelectTrigger>
          <SelectContent class="backdrop-blur-xl bg-background/80 border-border/20 rounded-xl">
            <SelectItem value="password">{{ t('connection.authPassword') }}</SelectItem>
            <SelectItem value="key">{{ t('connection.authKey') }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- Conditional Auth Inputs (Compressed) -->
      <TransitionGroup name="form-fade">
        <!-- Password -->
        <div v-if="localValue.authMethod === 'password'" key="password" class="space-y-1">
          <Label class="text-[10px] uppercase font-black tracking-widest text-muted-foreground/70 px-1">{{ t('connection.password') }}</Label>
          <div class="relative group">
            <Lock class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 group-focus-within:text-primary transition-all" />
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

        <!-- Key Pair Group -->
        <template v-if="localValue.authMethod === 'key'">
          <div key="key-path" class="space-y-1">
            <Label class="text-[10px] uppercase font-black tracking-widest text-muted-foreground/70 px-1">{{ t('connection.privateKey') }}</Label>
            <div class="flex gap-2">
              <div class="relative group flex-1">
                <Key class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 group-focus-within:text-primary transition-all" />
                <Input
                  :model-value="localValue.privateKeyPath"
                  @update:model-value="updateField('privateKeyPath', $event as string)"
                  :placeholder="t('connection.privateKeyPlaceholder')"
                  class="pl-9 h-9 bg-background/40 border-white/5 rounded-lg transition-all focus:ring-primary/10 focus:border-primary/20 text-xs text-foreground placeholder:text-muted-foreground/30 font-medium"
                />
              </div>
              <Button variant="outline" class="h-9 w-9 rounded-lg border-white/5 bg-background/40 hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all shadow-none group/btn px-0" @click="browsePrivateKey">
                <FolderOpen class="h-4 w-4 group-hover/btn:scale-110 transition-transform" />
              </Button>
            </div>
          </div>

          <div key="passphrase" class="space-y-1">
            <Label class="text-[10px] uppercase font-black tracking-widest text-muted-foreground/70 px-1">{{ t('connection.passphrase') }}</Label>
            <div class="relative group">
              <Lock class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 group-focus-within:text-primary transition-all" />
              <Input
                :model-value="localValue.passphrase"
                @update:model-value="updateField('passphrase', $event as string)"
                :type="showPassword ? 'text' : 'password'"
                :placeholder="t('connection.passphrasePlaceholder')"
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
        </template>
      </TransitionGroup>

      <!-- Remote Path -->
      <div class="space-y-1 pt-2 border-t border-white/5">
        <Label class="text-[10px] uppercase font-black tracking-widest text-muted-foreground/70 px-1">{{ t('connection.remotePath') }}</Label>
        <div class="relative group">
          <FolderSearch class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 group-focus-within:text-primary transition-all" />
          <Input
            :model-value="localValue.remotePath"
            @update:model-value="updateField('remotePath', $event as string)"
            placeholder="/"
            class="pl-9 h-9 bg-background/40 border-white/5 rounded-lg transition-all focus:ring-primary/10 focus:border-primary/20 text-xs text-foreground placeholder:text-muted-foreground/30 font-medium"
          />
        </div>
      </div>
    </div>
  </div>
</template>
