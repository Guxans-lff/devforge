<script setup lang="ts">
import { computed, watch } from 'vue'
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
import { Eye, EyeOff, Globe, User, Lock, Database as DbIcon, Hash, ShieldCheck, FolderOpen, FileKey, FileLock, ShieldAlert } from 'lucide-vue-next'
import { Switch } from '@/components/ui/switch'
import type { SslConfig } from '@/types/connection'
import type { EnvironmentType } from '@/types/environment'
import { ENV_PRESETS, ENVIRONMENT_OPTIONS } from '@/types/environment'

/** SSL 模式选项定义 */
const SSL_MODE_OPTIONS = computed(() => [
  { value: 'disabled', label: t('connection.sslModeDisabled'), desc: t('connection.sslModeDisabledDesc') },
  { value: 'preferred', label: t('connection.sslModePreferred'), desc: t('connection.sslModePreferredDesc') },
  { value: 'required', label: t('connection.sslModeRequired'), desc: t('connection.sslModeRequiredDesc') },
  { value: 'verify-ca', label: t('connection.sslModeVerifyCa'), desc: t('connection.sslModeVerifyCaDesc') },
  { value: 'verify-identity', label: t('connection.sslModeVerifyIdentity'), desc: t('connection.sslModeVerifyIdentityDesc') },
])

export interface DatabaseFormData {
  driver: string
  host: string
  port: number
  username: string
  password: string
  database: string
  ssl: SslConfig
  environment: EnvironmentType
  readOnly: boolean
  confirmDanger: boolean
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

/** 切换环境类型时自动同步 confirmDanger 默认值 */
function handleEnvironmentChange(env: EnvironmentType) {
  const preset = ENV_PRESETS[env]
  localValue.value = {
    ...localValue.value,
    environment: env,
    confirmDanger: preset.defaultConfirmDanger,
  }
}

/** 是否需要显示证书文件选择器（仅 verify-ca 和 verify-identity 模式） */
const showCertFields = computed(() => {
  const mode = localValue.value.ssl?.mode
  return mode === 'verify-ca' || mode === 'verify-identity'
})

/** 是否显示客户端证书选择器（非 disabled 模式均可配置） */
const showClientCertFields = computed(() => {
  const mode = localValue.value.ssl?.mode
  return mode && mode !== 'disabled'
})

/** 更新 SSL 配置字段 */
function updateSslField<K extends keyof SslConfig>(field: K, value: SslConfig[K]) {
  localValue.value = {
    ...localValue.value,
    ssl: {
      ...localValue.value.ssl,
      [field]: value,
    } as SslConfig,
  }
}

/** 浏览 CA 证书文件 */
async function browseCaCert() {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Certificate Files', extensions: ['pem', 'crt', 'cer', 'ca', '*'] }],
  })
  if (selected) {
    updateSslField('caCertPath', selected as string)
  }
}

/** 浏览客户端证书文件 */
async function browseClientCert() {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Certificate Files', extensions: ['pem', 'crt', 'cer', '*'] }],
  })
  if (selected) {
    updateSslField('clientCertPath', selected as string)
  }
}

/** 浏览客户端密钥文件 */
async function browseClientKey() {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Key Files', extensions: ['pem', 'key', '*'] }],
  })
  if (selected) {
    updateSslField('clientKeyPath', selected as string)
  }
}

</script>

