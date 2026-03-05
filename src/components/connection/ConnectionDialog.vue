<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConnectionStore } from '@/stores/connections'
import { getCredential, saveCredential, testConnectionParams } from '@/api/connection'
import { sshTestConnectionParams } from '@/api/ssh'
import { useToast } from '@/composables/useToast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Database, Terminal, FolderOpen, Loader2, Plug, CheckCircle2, XCircle, Info, ShieldCheck, Cpu } from 'lucide-vue-next'
import DatabaseForm from './DatabaseForm.vue'
import SshForm from './SshForm.vue'
import SftpForm from './SftpForm.vue'
import type { ConnectionRecord } from '@/api/connection'

const props = defineProps<{
  open: boolean
  editingConnection?: ConnectionRecord | null
  defaultType?: 'database' | 'ssh' | 'sftp'
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
  connect: [connectionId: string, connectionName: string]
}>()

const { t } = useI18n()
const connectionStore = useConnectionStore()
const toast = useToast()

const saving = ref(false)
const showPassword = ref(false)
const testing = ref(false)
const testResult = ref<{ success: boolean; message: string } | null>(null)
const connectionType = ref<'database' | 'ssh' | 'sftp'>('database')

// Form fields
const form = ref({
  name: '',
  host: '',
  port: 3306,
  username: '',
  password: '',
  database: '',
  driver: 'mysql',
  authMethod: 'password' as 'password' | 'key',
  privateKeyPath: '',
  passphrase: '',
  remotePath: '/',
  sshConnectionId: '',
  proxyJumpEnabled: false,
  proxyJumpConnectionId: '',
})

const isEditing = computed(() => !!props.editingConnection)

const nameError = computed(() => {
  const name = form.value.name.trim()
  if (!name) return ''
  if (name.length > 64) return t('connection.nameTooLong')
  return ''
})

const portError = computed(() => {
  const port = form.value.port
  if (port < 0 || port > 65535) return t('connection.portOutOfRange')
  return ''
})

const canSave = computed(() => {
  const hasName = form.value.name.trim().length > 0
  const hasHost = form.value.host.trim().length > 0
  const hasUser = form.value.username.trim().length > 0
  
  // Database type also usually needs a username, but we'll stick to a slightly broader check
  return hasName && hasHost && hasUser && !nameError.value && !portError.value
})

const dialogTitle = computed(() =>
  isEditing.value ? t('connection.editConnection') : t('connection.newConnection'),
)

const databaseFormData = computed({
  get: () => ({
    driver: form.value.driver,
    host: form.value.host,
    port: form.value.port,
    username: form.value.username,
    password: form.value.password,
    database: form.value.database,
  }),
  set: (value) => {
    form.value.driver = value.driver
    form.value.host = value.host
    form.value.port = value.port
    form.value.username = value.username
    form.value.password = value.password
    form.value.database = value.database
  },
})

const sshFormData = computed({
  get: () => ({
    host: form.value.host,
    port: form.value.port,
    username: form.value.username,
    password: form.value.password,
    authMethod: form.value.authMethod,
    privateKeyPath: form.value.privateKeyPath,
    passphrase: form.value.passphrase,
    proxyJumpEnabled: form.value.proxyJumpEnabled,
    proxyJumpConnectionId: form.value.proxyJumpConnectionId,
  }),
  set: (value) => {
    form.value.host = value.host
    form.value.port = value.port
    form.value.username = value.username
    form.value.password = value.password
    form.value.authMethod = value.authMethod
    form.value.privateKeyPath = value.privateKeyPath
    form.value.passphrase = value.passphrase
    form.value.proxyJumpEnabled = value.proxyJumpEnabled
    form.value.proxyJumpConnectionId = value.proxyJumpConnectionId
  },
})

