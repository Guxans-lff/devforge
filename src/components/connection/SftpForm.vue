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
  <div class="space-y-8">
    <!-- Section 1: Network Configuration -->
    <section class="space-y-4">
      <div class="flex items-center gap-2">
        <div class="h-1.5 w-1.5 rounded-full bg-primary/40"></div>
        <h3 class="text-[10px] font-black uppercase tracking-widest text-muted-foreground/80">{{ t('connection.networkLayer') || 'Network Protocol' }}</h3>
        <div class="flex-1 h-[1px] bg-border/40"></div>
      </div>

      <div class="grid grid-cols-12 gap-4">
        <!-- Host -->
        <div class="col-span-9 space-y-2">
          <div class="flex items-center justify-between px-1">
            <Label class="text-[10px] uppercase font-bold tracking-tight text-muted-foreground/70 flex items-center gap-1">
              {{ t('connection.host') }}
              <span class="text-destructive font-black">*</span>
            </Label>
            <span class="text-[8px] font-mono text-muted-foreground/50 font-black tracking-tighter uppercase bg-muted/30 px-1 rounded-sm">Remote Node</span>
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
        <!-- Port -->
        <div class="col-span-3 space-y-2">
          <div class="flex items-center justify-between px-1">
            <Label class="text-[10px] uppercase font-bold tracking-tight text-muted-foreground/70">{{ t('connection.port') }}</Label>
            <span class="text-[8px] font-mono text-muted-foreground/50 font-black tracking-tighter uppercase bg-muted/30 px-1 rounded-sm">SFTP</span>
          </div>
          <div class="relative group">
            <Hash class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/20 group-focus-within:text-primary transition-colors" />
            <Input
              :model-value="localValue.port"
              @update:model-value="updateField('port', Number($event))"
              type="number"
              placeholder="22"
              autocomplete="off"
              class="pl-10 h-10 bg-muted/10 border-border rounded-lg transition-all focus:ring-2 focus:ring-primary/5 text-xs font-mono text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-foreground font-bold placeholder:text-muted-foreground/30"
            />
          </div>
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

      <div class="space-y-6">
        <!-- Username -->
        <div class="space-y-2">
          <div class="flex items-center justify-between px-1">
            <Label class="text-[10px] uppercase font-bold tracking-tight text-muted-foreground/70 flex items-center gap-1">
              {{ t('connection.username') }}
              <span class="text-destructive font-black">*</span>
            </Label>
            <span class="text-[8px] font-mono text-muted-foreground/50 font-black tracking-tighter uppercase bg-muted/30 px-1 rounded-sm">Identifier</span>
          </div>
          <div class="relative group">
            <User class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/20 group-focus-within:text-primary transition-colors" />
            <Input
              :model-value="localValue.username"
              @update:model-value="updateField('username', $event as string)"
              placeholder="root"
              autocomplete="off"
              class="pl-10 h-10 bg-muted/10 border-border rounded-lg transition-all focus:ring-2 focus:ring-primary/5 text-xs font-semibold text-foreground placeholder:text-muted-foreground/30"
            />
          </div>
        </div>

        <!-- Auth Method Selection -->
        <div class="space-y-2">
          <Label class="text-[10px] uppercase font-bold tracking-tight text-muted-foreground/60 px-1">{{ t('connection.authMethod') }}</Label>
          <Select :model-value="localValue.authMethod" @update:model-value="updateField('authMethod', $event as 'password' | 'key')">
            <SelectTrigger class="h-10 bg-muted/10 border-border rounded-lg transition-all focus:ring-primary/5 text-xs shadow-none">
              <template #default>
                <div class="flex items-center gap-2 font-bold">
                  <Shield class="h-4 w-4 text-primary/70" />
                  <SelectValue />
                </div>
              </template>
            </SelectTrigger>
            <SelectContent class="bg-popover border-border rounded-xl shadow-2xl">
              <SelectItem value="password">{{ t('connection.authPassword') }}</SelectItem>
              <SelectItem value="key">{{ t('connection.authKey') }}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- Conditional Auth Inputs -->
        <TransitionGroup name="form-fade">
          <!-- Password -->
          <div v-if="localValue.authMethod === 'password'" key="password" class="space-y-2 animate-in fade-in zoom-in-95 duration-300">
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

          <!-- Key Pair Group -->
          <template v-if="localValue.authMethod === 'key'">
            <div key="key-path" class="space-y-2 animate-in fade-in zoom-in-95 duration-300">
              <Label class="text-[10px] uppercase font-bold tracking-tight text-muted-foreground/60 px-1">{{ t('connection.privateKey') }}</Label>
              <div class="flex gap-2">
                <div class="relative group flex-1">
                  <Key class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
                  <Input
                    :model-value="localValue.privateKeyPath"
                    @update:model-value="updateField('privateKeyPath', $event as string)"
                    :placeholder="t('connection.privateKeyPlaceholder')"
                    class="pl-10 h-10 bg-muted/10 border-border rounded-lg transition-all focus:ring-primary/5 text-xs font-mono"
                  />
                </div>
                <Button variant="outline" class="h-10 w-10 border-border bg-muted/10 hover:bg-primary/5 hover:border-primary/20 transition-all shadow-none px-0 rounded-lg" @click="browsePrivateKey">
                  <FolderOpen class="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div key="passphrase" class="space-y-2 animate-in fade-in zoom-in-95 duration-300">
              <Label class="text-[10px] uppercase font-bold tracking-tight text-muted-foreground/60 px-1">{{ t('connection.passphrase') }}</Label>
              <div class="relative group">
                <Lock class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
                <Input
                  :model-value="localValue.passphrase"
                  @update:model-value="updateField('passphrase', $event as string)"
                  :type="showPassword ? 'text' : 'password'"
                  :placeholder="t('connection.passphrasePlaceholder')"
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
          </template>
        </TransitionGroup>
      </div>
    </section>

    <!-- Section 3: Targeted Resources (Remote Path) -->
    <section class="space-y-4">
      <div class="flex items-center gap-2">
        <div class="h-1.5 w-1.5 rounded-full bg-primary/40"></div>
        <h3 class="text-[10px] font-black uppercase tracking-widest text-muted-foreground/80">{{ t('connection.targetLayer') || 'Target Environment' }}</h3>
        <div class="flex-1 h-[1px] bg-border/40"></div>
      </div>

      <div class="space-y-2">
        <Label class="text-[10px] uppercase font-bold tracking-tight text-muted-foreground/60 px-1">{{ t('connection.remotePath') }}</Label>
        <div class="relative group">
          <FolderSearch class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
          <Input
            :model-value="localValue.remotePath"
            @update:model-value="updateField('remotePath', $event as string)"
            placeholder="/"
            class="pl-10 h-10 bg-muted/10 border-border rounded-lg transition-all focus:ring-primary/5 text-xs font-semibold"
          />
        </div>
      </div>
    </section>
  </div>
</template>
