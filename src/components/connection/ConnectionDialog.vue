<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConnectionStore } from '@/stores/connections'
import { getCredential, saveCredential, testConnectionParams } from '@/api/connection'
import { sshTestConnectionParams } from '@/api/ssh'
import { useToast } from '@/composables/useToast'
import { parseBackendError } from '@/types/error'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Database, Terminal, FolderOpen, Loader2, Plug, CheckCircle2, XCircle, Cpu, Container, GitBranch } from 'lucide-vue-next'
import DatabaseForm from './DatabaseForm.vue'
import SshForm from './SshForm.vue'
import SftpForm from './SftpForm.vue'
import RedisForm from './RedisForm.vue'
import GitForm from './GitForm.vue'
import type { ConnectionRecord } from '@/api/connection'
import { redisTestConnection, redisTestClusterConnection, redisTestSentinelConnection } from '@/api/redis'
import { tunnelOpen, tunnelClose } from '@/api/tunnel'
import type { SslConfig } from '@/types/connection'
import type { EnvironmentType } from '@/types/environment'

const props = defineProps<{
  open: boolean
  editingConnection?: ConnectionRecord | null
  defaultType?: 'database' | 'ssh' | 'sftp' | 'redis' | 'git'
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
let testResultTimer: ReturnType<typeof setTimeout> | null = null
const connectionType = ref<'database' | 'ssh' | 'sftp' | 'redis' | 'git'>('database')

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
  ssl: {
    mode: 'disabled',
    caCertPath: '',
    clientCertPath: '',
    clientKeyPath: '',
  } as SslConfig,
  environment: 'development' as EnvironmentType,
  readOnly: false,
  confirmDanger: false,
  // Redis SSH 隧道
  useSshTunnel: false,
  sshHost: '',
  sshPort: 22,
  sshUsername: '',
  sshPassword: '',
  sshAuthMethod: 'password' as 'password' | 'key',
  sshPrivateKeyPath: '',
  sshPassphrase: '',
  // Redis Cluster
  isCluster: false,
  clusterNodes: [] as string[],
  // Redis Sentinel
  isSentinel: false,
  sentinelNodes: [] as string[],
  sentinelMasterName: '',
  sentinelPassword: '',
  // Git
  repositoryPath: '',
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

  // Git 只需要 name + repositoryPath
  if (connectionType.value === 'git') {
    return hasName && form.value.repositoryPath.trim().length > 0 && !nameError.value
  }

  const hasHost = form.value.host.trim().length > 0

  // Redis 不需要用户名
  if (connectionType.value === 'redis') {
    return hasName && hasHost && !nameError.value && !portError.value
  }

  const hasUser = form.value.username.trim().length > 0
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
    ssl: form.value.ssl,
    environment: form.value.environment,
    readOnly: form.value.readOnly,
    confirmDanger: form.value.confirmDanger,
  }),
  set: (value) => {
    form.value.driver = value.driver
    form.value.host = value.host
    form.value.port = value.port
    form.value.username = value.username
    form.value.password = value.password
    form.value.database = value.database
    form.value.ssl = value.ssl
    form.value.environment = value.environment
    form.value.readOnly = value.readOnly
    form.value.confirmDanger = value.confirmDanger
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

const redisFormData = computed({
  get: () => ({
    host: form.value.host,
    port: form.value.port,
    password: form.value.password,
    database: parseInt(form.value.database) || 0,
    useTls: form.value.ssl?.mode !== 'disabled',
    isCluster: form.value.isCluster,
    clusterNodes: form.value.clusterNodes,
    isSentinel: form.value.isSentinel,
    sentinelNodes: form.value.sentinelNodes,
    sentinelMasterName: form.value.sentinelMasterName,
    sentinelPassword: form.value.sentinelPassword,
    useSshTunnel: form.value.useSshTunnel,
    sshHost: form.value.sshHost,
    sshPort: form.value.sshPort,
    sshUsername: form.value.sshUsername,
    sshPassword: form.value.sshPassword,
    sshAuthMethod: form.value.sshAuthMethod,
    sshPrivateKeyPath: form.value.sshPrivateKeyPath,
    sshPassphrase: form.value.sshPassphrase,
  }),
  set: (value) => {
    form.value.host = value.host
    form.value.port = value.port
    form.value.password = value.password
    form.value.database = String(value.database)
    form.value.ssl = { ...form.value.ssl, mode: value.useTls ? 'required' : 'disabled' }
    form.value.isCluster = value.isCluster
    form.value.clusterNodes = value.clusterNodes
    form.value.isSentinel = value.isSentinel
    form.value.sentinelNodes = value.sentinelNodes
    form.value.sentinelMasterName = value.sentinelMasterName
    form.value.sentinelPassword = value.sentinelPassword
    form.value.useSshTunnel = value.useSshTunnel
    form.value.sshHost = value.sshHost
    form.value.sshPort = value.sshPort
    form.value.sshUsername = value.sshUsername
    form.value.sshPassword = value.sshPassword
    form.value.sshAuthMethod = value.sshAuthMethod
    form.value.sshPrivateKeyPath = value.sshPrivateKeyPath
    form.value.sshPassphrase = value.sshPassphrase
  },
})

const gitFormData = computed({
  get: () => ({
    repositoryPath: form.value.repositoryPath,
  }),
  set: (value) => {
    form.value.repositoryPath = value.repositoryPath
  },
})

// 成功时自动消失
watch(testResult, (val) => {
  if (testResultTimer) clearTimeout(testResultTimer)
  if (val?.success) {
    testResultTimer = setTimeout(() => { testResult.value = null }, 3000)
  }
})

watch(
  () => props.open,
  async (open) => {
    if (open && props.editingConnection) {
      showPassword.value = false
      testResult.value = null
      const conn = props.editingConnection
      connectionType.value = conn.type as 'database' | 'ssh' | 'sftp' | 'redis' | 'git'
      form.value.name = conn.name
      form.value.host = conn.host
      form.value.port = conn.port
      form.value.username = conn.username
      form.value.password = ''

      // Git 连接把路径存在 host 字段
      if (conn.type === 'git') {
        form.value.repositoryPath = conn.host
      }

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

      // 加载 Redis SSH 隧道凭据
      try {
        const storedSshPwd = await getCredential(`${conn.id}:sshPassword`)
        form.value.sshPassword = storedSshPwd ?? ''
      } catch { /* not found */ }
      try {
        const storedSshPassphrase = await getCredential(`${conn.id}:sshPassphrase`)
        form.value.sshPassphrase = storedSshPassphrase ?? ''
      } catch { /* not found */ }

      // 加载 Redis Sentinel 密码
      try {
        const storedSentinelPwd = await getCredential(`${conn.id}:sentinelPassword`)
        form.value.sentinelPassword = storedSentinelPwd ?? ''
      } catch { /* not found */ }

      try {
        const config = JSON.parse(conn.configJson)
        // Git 连接：从 configJson 恢复 repositoryPath
        if (conn.type === 'git') {
          form.value.repositoryPath = config.repositoryPath ?? conn.host ?? ''
        }
        form.value.database = config.database ?? ''
        form.value.driver = config.driver ?? 'mysql'
        form.value.authMethod = config.authMethod ?? 'password'
        form.value.privateKeyPath = config.privateKeyPath ?? ''
        form.value.remotePath = config.remotePath ?? '/'
        form.value.sshConnectionId = config.sshConnectionId ?? ''
        form.value.proxyJumpEnabled = !!config.proxyJump?.connectionId
        form.value.proxyJumpConnectionId = config.proxyJump?.connectionId ?? ''
        // 加载环境配置
        form.value.environment = config.environment ?? 'development'
        form.value.readOnly = config.readOnly === true
        form.value.confirmDanger = typeof config.confirmDanger === 'boolean'
          ? config.confirmDanger
          : (config.environment === 'production' || config.environment === 'staging')
        // 加载 SSL 配置
        if (config.ssl) {
          form.value.ssl = {
            mode: config.ssl.mode ?? 'disabled',
            caCertPath: config.ssl.caCertPath ?? '',
            clientCertPath: config.ssl.clientCertPath ?? '',
            clientKeyPath: config.ssl.clientKeyPath ?? '',
          }
        }
        // 加载 Redis SSH 隧道配置
        if (config.sshTunnel?.enabled) {
          form.value.useSshTunnel = true
          form.value.sshHost = config.sshTunnel.sshHost ?? ''
          form.value.sshPort = config.sshTunnel.sshPort ?? 22
          form.value.sshUsername = config.sshTunnel.sshUsername ?? ''
          form.value.sshAuthMethod = config.sshTunnel.authMethod ?? 'password'
          form.value.sshPrivateKeyPath = config.sshTunnel.privateKeyPath ?? ''
        }
        // 加载 Redis Cluster 配置
        if (config.isCluster) {
          form.value.isCluster = true
          form.value.clusterNodes = config.clusterNodes ?? []
        }
        // 加载 Redis Sentinel 配置
        if (config.isSentinel) {
          form.value.isSentinel = true
          form.value.sentinelNodes = config.sentinelNodes ?? []
          form.value.sentinelMasterName = config.sentinelMasterName ?? ''
        }
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
    } else if (type === 'redis') {
      form.value.port = 6379
    } else if (type === 'git') {
      form.value.port = 0
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
    ssl: {
      mode: 'disabled',
      caCertPath: '',
      clientCertPath: '',
      clientKeyPath: '',
    },
    environment: 'development' as EnvironmentType,
    readOnly: false,
    confirmDanger: false,
    useSshTunnel: false,
    sshHost: '',
    sshPort: 22,
    sshUsername: '',
    sshPassword: '',
    sshAuthMethod: 'password' as 'password' | 'key',
    sshPrivateKeyPath: '',
    sshPassphrase: '',
    isCluster: false,
    clusterNodes: [] as string[],
    isSentinel: false,
    sentinelNodes: [] as string[],
    sentinelMasterName: '',
    sentinelPassword: '',
    repositoryPath: '',
  }
}

async function handleSave(connectAfter = false) {
  saving.value = true
  try {
    const configJson = buildConfigJson()
    let savedId: string
    let savedName: string

    // Git 连接：路径存在 host 字段
    const saveHost = connectionType.value === 'git' ? form.value.repositoryPath : form.value.host
    const savePort = connectionType.value === 'git' ? 0 : form.value.port
    const saveUsername = connectionType.value === 'git' ? '' : form.value.username

    if (isEditing.value && props.editingConnection) {
      const record = await connectionStore.editConnection(props.editingConnection.id, {
        name: form.value.name,
        host: saveHost,
        port: savePort,
        username: saveUsername,
        configJson,
        password: form.value.password || undefined,
      })
      savedId = record.id
      savedName = record.name
    } else {
      const record = await connectionStore.addConnection({
        name: form.value.name,
        type: connectionType.value,
        host: saveHost,
        port: savePort,
        username: saveUsername,
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

    // 保存 Redis SSH 隧道凭据
    if (connectionType.value === 'redis' && form.value.useSshTunnel) {
      if (form.value.sshPassword) {
        await saveCredential(`${savedId}:sshPassword`, form.value.sshPassword)
      }
      if (form.value.sshAuthMethod === 'key' && form.value.sshPassphrase) {
        await saveCredential(`${savedId}:sshPassphrase`, form.value.sshPassphrase)
      }
    }

    // 保存 Redis Sentinel 密码
    if (connectionType.value === 'redis' && form.value.isSentinel && form.value.sentinelPassword) {
      await saveCredential(`${savedId}:sentinelPassword`, form.value.sentinelPassword)
    }

    emit('saved')
    emit('update:open', false)

    if (connectAfter && (connectionType.value === 'database' || connectionType.value === 'redis' || connectionType.value === 'git')) {
      emit('connect', savedId, savedName)
    }
  } catch (e) {
    toast.error(t('connection.saveFailed'), String(e))
  } finally {
    saving.value = false
  }
}

function buildConfigJson(): string {
  if (connectionType.value === 'git') {
    return JSON.stringify({
      repositoryPath: form.value.repositoryPath,
    })
  }
  if (connectionType.value === 'database') {
    const config: Record<string, unknown> = {
      driver: form.value.driver,
      database: form.value.database,
      environment: form.value.environment,
      readOnly: form.value.readOnly,
      confirmDanger: form.value.confirmDanger,
    }
    // 仅在非 disabled 模式下保存 SSL 配置
    if (form.value.ssl && form.value.ssl.mode !== 'disabled') {
      const sslConfig: Record<string, unknown> = {
        mode: form.value.ssl.mode,
      }
      if (form.value.ssl.caCertPath) sslConfig.caCertPath = form.value.ssl.caCertPath
      if (form.value.ssl.clientCertPath) sslConfig.clientCertPath = form.value.ssl.clientCertPath
      if (form.value.ssl.clientKeyPath) sslConfig.clientKeyPath = form.value.ssl.clientKeyPath
      config.ssl = sslConfig
    }
    return JSON.stringify(config)
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
  if (connectionType.value === 'sftp') {
    return JSON.stringify({
      authMethod: form.value.authMethod,
      privateKeyPath: form.value.privateKeyPath || undefined,
      remotePath: form.value.remotePath,
      sshConnectionId: form.value.sshConnectionId || undefined,
    })
  }
  // redis
  const redisConfig: Record<string, unknown> = {
    database: parseInt(form.value.database) || 0,
    useTls: form.value.ssl?.mode !== 'disabled',
    timeoutSecs: 10,
  }
  // Cluster 模式
  if (form.value.isCluster) {
    redisConfig.isCluster = true
    redisConfig.clusterNodes = form.value.clusterNodes.filter(n => n.trim())
  }
  // Sentinel 模式
  if (form.value.isSentinel) {
    redisConfig.isSentinel = true
    redisConfig.sentinelNodes = form.value.sentinelNodes.filter(n => n.trim())
    redisConfig.sentinelMasterName = form.value.sentinelMasterName
  }
  if (form.value.useSshTunnel) {
    redisConfig.sshTunnel = {
      enabled: true,
      sshHost: form.value.sshHost,
      sshPort: form.value.sshPort,
      sshUsername: form.value.sshUsername,
      authMethod: form.value.sshAuthMethod,
      privateKeyPath: form.value.sshPrivateKeyPath || undefined,
    }
  }
  return JSON.stringify(redisConfig)
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
    } else if (connectionType.value === 'redis') {
      let testHost = form.value.host
      let testPort = form.value.port
      let tunnelId: string | null = null
      try {
        // Cluster 模式：直接测试集群连接
        if (form.value.isCluster) {
          // 收集节点列表：clusterNodes + host:port 作为种子
          const nodes = [...form.value.clusterNodes.filter(n => n.trim())]
          const seedNode = `${form.value.host}:${form.value.port}`
          if (!nodes.includes(seedNode) && form.value.host) {
            nodes.unshift(seedNode)
          }
          const msg = await redisTestClusterConnection({
            nodes,
            password: form.value.password || null,
            useTls: form.value.ssl?.mode !== 'disabled',
            timeoutSecs: 10,
          })
          result = { success: true, message: msg }
        } else if (form.value.isSentinel) {
          // Sentinel 模式：测试 Sentinel 连接
          const nodes = form.value.sentinelNodes.filter(n => n.trim())
          const msg = await redisTestSentinelConnection({
            sentinelNodes: nodes,
            masterName: form.value.sentinelMasterName,
            password: form.value.password || null,
            sentinelPassword: form.value.sentinelPassword || null,
            database: parseInt(form.value.database) || 0,
            useTls: form.value.ssl?.mode !== 'disabled',
            timeoutSecs: 10,
          })
          result = { success: true, message: msg }
        } else {
          // 如果启用 SSH 隧道，先建隧道
          if (form.value.useSshTunnel) {
            const tunnel = await tunnelOpen({
              sshHost: form.value.sshHost,
              sshPort: form.value.sshPort,
              sshUsername: form.value.sshUsername,
              sshPassword: form.value.sshPassword || undefined,
              authMethod: form.value.sshAuthMethod,
              privateKeyPath: form.value.sshPrivateKeyPath || undefined,
              passphrase: form.value.sshPassphrase || undefined,
              localPort: 0,
              remoteHost: form.value.host,
              remotePort: form.value.port,
            })
            tunnelId = tunnel.tunnelId
            testHost = '127.0.0.1'
            testPort = tunnel.localPort
          }
          const msg = await redisTestConnection({
            host: testHost,
            port: testPort,
            password: form.value.password || null,
            database: parseInt(form.value.database) || 0,
            useTls: form.value.ssl?.mode !== 'disabled',
            timeoutSecs: 10,
          })
          result = { success: true, message: msg }
        }
      } finally {
        if (tunnelId) await tunnelClose(tunnelId).catch(() => {})
      }
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
  } catch (e: unknown) {
    testResult.value = { success: false, message: parseBackendError(e).message }
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[850px] p-0 overflow-hidden border border-border bg-background shadow-2xl rounded-xl">
      <div class="flex flex-row h-[min(560px,calc(100vh-120px))] bg-background">
        <!-- Sidebar: Control Panel (Industrial Dark) -->
        <aside class="w-[220px] shrink-0 flex flex-col border-r border-border/60 bg-muted/20 industrial-grid text-muted-foreground/10 noise-texture relative overflow-hidden">
          <div class="relative z-20 p-4 pb-3">
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
                <Label class="text-[10px] font-black uppercase tracking-wide text-muted-foreground/40">{{ t('connection.type') || 'Select Protocol' }}</Label>
                <div class="h-1 w-1 rounded-full bg-primary/40 animate-pulse"></div>
              </div>
              
              <div class="relative space-y-1" role="radiogroup" :aria-label="t('connection.type')">
                <!-- Moving Slider Background -->
                <div
                  class="absolute left-0 w-full bg-primary rounded-lg shadow-lg shadow-primary/20 transition-[top] duration-300 ease-out z-0"
                  :style="{
                    height: '44px',
                    top: `${(['database', 'ssh', 'sftp', 'redis', 'git'].indexOf(connectionType)) * 48}px`,
                    opacity: 1
                  }"
                ></div>

                <button
                  v-for="type in (['database', 'ssh', 'sftp', 'redis', 'git'] as const)"
                  :key="type"
                  role="radio"
                  :aria-checked="connectionType === type"
                  @click="connectionType = type"
                  class="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-bold transition-colors group z-10 h-[44px] focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
                  :class="connectionType === type
                    ? 'text-primary-foreground'
                    : 'text-muted-foreground/60 hover:text-muted-foreground'"
                >
                  <component :is="type === 'database' ? Database : type === 'ssh' ? Terminal : type === 'sftp' ? FolderOpen : type === 'git' ? GitBranch : Container"
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
                  <Label class="text-[11px] uppercase font-bold tracking-normal text-muted-foreground/70 truncate flex items-center gap-1">
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
                    aria-required="true"
                    :aria-invalid="!!nameError || undefined"
                    class="pl-10 h-9 bg-muted/20 border-border/40 rounded-md transition-[border-color,box-shadow] focus:ring-2 focus:ring-primary/5 focus:border-primary/40 text-[11px] font-semibold text-foreground placeholder:text-muted-foreground/40"
                    :class="{ 'border-destructive/40 bg-destructive/5': nameError }"
                  />
                </div>
                <p v-if="nameError" class="mt-1 text-[9px] font-bold text-destructive px-1 leading-tight">{{ nameError }}</p>
              </div>
            </div>
          </div>

          <!-- Sidebar Footer Actions -->
          <div class="relative z-20 p-4 border-t border-border/40 bg-muted/10">
            <Button
              variant="outline"
              :disabled="testing || connectionType === 'git' || !form.host || (connectionType !== 'redis' && !form.username)"
              @click="handleTestConnection"
              class="w-full h-9 rounded-md font-bold text-[11px] border-border/60 bg-background hover:bg-primary hover:text-primary-foreground hover:border-primary transition-[background-color,color,border-color] shadow-sm group relative overflow-hidden"
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
        <main class="flex-1 flex flex-col min-w-0 bg-background/30 relative">
          <!-- 测试连接结果：浮动横条通知 -->
          <Transition
            enter-active-class="transition-all duration-300 ease-out"
            enter-from-class="opacity-0 -translate-y-full"
            enter-to-class="opacity-100 translate-y-0"
            leave-active-class="transition-all duration-200 ease-in"
            leave-from-class="opacity-100 translate-y-0"
            leave-to-class="opacity-0 -translate-y-full"
          >
            <div
              v-if="testResult"
              role="alert"
              aria-live="assertive"
              class="absolute top-0 left-0 right-0 z-30 flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold border-b backdrop-blur-sm"
              :class="testResult.success
                ? 'bg-df-success/10 border-df-success/20 text-df-success'
                : 'bg-destructive/10 border-destructive/20 text-destructive'"
            >
              <CheckCircle2 v-if="testResult.success" class="h-4 w-4 shrink-0" />
              <XCircle v-else class="h-4 w-4 shrink-0" />
              <span class="flex-1 min-w-0 truncate" :title="testResult.message">
                {{ testResult.success ? t('connection.testSuccessTitle') : t('connection.testFailedTitle') }}
                <span class="opacity-70 font-normal ml-1">{{ testResult.message }}</span>
              </span>
              <button
                :aria-label="t('common.close')"
                @click="testResult = null"
                class="p-0.5 rounded opacity-50 hover:opacity-100 transition-opacity focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none shrink-0"
              >
                <XCircle class="h-3.5 w-3.5" />
              </button>
            </div>
          </Transition>

          <!-- Scrollable detail area -->
          <div class="flex-1 overflow-y-auto custom-scrollbar px-8 py-5">
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

                <RedisForm
                  v-if="connectionType === 'redis'"
                  v-model="redisFormData"
                  v-model:show-password="showPassword"
                  :is-editing="isEditing"
                />

                <GitForm
                  v-if="connectionType === 'git'"
                  v-model="gitFormData"
                />
              </div>
            </div>
          </div>

          <!-- Bottom Action Bar (Fixed at bottom of right pane) -->
          <footer class="h-16 px-6 flex items-center justify-between border-t border-border/40 bg-muted/5 shrink-0 industrial-grid text-muted-foreground/5 overflow-hidden relative">
            <!-- 左侧状态区：调整宽度平衡 -->
            <div class="flex items-center gap-2 relative z-10 w-[140px] shrink-0">
              <div 
                class="flex items-center gap-2 transition-colors duration-300"
                :class="canSave ? 'text-primary/90' : 'text-muted-foreground/60'"
              >
                <div 
                  class="h-1.5 w-1.5 rounded-full transition-[background-color,box-shadow] duration-500"
                  :class="canSave ? 'bg-primary animate-pulse shadow-[0_0_8px_rgba(var(--primary),0.5)]' : 'bg-muted-foreground/30'"
                ></div>
                <span class="text-[10px] font-black uppercase tracking-widest font-mono truncate">
                  {{ canSave ? t('connection.readyToSave') : t('connection.awaitingCoreParams') }}
                </span>
              </div>
            </div>

            <!-- 右侧按钮组：紧凑且对齐 -->
            <div class="flex items-center gap-2 shrink-0 ml-auto relative z-10">
              <Button
                variant="ghost"
                @click="emit('update:open', false)"
                class="h-9 min-w-fit px-4 rounded-md font-bold text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors shrink-0"
              >
                {{ t('common.cancel') }}
              </Button>
              
              <div class="h-4 w-[1px] bg-border/20 shrink-0 mx-0.5"></div>
              
              <Button
                :disabled="saving || !canSave"
                @click="handleSave(false)"
                variant="ghost"
                class="h-9 min-w-fit px-4 rounded-md font-bold text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/80 active:scale-95 disabled:opacity-30 shrink-0 transition-[background-color,color,opacity] flex items-center justify-center gap-1"
              >
                <Loader2 v-if="saving" class="h-3 w-3 animate-spin" />
                <span>{{ t('common.save') }}</span>
              </Button>

              <Button
                v-if="connectionType === 'database' || connectionType === 'redis' || connectionType === 'git'"
                :disabled="saving || !canSave"
                @click="handleSave(true)"
                class="h-9 min-w-fit px-4 rounded-md font-bold bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-[background-color,box-shadow] hover:bg-primary/90 hover:shadow-primary/30 active:scale-95 disabled:opacity-50 text-[11px] flex items-center justify-center gap-1 shrink-0"
              >
                <Loader2 v-if="saving" class="h-3 w-3 animate-spin" />
                <template v-else>
                  <CheckCircle2 v-if="canSave" class="h-3 w-3 animate-in zoom-in-50 duration-300" />
                  <span class="truncate">{{ t('connection.saveAndConnect') }}</span>
                </template>
              </Button>
            </div>
          </footer>
        </main>
      </div>
    </DialogContent>
  </Dialog>
</template>