const sftpFormData = computed({
  get: () => ({
    host: form.value.host,
    port: form.value.port,
    username: form.value.username,
    password: form.value.password,
    authMethod: form.value.authMethod,
    privateKeyPath: form.value.privateKeyPath,
    passphrase: form.value.passphrase,
    remotePath: form.value.remotePath,
    sshConnectionId: form.value.sshConnectionId,
  }),
  set: (value) => {
    form.value.host = value.host
    form.value.port = value.port
    form.value.username = value.username
    form.value.password = value.password
    form.value.authMethod = value.authMethod
    form.value.privateKeyPath = value.privateKeyPath
    form.value.passphrase = value.passphrase
    form.value.remotePath = value.remotePath
    form.value.sshConnectionId = value.sshConnectionId
  },
})

watch(
  () => props.open,
  async (open) => {
    if (open && props.editingConnection) {
      showPassword.value = false
      testResult.value = null
      const conn = props.editingConnection
      connectionType.value = conn.type as 'database' | 'ssh' | 'sftp'
      form.value.name = conn.name
      form.value.host = conn.host
      form.value.port = conn.port
      form.value.username = conn.username
      form.value.password = ''

      try {
        const stored = await getCredential(conn.id)
        form.value.password = stored ?? ''
      } catch {
        // credential not found, leave empty
      }

      // 加载私钥密码短语
      try {
        const storedPassphrase = await getCredential(`${conn.id}:passphrase`)
        form.value.passphrase = storedPassphrase ?? ''
      } catch {
        // passphrase not found, leave empty
      }

      try {
        const config = JSON.parse(conn.configJson)
        form.value.database = config.database ?? ''
        form.value.driver = config.driver ?? 'mysql'
        form.value.authMethod = config.authMethod ?? 'password'
        form.value.privateKeyPath = config.privateKeyPath ?? ''
        form.value.remotePath = config.remotePath ?? '/'
        form.value.sshConnectionId = config.sshConnectionId ?? ''
        form.value.proxyJumpEnabled = !!config.proxyJump?.connectionId
        form.value.proxyJumpConnectionId = config.proxyJump?.connectionId ?? ''
      } catch {
        // ignore parse errors
      }
    } else if (open) {
      resetForm()
      if (props.defaultType) {
        connectionType.value = props.defaultType
      }
    }
  },
)

watch(connectionType, (type) => {
  if (!isEditing.value) {
    if (type === 'ssh' || type === 'sftp') {
      form.value.port = 22
    } else {
      const defaultPorts: Record<string, number> = {
        mysql: 3306,
        postgresql: 5432,
        sqlite: 0,
        mssql: 1433,
      }
      form.value.port = defaultPorts[form.value.driver] ?? 3306
    }
  }
})

function resetForm() {
  connectionType.value = 'database'
  showPassword.value = false
  testResult.value = null
  form.value = {
    name: '',
    host: '',
    port: 3306,
    username: '',
    password: '',
    database: '',
    driver: 'mysql',
    authMethod: 'password',
    privateKeyPath: '',
    passphrase: '',
    remotePath: '/',
    sshConnectionId: '',
    proxyJumpEnabled: false,
    proxyJumpConnectionId: '',
  }
}

async function handleSave(connectAfter = false) {
  saving.value = true
  try {
    const configJson = buildConfigJson()
    let savedId: string
    let savedName: string

    if (isEditing.value && props.editingConnection) {
      const record = await connectionStore.editConnection(props.editingConnection.id, {
        name: form.value.name,
        host: form.value.host,
        port: form.value.port,
        username: form.value.username,
        configJson,
        password: form.value.password || undefined,
      })
      savedId = record.id
      savedName = record.name
    } else {
      const record = await connectionStore.addConnection({
        name: form.value.name,
        type: connectionType.value,
        host: form.value.host,
        port: form.value.port,
        username: form.value.username,
        configJson,
        password: form.value.password || undefined,
      })
      savedId = record.id
      savedName = record.name
    }

    // 保存私钥密码短语到 credential manager
    if (form.value.authMethod === 'key' && form.value.passphrase) {
      await saveCredential(`${savedId}:passphrase`, form.value.passphrase)
    }

    emit('saved')
    emit('update:open', false)

    if (connectAfter && connectionType.value === 'database') {
      emit('connect', savedId, savedName)
    }
  } catch (e) {
    toast.error(t('connection.saveFailed'), String(e))
  } finally {
    saving.value = false
  }
}