<template>
  <div class="space-y-10">
    <!-- Section 1: Network Configuration -->
    <section class="space-y-5">
      <div class="flex items-center gap-2">
        <div class="h-1.5 w-1.5 rounded-full bg-primary/40"></div>
        <h3 class="text-xs font-black uppercase tracking-widest text-muted-foreground/80">{{ t('connection.networkLayer') }}</h3>
        <div class="flex-1 h-[1px] bg-border/40"></div>
      </div>

      <div class="grid grid-cols-12 gap-4">
        <!-- Driver -->
        <div class="col-span-4 space-y-2">
          <div class="flex items-center justify-between px-1">
            <Label class="text-[11px] uppercase font-bold tracking-normal text-muted-foreground/70">{{ t('connection.driver') }}</Label>
            <span class="text-[8px] font-mono text-muted-foreground/50 font-black tracking-tighter uppercase bg-muted/30 px-1 rounded-sm">{{ t('connection.protocol') }}</span>
          </div>
          <Select :model-value="localValue.driver" @update:model-value="updateField('driver', $event as string)">
            <SelectTrigger class="h-10 bg-muted/10 border-border rounded-lg transition-[border-color,box-shadow] focus:ring-2 focus:ring-primary/5 text-xs shadow-none">
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
        <div class="col-span-5 space-y-2">
          <div class="flex items-center justify-between px-1">
            <Label class="text-[11px] uppercase font-bold tracking-normal text-muted-foreground/70 flex items-center gap-1">
              {{ t('connection.host') }}
              <span class="text-destructive font-black">*</span>
            </Label>
            <span class="text-[8px] font-mono text-muted-foreground/50 font-black tracking-tighter uppercase bg-muted/30 px-1 rounded-sm">{{ t('connection.endpoint') }}</span>
          </div>
          <div class="relative group">
            <Globe class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
            <Input
              :model-value="localValue.host"
              @update:model-value="updateField('host', $event as string)"
              placeholder="127.0.0.1"
              autocomplete="off"
              aria-required="true"
              class="pl-10 h-10 bg-muted/10 border-border rounded-lg transition-[border-color,box-shadow] focus:ring-2 focus:ring-primary/5 text-xs font-mono tracking-tight text-foreground placeholder:text-muted-foreground/30"
            />
          </div>
        </div>

        <!-- Port -->
        <div class="col-span-3 space-y-2">
          <div class="flex items-center justify-between px-1">
            <Label class="text-[11px] uppercase font-bold tracking-normal text-muted-foreground/70">{{ t('connection.port') }}</Label>
            <span class="text-[8px] font-mono text-muted-foreground/50 font-black tracking-tighter uppercase bg-muted/30 px-1 rounded-sm">TCP</span>
          </div>
          <div class="relative group">
            <Hash class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
            <Input
              :model-value="localValue.port"
              @update:model-value="updateField('port', Number($event))"
              type="number"
              :placeholder="String(defaultPorts[localValue.driver] || 3306)"
              autocomplete="off"
              class="pl-10 h-10 bg-muted/10 border-border rounded-lg transition-[border-color,box-shadow] focus:ring-2 focus:ring-primary/5 text-xs font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none w-full text-foreground font-bold placeholder:text-muted-foreground/30"
              :class="{ 'border-destructive/40 bg-destructive/5': portError }"
            />
          </div>
        </div>
      </div>
    </section>

    <!-- Section 2: Access Control -->
    <section class="space-y-5">
      <div class="flex items-center gap-2">
        <div class="h-1.5 w-1.5 rounded-full bg-primary/40"></div>
        <h3 class="text-xs font-black uppercase tracking-widest text-muted-foreground/80">{{ t('connection.authLayer') || t('connection.accessCredentials') }}</h3>
        <div class="flex-1 h-[1px] bg-border/40"></div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <!-- Username -->
        <div class="space-y-2">
          <Label class="text-[11px] uppercase font-bold tracking-normal text-muted-foreground/70 px-1">{{ t('connection.username') }}</Label>
          <div class="relative group">
            <User class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
            <Input
              :model-value="localValue.username"
              @update:model-value="updateField('username', $event as string)"
              placeholder="root"
              autocomplete="off"
              aria-required="true"
              class="pl-10 h-10 bg-muted/10 border-border rounded-lg transition-[border-color,box-shadow] focus:ring-2 focus:ring-primary/5 text-xs font-semibold text-foreground placeholder:text-muted-foreground/30"
            />
          </div>
        </div>

        <!-- Password -->
        <div class="space-y-2">
          <Label class="text-[11px] uppercase font-bold tracking-normal text-muted-foreground/70 px-1">{{ t('connection.password') }}</Label>
          <div class="relative group">
            <Lock class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
            <Input
              :model-value="localValue.password"
              @update:model-value="updateField('password', $event as string)"
              :type="showPassword ? 'text' : 'password'"
              :placeholder="isEditing ? t('connection.passwordUnchanged') : ''"
              class="pl-10 pr-10 h-10 bg-muted/10 border-border rounded-lg transition-[border-color,box-shadow] focus:ring-primary/5 text-xs font-mono"
            />
            <button
              type="button"
              :aria-label="showPassword ? t('connection.hidePassword') : t('connection.showPassword')"
              :aria-pressed="showPassword"
              class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/30 hover:text-primary transition-colors rounded focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
              @click="togglePasswordVisibility"
            >
              <EyeOff v-if="showPassword" class="h-4 w-4" />
              <Eye v-else class="h-4 w-4" />
            </button>
          </div>
          <p v-if="isEditing" class="text-[10px] text-muted-foreground/50 px-1 flex items-center gap-1">
            <ShieldCheck class="h-3 w-3 text-df-success/60" />
            {{ t('connection.passwordSavedHint') }}
          </p>
        </div>
      </div>
    </section>

    <!-- Section 3: Targeted Resources -->
    <section class="space-y-5">
      <div class="flex items-center gap-2">
        <div class="h-1.5 w-1.5 rounded-full bg-primary/40"></div>
        <h3 class="text-xs font-black uppercase tracking-widest text-muted-foreground/80">{{ t('connection.targetLayer') || t('connection.targetEnvironment') }}</h3>
        <div class="flex-1 h-[1px] bg-border/40"></div>
      </div>

      <div class="space-y-2">
        <Label class="text-[11px] uppercase font-bold tracking-normal text-muted-foreground/70 px-1">{{ t('connection.database') }}</Label>
        <div class="relative group">
          <DbIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
          <Input
            :model-value="localValue.database"
            @update:model-value="updateField('database', $event as string)"
            :placeholder="t('connection.databasePlaceholder')"
            autocomplete="off"
            class="pl-10 h-10 bg-muted/10 border-border rounded-lg transition-[border-color,box-shadow] focus:ring-2 focus:ring-primary/5 text-xs font-semibold text-foreground placeholder:text-muted-foreground/30"
          />
        </div>
      </div>
    </section>

    <!-- Section 4: 环境与安全 -->
    <section class="space-y-5">
      <div class="flex items-center gap-2">
        <div class="h-1.5 w-1.5 rounded-full bg-primary/40"></div>
        <h3 class="text-xs font-black uppercase tracking-widest text-muted-foreground/80">{{ t('environment.sectionTitle') }}</h3>
        <div class="flex-1 h-[1px] bg-border/40"></div>
      </div>

      <!-- 环境类型选择器 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between px-1">
          <Label class="text-[11px] uppercase font-bold tracking-normal text-muted-foreground/70">{{ t('environment.type') }}</Label>
          <span class="text-[8px] font-mono text-muted-foreground/50 font-black tracking-tighter uppercase bg-muted/30 px-1 rounded-sm">ENV</span>
        </div>
        <Select :model-value="localValue.environment" @update:model-value="handleEnvironmentChange($event as EnvironmentType)">
          <SelectTrigger class="h-10 bg-muted/10 border-border rounded-lg transition-[border-color,box-shadow] focus:ring-2 focus:ring-primary/5 text-xs shadow-none">
            <template #default>
              <div class="flex items-center gap-1.5 min-w-0 font-bold">
                <div class="h-3 w-3 rounded-full shrink-0" :style="{ backgroundColor: ENV_PRESETS[localValue.environment]?.color ?? 'var(--muted-foreground)' }"></div>
                <SelectValue />
              </div>
            </template>
          </SelectTrigger>
          <SelectContent class="bg-popover border-border rounded-xl shadow-2xl">
            <SelectItem v-for="env in ENVIRONMENT_OPTIONS" :key="env" :value="env">
              <div class="flex items-center gap-2">
                <div class="h-2.5 w-2.5 rounded-full shrink-0" :style="{ backgroundColor: ENV_PRESETS[env].color }"></div>
                <span>{{ t(`environment.${env}`) }}</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- 只读模式 -->
      <div class="flex items-center justify-between px-1 py-2">
        <div class="space-y-0.5">
          <Label class="text-[11px] uppercase font-bold tracking-normal text-muted-foreground/70">{{ t('environment.readOnly') }}</Label>
          <p class="text-[9px] text-muted-foreground/50">{{ t('environment.readOnlyDesc') }}</p>
        </div>
        <Switch :checked="localValue.readOnly" @update:checked="updateField('readOnly', $event)" />
      </div>

      <!-- 危险操作确认 -->
      <div class="flex items-center justify-between px-1 py-2">
        <div class="space-y-0.5">
          <Label class="text-[11px] uppercase font-bold tracking-normal text-muted-foreground/70 flex items-center gap-1">
            <ShieldAlert class="h-3 w-3 text-destructive/60" />
            {{ t('environment.confirmDanger') }}
          </Label>
          <p class="text-[9px] text-muted-foreground/50">{{ t('environment.confirmDangerDesc') }}</p>
        </div>
        <Switch :checked="localValue.confirmDanger" @update:checked="updateField('confirmDanger', $event)" />
      </div>
    </section>


    <!-- Section 6: SSL/TLS 安全配置 -->
    <section class="space-y-5">
      <div class="flex items-center gap-2">
        <div class="h-1.5 w-1.5 rounded-full bg-primary/40"></div>
        <h3 class="text-xs font-black uppercase tracking-widest text-muted-foreground/80">{{ t('connection.sslTlsSecurity') }}</h3>
        <div class="flex-1 h-[1px] bg-border/40"></div>
      </div>

      <!-- SSL 模式选择器 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between px-1">
          <Label class="text-[11px] uppercase font-bold tracking-normal text-muted-foreground/70">{{ t('connection.sslMode') }}</Label>
          <span class="text-[8px] font-mono text-muted-foreground/50 font-black tracking-tighter uppercase bg-muted/30 px-1 rounded-sm">{{ t('connection.encryption') }}</span>
        </div>
        <Select :model-value="localValue.ssl?.mode ?? 'disabled'" @update:model-value="updateSslField('mode', $event as SslConfig['mode'])">
          <SelectTrigger class="h-10 bg-muted/10 border-border rounded-lg transition-[border-color,box-shadow] focus:ring-2 focus:ring-primary/5 text-xs shadow-none">
            <template #default>
              <div class="flex items-center gap-1.5 min-w-0 font-bold">
                <div class="h-5 w-5 rounded flex items-center justify-center bg-background/50 border border-border/50">
                  <ShieldCheck class="h-3 w-3 text-primary/70 shrink-0" />
                </div>
                <SelectValue />
              </div>
            </template>
          </SelectTrigger>
          <SelectContent class="bg-popover border-border rounded-xl shadow-2xl">
            <SelectItem v-for="opt in SSL_MODE_OPTIONS" :key="opt.value" :value="opt.value">
              <div class="flex flex-col gap-0.5">
                <span>{{ opt.label }}</span>
                <span class="text-[10px] text-muted-foreground/50 font-normal">{{ opt.desc }}</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- CA 证书文件选择器（仅 verify-ca / verify-identity 模式显示） -->
      <Transition name="form-fade">
        <div v-if="showCertFields" class="space-y-2 animate-in fade-in zoom-in-95 duration-300">
          <div class="flex items-center justify-between px-1">
            <Label class="text-[11px] uppercase font-bold tracking-normal text-muted-foreground/70 flex items-center gap-1">
              {{ t('connection.caCertificate') }}
              <span class="text-destructive font-black">*</span>
            </Label>
            <span class="text-[8px] font-mono text-muted-foreground/50 font-black tracking-tighter uppercase bg-muted/30 px-1 rounded-sm">{{ t('connection.rootCa') }}</span>
          </div>
          <div class="flex gap-2">
            <div class="relative group flex-1">
              <FileKey class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
              <Input
                :model-value="localValue.ssl?.caCertPath ?? ''"
                @update:model-value="updateSslField('caCertPath', $event as string)"
                placeholder="CA 证书文件路径"
                aria-required="true"
                class="pl-10 h-10 bg-muted/10 border-border rounded-lg transition-[border-color,box-shadow] focus:ring-primary/5 text-xs font-mono"
              />
            </div>
            <Button variant="outline" class="h-10 w-10 border-border bg-muted/10 hover:bg-primary/5 hover:border-primary/20 transition-[background-color,border-color] shadow-none px-0 rounded-lg" @click="browseCaCert">
              <FolderOpen class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Transition>

      <!-- 客户端证书文件选择器（非 disabled 模式可选配置） -->
      <Transition name="form-fade">
        <div v-if="showClientCertFields" class="space-y-4 animate-in fade-in zoom-in-95 duration-300">
          <!-- 客户端证书 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between px-1">
              <Label class="text-[11px] uppercase font-bold tracking-normal text-muted-foreground/70">{{ t('connection.clientCertificate') }}</Label>
              <span class="text-[8px] font-mono text-muted-foreground/50 font-black tracking-tighter uppercase bg-muted/30 px-1 rounded-sm">{{ t('connection.optional') }}</span>
            </div>
            <div class="flex gap-2">
              <div class="relative group flex-1">
                <FileLock class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
                <Input
                  :model-value="localValue.ssl?.clientCertPath ?? ''"
                  @update:model-value="updateSslField('clientCertPath', $event as string)"
                  placeholder="客户端证书文件路径"
                  class="pl-10 h-10 bg-muted/10 border-border rounded-lg transition-[border-color,box-shadow] focus:ring-primary/5 text-xs font-mono"
                />
              </div>
              <Button variant="outline" class="h-10 w-10 border-border bg-muted/10 hover:bg-primary/5 hover:border-primary/20 transition-[background-color,border-color] shadow-none px-0 rounded-lg" @click="browseClientCert">
                <FolderOpen class="h-4 w-4" />
              </Button>
            </div>
          </div>

          <!-- 客户端密钥 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between px-1">
              <Label class="text-[11px] uppercase font-bold tracking-normal text-muted-foreground/70">{{ t('connection.clientKey') }}</Label>
              <span class="text-[8px] font-mono text-muted-foreground/50 font-black tracking-tighter uppercase bg-muted/30 px-1 rounded-sm">{{ t('connection.optional') }}</span>
            </div>
            <div class="flex gap-2">
              <div class="relative group flex-1">
                <Lock class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
                <Input
                  :model-value="localValue.ssl?.clientKeyPath ?? ''"
                  @update:model-value="updateSslField('clientKeyPath', $event as string)"
                  placeholder="客户端密钥文件路径"
                  class="pl-10 h-10 bg-muted/10 border-border rounded-lg transition-[border-color,box-shadow] focus:ring-primary/5 text-xs font-mono"
                />
              </div>
              <Button variant="outline" class="h-10 w-10 border-border bg-muted/10 hover:bg-primary/5 hover:border-primary/20 transition-[background-color,border-color] shadow-none px-0 rounded-lg" @click="browseClientKey">
                <FolderOpen class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </Transition>
    </section>
  </div>
</template>
