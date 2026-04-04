<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { open } from '@tauri-apps/plugin-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Eye, EyeOff, Globe, Lock, Hash, Database, Shield, Key, User, FolderOpen, X, Plus, Network } from 'lucide-vue-next'

export interface RedisFormData {
  host: string
  port: number
  password: string
  database: number
  useTls: boolean
  // Cluster 模式
  isCluster: boolean
  clusterNodes: string[]
  // Sentinel 模式
  isSentinel: boolean
  sentinelNodes: string[]
  sentinelMasterName: string
  sentinelPassword: string
  // SSH 隧道
  useSshTunnel: boolean
  sshHost: string
  sshPort: number
  sshUsername: string
  sshPassword: string
  sshAuthMethod: 'password' | 'key'
  sshPrivateKeyPath: string
  sshPassphrase: string
}

const props = defineProps<{
  modelValue: RedisFormData
  isEditing: boolean
  showPassword: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: RedisFormData]
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

/** 浏览私钥文件 */
async function browseSshKey() {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Key Files', extensions: ['pem', 'key', 'pub', 'ppk', '*'] }],
  })
  if (selected) {
    localValue.value = { ...localValue.value, sshPrivateKeyPath: selected as string }
  }
}

/** 新增空节点 */
function addClusterNode() {
  const nodes = [...localValue.value.clusterNodes, '']
  localValue.value = { ...localValue.value, clusterNodes: nodes }
}

/** 删除节点 */
function removeClusterNode(index: number) {
  const nodes = localValue.value.clusterNodes.filter((_, i) => i !== index)
  localValue.value = { ...localValue.value, clusterNodes: nodes }
}

/** 更新节点地址 */
function updateClusterNode(index: number, value: string) {
  const nodes = [...localValue.value.clusterNodes]
  nodes[index] = value
  localValue.value = { ...localValue.value, clusterNodes: nodes }
}

/** 新增 Sentinel 节点 */
function addSentinelNode() {
  const nodes = [...localValue.value.sentinelNodes, '']
  localValue.value = { ...localValue.value, sentinelNodes: nodes }
}

/** 删除 Sentinel 节点 */
function removeSentinelNode(index: number) {
  const nodes = localValue.value.sentinelNodes.filter((_, i) => i !== index)
  localValue.value = { ...localValue.value, sentinelNodes: nodes }
}

/** 更新 Sentinel 节点地址 */
function updateSentinelNode(index: number, value: string) {
  const nodes = [...localValue.value.sentinelNodes]
  nodes[index] = value
  localValue.value = { ...localValue.value, sentinelNodes: nodes }
}
</script>