function buildConfigJson(): string {
  if (connectionType.value === 'database') {
    return JSON.stringify({
      driver: form.value.driver,
      database: form.value.database,
    })
  }
  if (connectionType.value === 'ssh') {
    const config: Record<string, unknown> = {
      authMethod: form.value.authMethod,
      privateKeyPath: form.value.privateKeyPath || undefined,
    }
    if (form.value.proxyJumpEnabled && form.value.proxyJumpConnectionId) {
      config.proxyJump = { connectionId: form.value.proxyJumpConnectionId }
    }
    return JSON.stringify(config)
  }
  // sftp
  return JSON.stringify({
    authMethod: form.value.authMethod,
    privateKeyPath: form.value.privateKeyPath || undefined,
    remotePath: form.value.remotePath,
    sshConnectionId: form.value.sshConnectionId || undefined,
  })
}

async function handleTestConnection() {
  testing.value = true
  testResult.value = null
  try {
    let result
    if (connectionType.value === 'database') {
      result = await testConnectionParams({
        host: form.value.host,
        port: form.value.port,
        username: form.value.username,
        password: form.value.password,
        database: form.value.database || undefined,
        driver: form.value.driver,
      })
    } else {
      result = await sshTestConnectionParams({
        host: form.value.host,
        port: form.value.port,
        username: form.value.username,
        password: form.value.password,
        authMethod: form.value.authMethod,
        privateKeyPath: form.value.privateKeyPath || undefined,
        passphrase: form.value.passphrase || undefined,
      })
    }
    testResult.value = { success: result.success, message: result.message }
  } catch (e) {
    testResult.value = { success: false, message: String(e) }
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[850px] p-0 overflow-hidden border border-border bg-background shadow-2xl rounded-xl">
      <div class="flex flex-row h-[520px] bg-background">
        <!-- Sidebar: Control Panel (Industrial Dark) -->
        <aside class="w-[280px] shrink-0 flex flex-col border-r border-border/60 bg-muted/20 industrial-grid text-muted-foreground/10 noise-texture relative overflow-hidden">
          <div class="relative z-20 p-6 pb-4">
            <div class="flex items-center gap-2 mb-1">
              <div class="p-1.5 rounded-md bg-primary/10 border border-primary/20">
                <Cpu class="h-4 w-4 text-primary" />
              </div>
              <h2 class="text-sm font-black uppercase tracking-wider text-foreground">{{ dialogTitle }}</h2>
            </div>
            <p class="text-[10px] font-medium text-muted-foreground/60 leading-tight">
              {{ t('connection.dialogDescription') }}
            </p>
          </div>

          <div class="relative z-20 flex-1 px-4 py-2 space-y-6 overflow-y-auto custom-scrollbar">
            <!-- Connection Type Selector (Vertical Modern with Slider) -->
            <div v-if="!isEditing" class="space-y-3">
              <div class="flex items-center justify-between px-2">
                <Label class="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">{{ t('connection.type') || 'Select Protocol' }}</Label>
                <div class="h-1 w-1 rounded-full bg-primary/40 animate-pulse"></div>
              </div>
              
              <div class="relative space-y-1">
                <!-- Moving Slider Background -->
                <div 
                  class="absolute left-0 w-full bg-primary rounded-lg shadow-lg shadow-primary/20 transition-all duration-300 ease-out z-0"
                  :style="{
                    height: '44px',
                    top: `${(['database', 'ssh', 'sftp'].indexOf(connectionType)) * 48}px`,
                    opacity: 1
                  }"
                ></div>

                <button 
                  v-for="type in (['database', 'ssh', 'sftp'] as const)" 
                  :key="type"
                  @click="connectionType = type"
                  class="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-bold transition-all group z-10 h-[44px]"
                  :class="connectionType === type 
                    ? 'text-primary-foreground' 
                    : 'text-muted-foreground/60 hover:text-muted-foreground'"
                >
                  <component :is="type === 'database' ? Database : (type === 'ssh' ? Terminal : FolderOpen)" 
                    class="h-4 w-4 shrink-0 transition-transform duration-300"
                    :class="connectionType === type ? 'scale-110' : 'group-hover:scale-105'" 
                  />
                  <span class="truncate">{{ t(`connection.type${type.charAt(0).toUpperCase() + type.slice(1)}`) }}</span>
                  
                  <div v-if="connectionType === type" class="ml-auto flex gap-0.5">
                    <div class="w-0.5 h-2 bg-primary-foreground/40 rounded-full"></div>
                    <div class="w-0.5 h-3 bg-primary-foreground/60 rounded-full"></div>
                    <div class="w-0.5 h-2 bg-primary-foreground/40 rounded-full"></div>
                  </div>
                </button>
              </div>
            </div>

            <!-- Basic Identification -->
            <div class="space-y-4 pt-2">
              <div class="space-y-1.5 px-1">
                <div class="flex items-center gap-2 px-1 mb-1">
                  <div class="h-1 w-1 rounded-full bg-primary/30"></div>
                  <Label class="text-[10px] uppercase font-bold tracking-tight text-muted-foreground/70 truncate flex items-center gap-1">
                    {{ t('connection.name') }}
                    <span class="text-destructive font-black">*</span>
                  </Label>
                </div>
                <div class="relative group">
                  <div class="absolute inset-y-0 left-3 flex items-center pointer-events-none text-muted-foreground/20 group-focus-within:text-primary transition-colors text-[10px] font-black mono tracking-tighter">IDX</div>
                  <Input
                    v-model="form.name"
                    :placeholder="t('connection.namePlaceholder')"
                    autocomplete="off"
                    class="pl-10 h-9 bg-muted/20 border-border/40 rounded-md transition-all focus:ring-2 focus:ring-primary/5 focus:border-primary/40 text-[11px] font-semibold text-foreground placeholder:text-muted-foreground/40"
                    :class="{ 'border-destructive/40 bg-destructive/5': nameError }"
                  />
                </div>
                <p v-if="nameError" class="mt-1 text-[9px] font-bold text-destructive px-1 leading-tight">{{ nameError }}</p>
              </div>
            </div>
          </div>

          <!-- Sidebar Footer Actions -->
          <div class="relative z-20 p-4 border-t border-border/40 bg-muted/10 space-y-3">
            <!-- New: Inline Test Result in Sidebar -->
            <div
              v-if="testResult"
              class="rounded-lg p-3 text-[10px] font-medium border animate-in fade-in slide-in-from-bottom-2 duration-300 overflow-hidden relative group"
              :class="testResult.success ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/5 border-destructive/20 text-destructive'"
            >
              <div class="flex items-start gap-2 relative z-10">
                <CheckCircle2 v-if="testResult.success" class="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <XCircle v-else class="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div class="flex-1 min-w-0">
                  <div class="font-black uppercase tracking-wider mb-0.5">{{ testResult.success ? t('connection.testSuccessTitle') : t('connection.testFailedTitle') }}</div>
                  <div class="opacity-80 break-words leading-tight">{{ testResult.message }}</div>
                </div>
                <button @click="testResult = null" class="opacity-0 group-hover:opacity-40 hover:opacity-100 transition-opacity">
                  <XCircle class="h-3 w-3" />
                </button>
              </div>
            </div>

            <Button
              variant="outline"
              :disabled="testing || !form.host || !form.username"
              @click="handleTestConnection"
              class="w-full h-9 rounded-md font-bold text-[11px] border-border/60 bg-background hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all shadow-sm group relative overflow-hidden"
            >
              <div class="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity industrial-grid text-primary/20"></div>
              <div class="relative flex items-center justify-center gap-2">
                <Loader2 v-if="testing" class="h-3 w-3 animate-spin text-primary" />
                <Plug v-else class="h-3 w-3 group-hover:rotate-12 transition-transform text-muted-foreground/60 group-hover:text-primary-foreground" />
                <span class="text-muted-foreground group-hover:text-primary-foreground">{{ t('connection.testConnection') }}</span>
              </div>
            </Button>
          </div>
        </aside>

        <!-- Detail Pane: Configuration Sub-Form -->
        <main class="flex-1 flex flex-col min-w-0 bg-background/30">
          <!-- Scrollable detail area -->
          <div class="flex-1 overflow-y-auto custom-scrollbar p-8">
            <div class="max-w-xl mx-auto space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
              <!-- Sub-form injection with key to trigger re-animation on type change -->
              <div :key="connectionType">
                <DatabaseForm
                  v-if="connectionType === 'database'"
                  v-model="databaseFormData"
                  v-model:show-password="showPassword"
                  :is-editing="isEditing"
                />

                <SshForm
                  v-if="connectionType === 'ssh'"
                  v-model="sshFormData"
                  v-model:show-password="showPassword"
                  :is-editing="isEditing"
                />

                <SftpForm
                  v-if="connectionType === 'sftp'"
                  v-model="sftpFormData"
                  v-model:show-password="showPassword"
                  :is-editing="isEditing"
                />
              </div>
            </div>
          </div>

          <!-- Bottom Action Bar (Fixed at bottom of right pane) -->
          <footer class="h-16 px-8 flex items-center justify-between border-t border-border/40 bg-muted/5 shrink-0 industrial-grid text-muted-foreground/5 overflow-hidden relative">
            <div class="flex items-center gap-2 relative z-10 w-40 shrink-0">
              <span class="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 font-mono truncate">
                {{ canSave ? t('connection.readyToSave') || 'Ready to deploy' : t('connection.awaitingCoreParams') || 'Awaiting entry' }}
              </span>
            </div>

            <div class="flex items-center gap-3 shrink-0">
              <Button variant="ghost" @click="emit('update:open', false)" class="h-9 w-24 rounded-md font-black text-xs text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors shrink-0 !justify-center !px-0 flex">
                {{ t('common.cancel') }}
              </Button>
              <div class="h-4 w-[1px] bg-border/20 shrink-0"></div>
              
              <Button
                v-if="connectionType === 'database'"
                variant="ghost"
                :disabled="saving || !canSave"
                @click="handleSave(true)"
                class="h-9 w-[130px] rounded-md font-black text-xs text-primary hover:bg-primary/5 active:scale-95 disabled:opacity-30 shrink-0 !justify-center !px-0 flex"
              >
                <div class="flex items-center justify-center gap-2">
                  <Loader2 v-if="saving" class="h-3.5 w-3.5 animate-spin" />
                  <span class="truncate">{{ t('connection.saveAndConnect') }}</span>
                </div>
              </Button>
 
              <Button 
                :disabled="saving || !canSave" 
                @click="handleSave(false)"
                class="h-9 w-24 rounded-md font-black bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50 text-xs relative overflow-hidden shrink-0 !justify-center !px-0 flex"
                :class="{ 'pulse-ready': canSave && !saving }"
              >
                <div v-if="canSave && !saving" class="absolute inset-0 bg-white/10 animate-pulse"></div>
                <div class="relative flex items-center justify-center gap-2">
                  <Loader2 v-if="saving" class="h-3 w-3 animate-spin" />
                  <Save v-else-if="canSave" class="h-3.5 w-3.5 animate-in zoom-in-50 duration-300" />
                  <span>{{ saving ? t('common.saving') : t('common.save') }}</span>
                </div>
              </Button>
            </div>
          </footer>
        </main>
      </div>
    </DialogContent>
  </Dialog>
</template>
