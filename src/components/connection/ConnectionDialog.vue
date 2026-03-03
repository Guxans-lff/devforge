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

const canSave = computed(() =>
  form.value.name.trim().length > 0
  && form.value.host.trim().length > 0
  && !nameError.value
  && !portError.value
)

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
    <DialogContent class="sm:max-w-[480px] p-0 overflow-hidden border-none bg-transparent shadow-none">
      <div class="relative bg-background/80 backdrop-blur-3xl border border-white/10 rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <!-- Compact Header -->
        <DialogHeader class="relative px-6 pt-5 pb-3 shrink-0">
          <div class="absolute -top-10 -left-10 w-32 h-32 bg-primary/10 blur-3xl rounded-full opacity-20 pointer-events-none"></div>
          <DialogTitle class="text-lg font-black flex items-center gap-2">
            <Cpu class="h-4.5 w-4.5 text-primary" />
            {{ dialogTitle }}
          </DialogTitle>
          <DialogDescription class="text-[10px] font-medium opacity-50">
            {{ t('connection.dialogDescription') }}
          </DialogDescription>
        </DialogHeader>

        <!-- Main Content Area with Scrolling if needed -->
        <div class="px-6 pb-4 space-y-4 overflow-y-auto custom-scrollbar">
          <!-- Connection Type -->
          <div v-if="!isEditing" class="px-0.5">
            <div class="relative flex p-1 bg-muted/20 backdrop-blur-xl rounded-xl border border-white/5">
              <div 
                class="absolute top-1 bottom-1 transition-all duration-500 cubic-bezier(0.34, 1.56, 0.64, 1) bg-background shadow-sm rounded-lg border border-border/10 z-0"
                :style="{ 
                  left: connectionType === 'database' ? '4px' : (connectionType === 'ssh' ? 'calc(33.33% + 4px)' : 'calc(66.66% + 4px)'),
                  width: 'calc(33.33% - 8px)'
                }"
              ></div>

              <button 
                v-for="type in (['database', 'ssh', 'sftp'] as const)" 
                :key="type"
                @click="connectionType = type"
                class="relative z-10 flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[10px] font-black tracking-wide uppercase transition-all duration-500"
                :class="connectionType === type ? 'text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground/60'"
              >
                <component :is="type === 'database' ? Database : (type === 'ssh' ? Terminal : FolderOpen)" class="h-3.5 w-3.5" />
                {{ t(`connection.type${type.charAt(0).toUpperCase() + type.slice(1)}`) }}
              </button>
            </div>
          </div>

          <!-- Denser Form Flow -->
          <div class="space-y-3">
            <!-- Name Field (Integrated) -->
            <div class="space-y-1">
              <Label class="text-[10px] uppercase font-black tracking-widest text-muted-foreground/70 px-1">{{ t('connection.name') }}</Label>
              <div class="relative group">
                <Info class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 group-focus-within:text-primary transition-all" />
                <Input
                  v-model="form.name"
                  :placeholder="t('connection.namePlaceholder')"
                  class="pl-9 h-9 bg-background/40 border-white/5 rounded-lg transition-all focus:ring-primary/10 focus:border-primary/20 text-xs text-foreground placeholder:text-muted-foreground/30"
                  :class="{ 'border-destructive/30 ring-destructive/5': nameError }"
                />
              </div>
              <p v-if="nameError" class="mt-0.5 text-[9px] font-bold text-destructive px-1">{{ nameError }}</p>
            </div>

        <!-- Type-specific forms (Removed outer redundant container) -->
        <div class="animate-in fade-in duration-500">
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

        <!-- Test Result (Compressed) -->
        <div
          v-if="testResult"
          class="mx-6 mb-3 flex items-start gap-2.5 rounded-lg p-2.5 text-[10px] font-medium border animate-in fade-in slide-in-from-top-1 duration-300"
          :class="testResult.success ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/5 border-destructive/10 text-destructive'"
        >
          <ShieldCheck v-if="testResult.success" class="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <XCircle v-else class="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0 flex flex-col gap-0">
            <span class="font-black uppercase tracking-tight">{{ testResult.success ? t('connection.testSuccessTitle') : t('connection.testFailedTitle') }}</span>
            <span class="opacity-70 break-words line-clamp-2 leading-tight">{{ testResult.message }}</span>
          </div>
        </div>

        <DialogFooter class="flex sm:justify-between items-center bg-muted/5 px-6 py-3 border-t border-border/10 shrink-0">
        <Button
          variant="ghost"
          :disabled="testing || !form.host || !form.username"
          @click="handleTestConnection"
          class="h-9 px-4 rounded-xl font-bold transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
        >
          <div class="relative mr-2">
            <Loader2 v-if="testing" class="h-3.5 w-3.5 animate-spin" />
            <Plug v-else class="h-3.5 w-3.5" />
          </div>
          {{ t('connection.testConnection') }}
        </Button>
        <div class="flex items-center gap-2">
          <Button variant="ghost" @click="emit('update:open', false)" class="h-9 rounded-xl font-bold opacity-60 hover:opacity-100 hover:bg-muted/50">
            {{ t('common.cancel') }}
          </Button>
          <div class="h-4 w-[1px] bg-border/30 mx-1"></div>
          <Button
            v-if="connectionType === 'database'"
            variant="ghost"
            :disabled="saving || !canSave"
            @click="handleSave(true)"
            class="h-9 px-4 rounded-xl font-bold text-primary hover:bg-primary/10 active:scale-95"
          >
            <Loader2 v-if="saving" class="mr-2 h-3.5 w-3.5 animate-spin" />
            {{ t('connection.saveAndConnect') }}
          </Button>
          <Button 
            :disabled="saving || !canSave" 
            @click="handleSave(false)"
            class="h-8 px-5 rounded-lg font-black bg-primary text-primary-foreground shadow-md shadow-primary/20 transition-all hover:scale-105 active:scale-95 disabled:scale-100 disabled:opacity-50 text-[11px]"
          >
            <Loader2 v-if="saving" class="mr-1.5 h-3 w-3 animate-spin" />
            {{ saving ? t('common.saving') : t('common.save') }}
          </Button>
        </div>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>
</template>
