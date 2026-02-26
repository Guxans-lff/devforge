<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConnectionStore } from '@/stores/connections'
import { getCredential, testConnectionParams } from '@/api/connection'
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
import { Database, Terminal, FolderOpen, Loader2, Plug, CheckCircle2, XCircle } from 'lucide-vue-next'
import DatabaseForm from './DatabaseForm.vue'
import SshForm from './SshForm.vue'
import SftpForm from './SftpForm.vue'
import type { ConnectionRecord } from '@/api/connection'

const props = defineProps<{
  open: boolean
  editingConnection?: ConnectionRecord | null
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
  remotePath: '/',
  sshConnectionId: '',
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
  }),
  set: (value) => {
    form.value.host = value.host
    form.value.port = value.port
    form.value.username = value.username
    form.value.password = value.password
    form.value.authMethod = value.authMethod
    form.value.privateKeyPath = value.privateKeyPath
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

      try {
        const config = JSON.parse(conn.configJson)
        form.value.database = config.database ?? ''
        form.value.driver = config.driver ?? 'mysql'
        form.value.authMethod = config.authMethod ?? 'password'
        form.value.privateKeyPath = config.privateKeyPath ?? ''
        form.value.remotePath = config.remotePath ?? '/'
        form.value.sshConnectionId = config.sshConnectionId ?? ''
      } catch {
        // ignore parse errors
      }
    } else if (open) {
      resetForm()
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
    remotePath: '/',
    sshConnectionId: '',
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
    return JSON.stringify({
      authMethod: form.value.authMethod,
      privateKeyPath: form.value.privateKeyPath || undefined,
    })
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
    <DialogContent class="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>{{ dialogTitle }}</DialogTitle>
        <DialogDescription>
          {{ t('connection.dialogDescription') }}
        </DialogDescription>
      </DialogHeader>

      <!-- Connection Type Tabs -->
      <Tabs
        v-if="!isEditing"
        :model-value="connectionType"
        @update:model-value="connectionType = $event as 'database' | 'ssh' | 'sftp'"
        class="w-full"
      >
        <TabsList class="grid w-full grid-cols-3">
          <TabsTrigger value="database" class="flex items-center gap-1.5">
            <Database class="h-3.5 w-3.5" />
            {{ t('connection.typeDatabase') }}
          </TabsTrigger>
          <TabsTrigger value="ssh" class="flex items-center gap-1.5">
            <Terminal class="h-3.5 w-3.5" />
            SSH
          </TabsTrigger>
          <TabsTrigger value="sftp" class="flex items-center gap-1.5">
            <FolderOpen class="h-3.5 w-3.5" />
            SFTP
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <!-- Common Fields -->
      <div class="grid gap-4 py-2">
        <div class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right">{{ t('connection.name') }}</Label>
          <div class="col-span-3">
            <Input
              v-model="form.name"
              :placeholder="t('connection.namePlaceholder')"
              :class="{ 'border-destructive': nameError }"
            />
            <p v-if="nameError" class="mt-1 text-xs text-destructive">{{ nameError }}</p>
          </div>
        </div>

        <!-- Type-specific forms -->
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

      <!-- Test Result -->
      <div
        v-if="testResult"
        class="flex items-center gap-2 rounded-md px-3 py-2 text-sm"
        :class="testResult.success ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-destructive/10 text-destructive'"
      >
        <CheckCircle2 v-if="testResult.success" class="h-4 w-4 shrink-0" />
        <XCircle v-else class="h-4 w-4 shrink-0" />
        <span class="truncate">{{ testResult.message }}</span>
      </div>

      <DialogFooter class="gap-2 sm:gap-0">
        <Button
          variant="outline"
          :disabled="testing || !form.host || !form.username"
          @click="handleTestConnection"
          class="mr-auto"
        >
          <Loader2 v-if="testing" class="mr-2 h-4 w-4 animate-spin" />
          <Plug v-else class="mr-2 h-4 w-4" />
          {{ t('connection.testConnection') }}
        </Button>
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t('common.cancel') }}
        </Button>
        <Button
          v-if="connectionType === 'database'"
          variant="outline"
          :disabled="saving || !canSave"
          @click="handleSave(true)"
        >
          <Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />
          {{ t('connection.saveAndConnect') }}
        </Button>
        <Button :disabled="saving || !canSave" @click="handleSave(false)">
          <Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />
          {{ saving ? t('common.saving') : t('common.save') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