<template>
  <div class="space-y-6">
    <!-- 服务器区块 -->
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <div class="h-1 w-1 rounded-full bg-primary/50"></div>
        <span class="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">
          {{ t('redis.serverConfig') }}
        </span>
      </div>

      <!-- Host + Port（Sentinel 模式下隐藏，由哨兵自动发现 Master 地址） -->
      <div v-if="!localValue.isSentinel" class="grid grid-cols-3 gap-3">
        <div class="col-span-2 space-y-1.5">
          <Label class="text-[11px] font-bold text-muted-foreground/70 flex items-center gap-1.5">
            <Globe class="h-3 w-3" />
            {{ t('connection.host') }}
          </Label>
          <Input
            :model-value="localValue.host"
            @update:model-value="localValue = { ...localValue, host: $event as string }"
            placeholder="127.0.0.1"
            class="h-9 text-[12px] font-medium"
          />
        </div>
        <div class="space-y-1.5">
          <Label class="text-[11px] font-bold text-muted-foreground/70 flex items-center gap-1.5">
            <Hash class="h-3 w-3" />
            {{ t('connection.port') }}
          </Label>
          <Input
            type="number"
            :model-value="localValue.port"
            @update:model-value="localValue = { ...localValue, port: Number($event) }"
            placeholder="6379"
            class="h-9 text-[12px] font-medium"
            :class="{ 'border-destructive/40': portError }"
          />
          <p v-if="portError" class="text-[9px] text-destructive">{{ portError }}</p>
        </div>
      </div>

      <!-- Password -->
      <div class="space-y-1.5">
        <Label class="text-[11px] font-bold text-muted-foreground/70 flex items-center gap-1.5">
          <Lock class="h-3 w-3" />
          {{ t('connection.password') }}
          <span class="text-muted-foreground/30 font-normal">({{ t('redis.optional') }})</span>
        </Label>
        <div class="relative">
          <Input
            :type="showPassword ? 'text' : 'password'"
            :model-value="localValue.password"
            @update:model-value="localValue = { ...localValue, password: $event as string }"
            :placeholder="t('redis.passwordPlaceholder')"
            autocomplete="off"
            class="h-9 text-[12px] font-medium pr-9"
          />
          <button
            type="button"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            @click="emit('update:showPassword', !showPassword)"
          >
            <Eye v-if="!showPassword" class="h-3.5 w-3.5" />
            <EyeOff v-else class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <!-- Database Index（Cluster 模式隐藏） -->
      <div v-if="!localValue.isCluster" class="space-y-1.5">
        <Label class="text-[11px] font-bold text-muted-foreground/70 flex items-center gap-1.5">
          <Database class="h-3 w-3" />
          {{ t('redis.database') }}
        </Label>
        <Input
          type="number"
          :model-value="localValue.database"
          @update:model-value="localValue = { ...localValue, database: Math.max(0, Math.min(15, Number($event))) }"
          placeholder="0"
          min="0"
          max="15"
          class="h-9 text-[12px] font-medium w-24"
        />
        <p class="text-[9px] text-muted-foreground/40">{{ t('redis.databaseHint') }}</p>
      </div>
    </div>

    <!-- Cluster 区块 -->
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <div class="h-1 w-1 rounded-full bg-primary/50"></div>
        <span class="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">
          {{ t('redis.cluster.mode') }}
        </span>
      </div>

      <!-- Cluster 开关 -->
      <div class="flex items-center justify-between rounded-lg border border-border/40 bg-muted/10 p-3">
        <div class="space-y-0.5">
          <Label class="text-[11px] font-bold text-foreground/80">{{ t('redis.cluster.mode') }}</Label>
          <p class="text-[9px] text-muted-foreground/50">{{ t('redis.cluster.hint') }}</p>
        </div>
        <Switch
          :checked="localValue.isCluster"
          @update:checked="localValue = { ...localValue, isCluster: $event, isSentinel: $event ? false : localValue.isSentinel }"
        />
      </div>

      <!-- 节点列表（Cluster 开启时显示） -->
      <template v-if="localValue.isCluster">
        <div class="space-y-2">
          <Label class="text-[11px] font-bold text-muted-foreground/70 flex items-center gap-1.5">
            <Network class="h-3 w-3" />
            {{ t('redis.cluster.nodes') }}
          </Label>
          <div
            v-for="(node, index) in localValue.clusterNodes"
            :key="index"
            class="flex items-center gap-2"
          >
            <Input
              :model-value="node"
              @update:model-value="updateClusterNode(index, $event as string)"
              :placeholder="t('redis.cluster.nodePlaceholder')"
              class="h-8 text-[12px] font-medium flex-1"
            />
            <button
              type="button"
              class="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/5 transition-colors"
              @click="removeClusterNode(index)"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="h-8 text-[11px] font-medium gap-1.5"
            @click="addClusterNode"
          >
            <Plus class="h-3 w-3" />
            {{ t('redis.cluster.addNode') }}
          </Button>
          <p class="text-[9px] text-muted-foreground/40">{{ t('redis.cluster.nodesHint') }}</p>
        </div>
      </template>
    </div>

    <!-- Sentinel 区块 -->
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <div class="h-1 w-1 rounded-full bg-primary/50"></div>
        <span class="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">
          {{ t('redis.sentinel.mode') }}
        </span>
      </div>

      <!-- Sentinel 开关 -->
      <div class="flex items-center justify-between rounded-lg border border-border/40 bg-muted/10 p-3">
        <div class="space-y-0.5">
          <Label class="text-[11px] font-bold text-foreground/80">{{ t('redis.sentinel.mode') }}</Label>
          <p class="text-[9px] text-muted-foreground/50">{{ t('redis.sentinel.hint') }}</p>
        </div>
        <Switch
          :checked="localValue.isSentinel"
          @update:checked="localValue = { ...localValue, isSentinel: $event, isCluster: $event ? false : localValue.isCluster }"
        />
      </div>

      <!-- Sentinel 配置（开启时显示） -->
      <template v-if="localValue.isSentinel">
        <!-- Master 名称 -->
        <div class="space-y-1.5">
          <Label class="text-[11px] font-bold text-muted-foreground/70 flex items-center gap-1.5">
            <Shield class="h-3 w-3" />
            {{ t('redis.sentinel.masterName') }}
          </Label>
          <Input
            :model-value="localValue.sentinelMasterName"
            @update:model-value="localValue = { ...localValue, sentinelMasterName: $event as string }"
            placeholder="mymaster"
            class="h-9 text-[12px] font-medium"
          />
        </div>

        <!-- Sentinel 节点列表 -->
        <div class="space-y-2">
          <Label class="text-[11px] font-bold text-muted-foreground/70 flex items-center gap-1.5">
            <Network class="h-3 w-3" />
            {{ t('redis.sentinel.nodes') }}
          </Label>
          <div
            v-for="(node, index) in localValue.sentinelNodes"
            :key="index"
            class="flex items-center gap-2"
          >
            <Input
              :model-value="node"
              @update:model-value="updateSentinelNode(index, $event as string)"
              :placeholder="t('redis.sentinel.nodePlaceholder')"
              class="h-8 text-[12px] font-medium flex-1"
            />
            <button
              type="button"
              class="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/5 transition-colors"
              @click="removeSentinelNode(index)"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="h-8 text-[11px] font-medium gap-1.5"
            @click="addSentinelNode"
          >
            <Plus class="h-3 w-3" />
            {{ t('redis.sentinel.addNode') }}
          </Button>
        </div>

        <!-- Sentinel 密码 -->
        <div class="space-y-1.5">
          <Label class="text-[11px] font-bold text-muted-foreground/70 flex items-center gap-1.5">
            <Lock class="h-3 w-3" />
            {{ t('redis.sentinel.password') }}
            <span class="text-muted-foreground/30 font-normal">({{ t('redis.optional') }})</span>
          </Label>
          <div class="relative">
            <Input
              :type="showPassword ? 'text' : 'password'"
              :model-value="localValue.sentinelPassword"
              @update:model-value="localValue = { ...localValue, sentinelPassword: $event as string }"
              :placeholder="t('redis.sentinel.passwordHint')"
              autocomplete="off"
              class="h-9 text-[12px] font-medium pr-9"
            />
            <button
              type="button"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              @click="emit('update:showPassword', !showPassword)"
            >
              <Eye v-if="!showPassword" class="h-3.5 w-3.5" />
              <EyeOff v-else class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- 安全区块 -->
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <div class="h-1 w-1 rounded-full bg-primary/50"></div>
        <span class="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">
          {{ t('redis.security') }}
        </span>
      </div>

      <!-- TLS -->
      <div class="flex items-center justify-between rounded-lg border border-border/40 bg-muted/10 p-3">
        <div class="space-y-0.5">
          <Label class="text-[11px] font-bold text-foreground/80">{{ t('redis.useTls') }}</Label>
          <p class="text-[9px] text-muted-foreground/50">{{ t('redis.tlsHint') }}</p>
        </div>
        <Switch
          :checked="localValue.useTls"
          @update:checked="localValue = { ...localValue, useTls: $event }"
        />
      </div>
    </div>

    <!-- SSH 隧道区块（Cluster 模式下隐藏） -->
    <div v-if="!localValue.isCluster" class="space-y-4">
      <div class="flex items-center gap-2">
        <div class="h-1 w-1 rounded-full bg-primary/50"></div>
        <span class="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">
          {{ t('redis.sshTunnel') }}
        </span>
      </div>

      <!-- SSH 隧道开关 -->
      <div class="flex items-center justify-between rounded-lg border border-border/40 bg-muted/10 p-3">
        <div class="space-y-0.5">
          <Label class="text-[11px] font-bold text-foreground/80">{{ t('redis.sshTunnel') }}</Label>
          <p class="text-[9px] text-muted-foreground/50">{{ t('redis.sshTunnelHint') }}</p>
        </div>
        <Switch
          :checked="localValue.useSshTunnel"
          @update:checked="localValue = { ...localValue, useSshTunnel: $event }"
        />
      </div>

      <!-- SSH 配置（展开时显示） -->
      <template v-if="localValue.useSshTunnel">
        <!-- SSH Host + Port -->
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2 space-y-1.5">
            <Label class="text-[11px] font-bold text-muted-foreground/70 flex items-center gap-1.5">
              <Globe class="h-3 w-3" />
              {{ t('redis.sshHost') }}
            </Label>
            <Input
              :model-value="localValue.sshHost"
              @update:model-value="localValue = { ...localValue, sshHost: $event as string }"
              placeholder="jump.example.com"
              class="h-9 text-[12px] font-medium"
            />
          </div>
          <div class="space-y-1.5">
            <Label class="text-[11px] font-bold text-muted-foreground/70 flex items-center gap-1.5">
              <Hash class="h-3 w-3" />
              {{ t('redis.sshPort') }}
            </Label>
            <Input
              type="number"
              :model-value="localValue.sshPort"
              @update:model-value="localValue = { ...localValue, sshPort: Number($event) }"
              placeholder="22"
              class="h-9 text-[12px] font-medium"
            />
          </div>
        </div>

        <!-- SSH Username -->
        <div class="space-y-1.5">
          <Label class="text-[11px] font-bold text-muted-foreground/70 flex items-center gap-1.5">
            <User class="h-3 w-3" />
            {{ t('redis.sshUsername') }}
          </Label>
          <Input
            :model-value="localValue.sshUsername"
            @update:model-value="localValue = { ...localValue, sshUsername: $event as string }"
            placeholder="root"
            class="h-9 text-[12px] font-medium"
          />
        </div>

        <!-- SSH Auth Method -->
        <div class="space-y-1.5">
          <Label class="text-[11px] font-bold text-muted-foreground/70 flex items-center gap-1.5">
            <Shield class="h-3 w-3" />
            {{ t('redis.sshAuthMethod') }}
          </Label>
          <Select
            :model-value="localValue.sshAuthMethod"
            @update:model-value="localValue = { ...localValue, sshAuthMethod: $event as 'password' | 'key' }"
          >
            <SelectTrigger class="h-9 text-[12px] font-medium">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="password">{{ t('redis.sshAuthPassword') }}</SelectItem>
              <SelectItem value="key">{{ t('redis.sshAuthKey') }}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- SSH Password（密码认证时显示） -->
        <div v-if="localValue.sshAuthMethod === 'password'" class="space-y-1.5">
          <Label class="text-[11px] font-bold text-muted-foreground/70 flex items-center gap-1.5">
            <Lock class="h-3 w-3" />
            {{ t('connection.password') }}
          </Label>
          <div class="relative">
            <Input
              :type="showPassword ? 'text' : 'password'"
              :model-value="localValue.sshPassword"
              @update:model-value="localValue = { ...localValue, sshPassword: $event as string }"
              placeholder="SSH Password"
              autocomplete="off"
              class="h-9 text-[12px] font-medium pr-9"
            />
            <button
              type="button"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              @click="emit('update:showPassword', !showPassword)"
            >
              <Eye v-if="!showPassword" class="h-3.5 w-3.5" />
              <EyeOff v-else class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <!-- SSH Key（密钥认证时显示） -->
        <template v-if="localValue.sshAuthMethod === 'key'">
          <div class="space-y-1.5">
            <Label class="text-[11px] font-bold text-muted-foreground/70 flex items-center gap-1.5">
              <Key class="h-3 w-3" />
              {{ t('redis.sshPrivateKey') }}
            </Label>
            <div class="flex gap-2">
              <Input
                :model-value="localValue.sshPrivateKeyPath"
                @update:model-value="localValue = { ...localValue, sshPrivateKeyPath: $event as string }"
                :placeholder="t('connection.privateKeyPlaceholder')"
                class="h-9 text-[12px] font-medium flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                class="h-9 w-9 p-0 shrink-0"
                @click="browseSshKey"
              >
                <FolderOpen class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div class="space-y-1.5">
            <Label class="text-[11px] font-bold text-muted-foreground/70 flex items-center gap-1.5">
              <Lock class="h-3 w-3" />
              {{ t('redis.sshPassphrase') }}
              <span class="text-muted-foreground/30 font-normal">({{ t('redis.optional') }})</span>
            </Label>
            <div class="relative">
              <Input
                :type="showPassword ? 'text' : 'password'"
                :model-value="localValue.sshPassphrase"
                @update:model-value="localValue = { ...localValue, sshPassphrase: $event as string }"
                placeholder=""
                autocomplete="off"
                class="h-9 text-[12px] font-medium pr-9"
              />
              <button
                type="button"
                class="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                @click="emit('update:showPassword', !showPassword)"
              >
                <Eye v-if="!showPassword" class="h-3.5 w-3.5" />
                <EyeOff v-else class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
