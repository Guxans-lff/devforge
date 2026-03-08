<script setup lang="ts">
/**
 * UserManagementPanel - 用户权限管理面板
 * 展示 MySQL 用户列表，支持新建/编辑/删除用户及权限管理
 * 检测当前用户是否有 GRANT OPTION 权限，无权限时禁用编辑
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Users,
  Plus,
  Trash2,
  Shield,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Search,
  X,
  ChevronRight,
  Check,
  Lock,
  Unlock,
  KeyRound,
  Database as DatabaseIcon,
  Globe,
  Settings2,
  ChevronDown,
  Info,
  Download,
  MoreVertical,
} from 'lucide-vue-next'
import {
  dbGetUsers,
  dbCreateUser,
  dbDropUser,
  dbGetUserGrants,
  dbApplyGrants,
  dbExecuteQuery,
  dbGetDatabases,
} from '@/api/database'
import type { MysqlUser, CreateUserRequest } from '@/types/database'

const props = defineProps<{
  connectionId: string
  isConnected: boolean
}>()

// ===== 状态 =====

/** 用户列表 */
const users = ref<MysqlUser[]>([])
/** 加载状态 */
const isLoading = ref(false)
/** 错误信息 */
const errorMessage = ref<string | null>(null)
/** 搜索关键字 */
const searchQuery = ref('')
/** 当前选中的用户 */
const selectedUser = ref<MysqlUser | null>(null)
/** 当前用户是否有 GRANT OPTION 权限 */
const hasGrantOption = ref(true)
/** 正在检测权限 */
const checkingGrant = ref(false)

// ===== 新建用户对话框 =====
const showCreateDialog = ref(false)
const createForm = ref<CreateUserRequest>({
  username: '',
  host: '%',
  password: '',
  plugin: 'mysql_native_password',
  passwordExpireDays: null,
})
const isCreating = ref(false)
const createError = ref<string | null>(null)

// ===== 删除用户确认 =====
const showDeleteConfirm = ref(false)
const userToDelete = ref<MysqlUser | null>(null)
const isDeleting = ref(false)

// ===== 权限编辑核心状态 =====
const showGrantPanel = ref(false)
const grantUser = ref<MysqlUser | null>(null)
const activeTab = ref<'global' | 'database' | 'overview'>('overview')

/** 权限数据结构 */
const currentGrants = ref<string[]>([])
const isLoadingGrants = ref(false)
const grantError = ref<string | null>(null)
const isApplySuccess = ref(false)
/** 正在应用权限变更 */
const isApplyingGrants = ref(false)

/** 全局权限 */
const checkedGlobalPrivileges = ref<Set<string>>(new Set())
const originalGlobalPrivileges = ref<Set<string>>(new Set())

/** 数据库级权限管理 */
const allDatabases = ref<string[]>([])
const dbSearchQuery = ref('')
const dbPrivileges = ref<Map<string, Set<string>>>(new Map())
const originalDbPrivileges = ref<Map<string, Set<string>>>(new Map())
const activeDb = ref<string | null>(null)

/** 权限备注 */
const privLabels: Record<string, string> = {
  'SELECT': '查询数据',
  'INSERT': '插入数据',
  'UPDATE': '更新数据',
  'DELETE': '删除数据',
  'CREATE': '创建对象',
  'DROP': '删除对象',
  'GRANT OPTION': '授权权限',
  'SUPER': '超级管理',
  'PROCESS': '查看进程',
  'EVENT': '事件管理',
  'TRIGGER': '触发器管理',
}

/** 过滤后的用户列表 */
const filteredUsers = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return users.value
  return users.value.filter(u =>
    u.user.toLowerCase().includes(q) ||
    u.host.toLowerCase().includes(q)
  )
})

/** 权限是否有变更 */
const hasGrantChanges = computed(() => {
  // 对比全局权限
  if (checkedGlobalPrivileges.value.size !== originalGlobalPrivileges.value.size) return true
  for (const p of Array.from(checkedGlobalPrivileges.value)) {
    if (!originalGlobalPrivileges.value.has(p)) return true
  }
  for (const p of originalGlobalPrivileges.value) {
    if (!checkedGlobalPrivileges.value.has(p)) return true
  }
  
  // 对比数据库权限
  if (dbPrivileges.value.size !== originalDbPrivileges.value.size) return true
  for (const [db, privs] of Array.from(dbPrivileges.value.entries())) {
    const orig = originalDbPrivileges.value.get(db)
    if (!orig) return true
    if (privs.size !== orig.size) return true
    for (const p of Array.from(privs)) if (!orig.has(p)) return true
  }
  
  return false
})

/** 过滤后的数据库列表（不包含已授权的，除非是当前选中的） */
const filteredDatabases = computed(() => {
  const q = dbSearchQuery.value.toLowerCase().trim()
  return allDatabases.value.filter(db => {
    const matches = db.toLowerCase().includes(q)
    return matches
  })
})

/** 筛选后的数据库权限列表（用于显示已授权列表） */
const authorizedDatabases = computed(() => {
  return Array.from(dbPrivileges.value.keys()).sort()
})

// ===== 方法 =====

/** 加载用户列表 */
async function loadUsers() {
  if (!props.isConnected) return
  isLoading.value = true
  errorMessage.value = null
  try {
    const list = await dbGetUsers(props.connectionId)
    users.value = list
    
    // 强同步逻辑：如果当前有选中用户，从新列表中找出对应的最新引用，确保状态（如锁定）实时更新
    if (selectedUser.value) {
      const latest = list.find(u => u.user === selectedUser.value?.user && u.host === selectedUser.value?.host)
      if (latest) {
        selectedUser.value = latest
        // 如果详情面板开着，同步详情面板的引用
        if (grantUser.value?.user === latest.user && grantUser.value?.host === latest.host) {
          grantUser.value = latest
        }
      }
    }
  } catch (e) {
    errorMessage.value = String(e)
  } finally {
    isLoading.value = false
  }
}

/** 检测当前用户是否有 GRANT OPTION 权限 */
async function checkGrantOption() {
  if (!props.isConnected) return
  checkingGrant.value = true
  try {
    const result = await dbExecuteQuery(props.connectionId, 'SHOW GRANTS FOR CURRENT_USER()')
    const grants = result.rows.map(r => String(r[0] ?? '').toUpperCase())
    // 检查是否包含 ALL PRIVILEGES 或 GRANT OPTION
    hasGrantOption.value = grants.some(g =>
      g.includes('ALL PRIVILEGES') || g.includes('GRANT OPTION')
    )
  } catch {
    // 查询失败时默认无权限
    hasGrantOption.value = false
  } finally {
    checkingGrant.value = false
  }
}

/** 打开新建用户对话框 */
function openCreateDialog() {
  createForm.value = {
    username: '',
    host: '%',
    password: '',
    plugin: 'mysql_native_password',
    passwordExpireDays: null,
  }
  createError.value = null
  showCreateDialog.value = true
}

/** 创建用户 */
async function handleCreateUser() {
  if (!createForm.value.username.trim()) {
    createError.value = '用户名不能为空'
    return
  }
  if (!createForm.value.password.trim()) {
    createError.value = '密码不能为空'
    return
  }
  isCreating.value = true
  createError.value = null
  try {
    await dbCreateUser(props.connectionId, createForm.value)
    showCreateDialog.value = false
    await loadUsers()
  } catch (e) {
    createError.value = String(e)
  } finally {
    isCreating.value = false
  }
}

/** 确认删除用户 */
function confirmDeleteUser(user: MysqlUser) {
  userToDelete.value = user
  showDeleteConfirm.value = true
}

/** 执行删除用户 */
async function handleDeleteUser() {
  if (!userToDelete.value) return
  isDeleting.value = true
  try {
    await dbDropUser(props.connectionId, userToDelete.value.user, userToDelete.value.host)
    showDeleteConfirm.value = false
    // 如果删除的是当前选中用户，清除选中状态
    if (selectedUser.value?.user === userToDelete.value.user &&
        selectedUser.value?.host === userToDelete.value.host) {
      selectedUser.value = null
      showGrantPanel.value = false
    }
    userToDelete.value = null
    await loadUsers()
  } catch (e) {
    errorMessage.value = `删除用户失败: ${String(e)}`
  } finally {
    isDeleting.value = false
  }
}

/** 打开权限编辑面板 */
async function openGrantEditor(user: MysqlUser) {
  if (!user) return
  selectedUser.value = user
  grantUser.value = user
  showGrantPanel.value = true
  await loadUserGrants(user)
}

/** 加载用户权限 */
async function loadUserGrants(user: MysqlUser) {
  if (!user || user.user === undefined) return
  isLoadingGrants.value = true
  grantError.value = null
  checkedGlobalPrivileges.value = new Set()
  dbPrivileges.value = new Map()
  try {
    currentGrants.value = await dbGetUserGrants(props.connectionId, user.user, user.host)
    parseGrants(currentGrants.value)
    // 保存原始快照
    originalGlobalPrivileges.value = new Set(checkedGlobalPrivileges.value)
    originalDbPrivileges.value = new Map(
      Array.from(dbPrivileges.value.entries()).map(([k, v]) => [k, new Set(v)])
    )
  } catch (e) {
    grantError.value = String(e)
  } finally {
    isLoadingGrants.value = false
  }
}

/** 解析 SHOW GRANTS 输出，提取全局权限和数据库级权限 */
function parseGrants(grants: string[]) {
  const globalPrivs = new Set<string>()
  const dbPrivs = new Map<string, Set<string>>()

  for (const grant of grants) {
    const upper = grant.toUpperCase()

    // 匹配全局权限: GRANT ... ON *.* TO ...
    const globalMatch = upper.match(/^GRANT\s+(.+?)\s+ON\s+\*\.\*\s+TO\s+/)
    if (globalMatch) {
      const privStr = globalMatch[1]
      if (privStr.includes('ALL PRIVILEGES')) {
        // ALL PRIVILEGES 表示拥有所有权限
        ALL_PRIVS_LIST.forEach(p => {
          if (p !== 'GRANT OPTION') globalPrivs.add(p)
        })
      } else {
        // 解析逗号分隔的权限列表
        const privs = privStr.split(',').map(p => p.trim())
        privs.forEach(p => {
          const normalized = p.trim()
          if (ALL_PRIVS_LIST.includes(normalized)) {
            globalPrivs.add(normalized)
          }
        })
      }
      // 检查 WITH GRANT OPTION
      if (upper.includes('WITH GRANT OPTION')) {
        globalPrivs.add('GRANT OPTION')
      }
      continue
    }

    // 匹配数据库级权限: GRANT ... ON `db`.* TO ...
    // 使用更宽松的正则匹配库名
    const dbMatch = upper.match(/^GRANT\s+(.+?)\s+ON\s+[`']?(.+?)[`']?\.\*\s+TO\s+/)
    if (dbMatch) {
      const privStr = dbMatch[1]
      const dbName = dbMatch[2]
      const privSet = dbPrivs.get(dbName) ?? new Set<string>()

      if (privStr.includes('ALL PRIVILEGES')) {
        DB_LEVEL_PRIVS.forEach(p => {
          if (p !== 'GRANT OPTION') privSet.add(p)
        })
      } else {
        const privs = privStr.split(',').map(p => p.trim())
        privs.forEach(p => {
          const normalized = p.trim()
          if (DB_LEVEL_PRIVS.includes(normalized)) {
            privSet.add(normalized)
          }
        })
      }
      dbPrivs.set(dbName, privSet)
    }
  }

  checkedGlobalPrivileges.value = globalPrivs
  dbPrivileges.value = dbPrivs
}

/** 切换全局权限 */
function toggleGlobalPrivilege(priv: string) {
  if (!hasGrantOption.value) return
  const newSet = new Set(checkedGlobalPrivileges.value)
  if (newSet.has(priv)) {
    newSet.delete(priv)
  } else {
    newSet.add(priv)
  }
  checkedGlobalPrivileges.value = newSet
}

/** 切换数据库级权限 */
function toggleDbPrivilege(db: string, priv: string) {
  if (!hasGrantOption.value) return
  const newMap = new Map(dbPrivileges.value)
  const privSet = new Set(newMap.get(db) || [])
  
  if (privSet.has(priv)) {
    privSet.delete(priv)
  } else {
    privSet.add(priv)
  }
  
  if (privSet.size === 0) {
    newMap.delete(db)
  } else {
    newMap.set(db, privSet)
  }
  dbPrivileges.value = newMap
}

/** 移除数据库的所有权限 */
function revokeAllFromDb(db: string) {
  const newMap = new Map(dbPrivileges.value)
  newMap.delete(db)
  dbPrivileges.value = newMap
  if (activeDb.value === db) activeDb.value = null
}

/** 应用权限变更（重构后的逻辑：全面支持 REVOKE + GRANT） */
async function applyGrants() {
  if (!grantUser.value || !hasGrantChanges.value) return
  isApplyingGrants.value = true
  grantError.value = null

  const user = grantUser.value
  const userSpec = `'${user.user}'@'${user.host}'`
  const statements: string[] = []

  // 1. 处理全局权限变更
  const toRevokeGlobal = Array.from(originalGlobalPrivileges.value).filter(p => !checkedGlobalPrivileges.value.has(p) && p !== 'GRANT OPTION')
  const toGrantGlobal = Array.from(checkedGlobalPrivileges.value).filter(p => !originalGlobalPrivileges.value.has(p) && p !== 'GRANT OPTION')
  
  if (toRevokeGlobal.length > 0) {
    statements.push(`REVOKE ${toRevokeGlobal.join(', ')} ON *.* FROM ${userSpec}`)
  }
  if (toGrantGlobal.length > 0) {
    let stmt = `GRANT ${toGrantGlobal.join(', ')} ON *.* TO ${userSpec}`
    if (checkedGlobalPrivileges.value.has('GRANT OPTION')) stmt += ' WITH GRANT OPTION'
    statements.push(stmt)
  }
  
  // 处理全局 GRANT OPTION 单独变更
  const hadGrantOption = originalGlobalPrivileges.value.has('GRANT OPTION')
  const hasGrantOptionNow = checkedGlobalPrivileges.value.has('GRANT OPTION')
  if (hasGrantOptionNow && !hadGrantOption && toGrantGlobal.length === 0) {
    statements.push(`GRANT USAGE ON *.* TO ${userSpec} WITH GRANT OPTION`)
  } else if (!hasGrantOptionNow && hadGrantOption) {
    statements.push(`REVOKE GRANT OPTION ON *.* FROM ${userSpec}`)
  }

  // 2. 处理数据库级权限变更
  // 找出需要 REVOKE 的（旧有但新无，或旧有但权限变了）
  for (const [db, oldPrivs] of Array.from(originalDbPrivileges.value.entries())) {
    const newPrivs = dbPrivileges.value.get(db)
    if (!newPrivs) {
      // 彻底移除该库权限
      statements.push(`REVOKE ALL PRIVILEGES ON \`${db}\`.* FROM ${userSpec}`)
    } else {
      // 找出被移除的权限
      const revoked = Array.from(oldPrivs).filter((p: string) => !newPrivs.has(p))
      if (revoked.length > 0) {
        statements.push(`REVOKE ${revoked.join(', ')} ON \`${db}\`.* FROM ${userSpec}`)
      }
    }
  }

  // 找出需要 GRANT 的（新有但旧无，或新有且权限变了）
  for (const [db, newPrivs] of Array.from(dbPrivileges.value.entries())) {
    const oldPrivs = originalDbPrivileges.value.get(db) || new Set<string>()
    const granted = Array.from(newPrivs).filter((p: string) => !oldPrivs.has(p))
    if (granted.length > 0) {
      statements.push(`GRANT ${granted.join(', ')} ON \`${db}\`.* TO ${userSpec}`)
    }
  }

  if (statements.length === 0) {
    isApplyingGrants.value = false
    return
  }

  statements.push('FLUSH PRIVILEGES')

  try {
    await dbApplyGrants(props.connectionId, statements)
    await loadUserGrants(grantUser.value)
    isApplySuccess.value = true
    setTimeout(() => { isApplySuccess.value = false }, 3000)
  } catch (e) {
    grantError.value = String(e)
  } finally {
    isApplyingGrants.value = false
  }
}

/** 导出 SQL 文件 */
function exportToSql() {
  if (!currentGrants.value.length) return
  const content = `-- MySQL user grants for ${grantUser.value?.user}@${grantUser.value?.host}\n` + 
                  currentGrants.value.join(';\n') + ';'
  const blob = new Blob([content], { type: 'text/sql' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `grants_${grantUser.value?.user || 'user'}_${grantUser.value?.host || 'host'}.sql`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** 分类后的全局权限 */
const CATEGORIZED_GLOBAL_PRIVILEGES = {
  '管理权限': ['GRANT OPTION', 'SUPER', 'PROCESS', 'RELOAD', 'SHUTDOWN', 'SHOW DATABASES', 'LOCK TABLES', 'REPLICATION SLAVE', 'REPLICATION CLIENT', 'CREATE USER', 'CREATE TABLESPACE'],
}

/** 所有支持显示的全局权限列表 */
const ALL_PRIVS_LIST = Object.values(CATEGORIZED_GLOBAL_PRIVILEGES).flat()

/** 数据库级可用权限列表 */
const DB_LEVEL_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'INDEX', 'CREATE VIEW', 'SHOW VIEW', 'CREATE ROUTINE', 'ALTER ROUTINE', 'EXECUTE', 'TRIGGER', 'EVENT', 'REFERENCES']


/** 加载数据库列表 */
async function loadDatabases() {
  try {
    const res = await dbGetDatabases(props.connectionId)
    allDatabases.value = res.map(d => d.name)
  } catch (e) {
    console.error('加载数据库列表失败', e)
  }
}

/** 修改密码逻辑 */
const showChangePassword = ref(false)
const newPassword = ref('')
const isChangingPassword = ref(false)

async function handleChangePassword() {
  if (!selectedUser.value || !newPassword.value) return
  isChangingPassword.value = true
  try {
    const userSpec = `'${selectedUser.value.user}'@'${selectedUser.value.host}'`
    await dbExecuteQuery(props.connectionId, `ALTER USER ${userSpec} IDENTIFIED BY '${newPassword.value}'`)
    showChangePassword.value = false
    newPassword.value = ''
    await loadUsers()
  } catch (e) {
    errorMessage.value = `修改密码失败: ${e}`
  } finally {
    isChangingPassword.value = false
  }
}

/** 切换锁定状态 */
async function toggleUserLock(user: MysqlUser) {
  const isLocked = user.accountLocked === 'Y'
  const action = isLocked ? 'ACCOUNT UNLOCK' : 'ACCOUNT LOCK'
  try {
    const userSpec = `'${user.user}'@'${user.host}'`
    await dbExecuteQuery(props.connectionId, `ALTER USER ${userSpec} ${action}`)
    await loadUsers()
  } catch (e) {
    errorMessage.value = `操作失败: ${e}`
  }
}

// ===== 生命周期 =====

onMounted(async () => {
  await Promise.all([loadUsers(), checkGrantOption(), loadDatabases()])
})

onBeforeUnmount(() => {
  // 清理工作
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-background">
    <!-- 顶部工具栏：Master Header (精致对齐) -->
    <div class="flex h-16 items-center justify-between border-b border-border/10 bg-card/40 px-6 backdrop-blur-md">
      <div class="flex items-center gap-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-sm">
          <Users class="h-5 w-5" />
        </div>
        <div class="space-y-0.5">
          <h2 class="text-lg font-bold tracking-tight text-foreground/90">用户管理</h2>
          <p class="text-[10px] text-muted-foreground/50 font-medium">配置数据库账户及其权限</p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <!-- 权限警告 -->
        <div v-if="!hasGrantOption && !checkingGrant" class="mr-4 flex items-center gap-2 rounded-xl bg-amber-500/5 px-4 py-2 text-xs font-bold text-amber-600 border border-amber-500/10 shadow-sm">
          <AlertTriangle class="h-4 w-4" />
          <span>管理权限受限</span>
        </div>

        <Button
          variant="default"
          size="sm"
          class="h-9 px-4 gap-2 rounded-lg shadow-lg shadow-primary/10 hover:opacity-90 active:scale-95 transition-all font-bold text-xs"
          :disabled="!hasGrantOption || isLoading"
          @click="openCreateDialog"
        >
          <Plus class="h-4 w-4" />
          新建账户
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-10 w-10 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          :disabled="isLoading"
          @click="loadUsers"
        >
          <RefreshCw class="h-5 w-5" :class="{ 'animate-spin': isLoading }" />
        </Button>
      </div>
    </div>

    <!-- 主体内容：Split Dashboard -->
    <div class="flex flex-1 min-h-0">
      <!-- 左侧：用户导航列表 -->
      <div class="flex w-[310px] flex-col border-r border-border/5 bg-muted/5">
        <div class="px-6 py-4 border-b border-border/5">
          <div class="relative group">
            <Search class="absolute left-6 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
            <Input
              v-model="searchQuery"
              class="h-10 pl-12 text-xs bg-muted/20 border-border/10 rounded-xl focus-visible:ring-primary/20 shadow-none hover:bg-muted/30 transition-colors"
              placeholder="搜索用户或主机..."
            />
          </div>
        </div>

        <ScrollArea class="flex-1">
          <div v-if="isLoading && users.length === 0" class="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 class="h-6 w-6 animate-spin text-primary/40" />
            <span class="text-xs text-muted-foreground font-medium">加载中...</span>
          </div>

          <div v-else-if="filteredUsers.length === 0" class="flex flex-col items-center justify-center py-20 px-6 text-center opacity-60">
            <div class="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <Users class="h-6 w-6 text-muted-foreground/30" />
            </div>
            <p class="text-xs font-medium text-muted-foreground">{{ searchQuery ? '未能找到匹配结果' : '暂无数据库用户' }}</p>
          </div>

          <div v-else class="px-2 space-y-0.5 pb-4">
            <div 
              v-for="user in filteredUsers"
              :key="`${user.user}@${user.host}`"
              class="user-list-item group relative flex items-center gap-3 px-4 h-[72px] cursor-pointer transition-all duration-200 border-b border-border/10 shrink-0 select-none rounded-lg mx-1"
              :class="[
                selectedUser?.user === user.user && selectedUser?.host === user.host
                  ? 'bg-primary/[0.06] text-primary shadow-sm shadow-primary/5'
                  : 'hover:bg-accent/10 text-muted-foreground hover:text-foreground'
              ]"
              @click="openGrantEditor(user)"
            >
              <!-- 用户头像 -->
              <div 
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-background font-bold uppercase transition-all shadow-sm group-hover:bg-accent/10"
                :class="user.accountLocked === 'Y' ? 'text-destructive/60' : 'text-primary/60'"
              >
                <div class="text-[13px]">{{ user.user ? user.user.charAt(0) : '?' }}</div>
              </div>
              
              <div class="flex-1 min-w-0 flex flex-col justify-center">
                <div class="flex items-center gap-2 overflow-hidden">
                  <TooltipProvider :delay-duration="300">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <span class="font-bold truncate text-sm cursor-help max-w-[140px] block" :class="{ 'opacity-50 italic font-normal text-xs': !user.user }">
                          {{ user.user || '(Anonymous)' }}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right" class="text-xs py-1 px-2">
                        {{ user.user || '(Anonymous)' }}@{{ user.host }}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <!-- 二行：主机名 -->
                <div class="flex items-center h-3.5 opacity-60">
                   <span class="truncate text-[10px] font-medium leading-none">{{ user.host }}</span>
                </div>
                <!-- 三行：状态指示器 -->
                <div class="flex items-center gap-1.5 mt-1.5 flex-nowrap overflow-hidden h-5">
                  <span v-if="user.accountLocked === 'Y'" class="shrink-0 flex items-center gap-1 text-[10px] font-bold text-destructive/80 bg-destructive/5 px-1.5 py-0.5 rounded-lg border border-destructive/10 uppercase whitespace-nowrap">
                    <Lock class="h-2.5 w-2.5" /> 锁定
                  </span>
                  <span v-else-if="user.passwordExpired === 'Y'" class="shrink-0 flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-500/5 px-1.5 py-0.5 rounded-lg border border-amber-500/10 uppercase whitespace-nowrap">
                    <AlertTriangle class="h-2.5 w-2.5" /> 过期
                  </span>
                  <span v-else class="shrink-0 flex items-center gap-1 text-[10px] font-bold text-emerald-600/70 bg-emerald-500/5 px-1.5 py-0.5 rounded-lg border border-emerald-500/10 whitespace-nowrap">
                    <div class="h-1.5 w-1.5 rounded-full bg-emerald-500/50 blink" /> 活跃
                  </span>
                  <!-- 系统用户标识 -->
                  <span v-if="user.user.startsWith('mysql.')" class="shrink-0 text-[9px] font-black tracking-widest text-primary/30 bg-primary/5 px-1.5 py-0.5 rounded-lg border border-primary/10 uppercase whitespace-nowrap">
                    System
                  </span>
                </div>
              </div>

              <!-- 操作按钮 -->
              <div class="shrink-0 transition-all duration-300" :class="selectedUser?.user === user.user ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'">
                 <Button
                  v-if="hasGrantOption"
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl"
                  @click.stop="confirmDeleteUser(user)"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      <!-- 右侧：详情与权限管理 -->
      <div class="flex-1 flex flex-col min-h-0 bg-background relative">
        <template v-if="showGrantPanel && grantUser">
          <!-- 面板头部：用户摘要 -->
          <div class="flex items-center justify-between border-b border-border/10 bg-muted/5 px-6 py-4 gap-4">
            <div class="flex items-center gap-3 min-w-0 flex-1">
              <div class="h-10 w-10 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
                <Shield class="h-5 w-5 text-primary" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 min-w-0">
                  <TooltipProvider :delay-duration="300">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <h3 class="text-base font-bold tracking-tight truncate cursor-help max-w-[280px]" :class="{ 'opacity-50 italic font-normal': !grantUser.user }">
                          {{ grantUser.user || '(Anonymous)' }}<span class="mx-0.5 text-primary/20 font-light">@</span>{{ grantUser.host }}
                        </h3>
                      </TooltipTrigger>
                      <TooltipContent class="text-xs py-1 px-2">
                        {{ grantUser.user || '(Anonymous)' }}@{{ grantUser.host }}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <div class="h-2 w-2 shrink-0 rounded-full shadow-sm blink" :class="grantUser.accountLocked === 'Y' ? 'bg-destructive' : 'bg-emerald-500'" />
                  <span v-if="grantUser.user.startsWith('mysql.')" class="shrink-0 text-[8px] font-black tracking-widest text-primary/40 bg-primary/5 px-1.5 py-0.5 rounded-lg border border-primary/20 uppercase">
                    System
                  </span>
                </div>
                <p class="text-[9px] text-muted-foreground font-mono opacity-50 flex items-center gap-1.5 truncate mt-0.5">
                  <Settings2 class="h-2.5 w-2.5 shrink-0" />
                  {{ grantUser.plugin || 'default' }} • 密码变更: {{ grantUser.passwordLastChanged || '-' }}
                </p>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
               <!-- 核心操作区：导出与应用 (高亮显示) -->
               <div class="flex items-center gap-2 pr-2 border-r border-border/50">
                  <Button 
                    v-if="currentGrants.length"
                    variant="outline" 
                    size="sm" 
                    class="h-9 px-3 gap-1.5 text-xs text-primary/80 hover:text-primary hover:bg-primary/5 border-primary/10 rounded-lg shrink-0 shadow-sm"
                    @click="exportToSql"
                  >
                    <Download class="h-4 w-4" /> 导出SQL
                  </Button>

                  <Button
                    v-if="hasGrantOption"
                    :variant="isApplySuccess ? 'outline' : (hasGrantChanges ? 'default' : 'outline')"
                    size="sm"
                    class="h-9 px-4 gap-1.5 text-xs shadow-lg transition-all active:scale-95 shrink-0"
                    :class="[
                      isApplySuccess ? 'text-emerald-600 border-emerald-500/30' : '',
                      hasGrantChanges && !isApplySuccess ? 'shadow-primary/20' : 'shadow-none'
                    ]"
                    :disabled="(!hasGrantChanges && !isApplySuccess) || isApplyingGrants"
                    @click="applyGrants"
                  >
                    <template v-if="isApplySuccess">
                      <Check class="h-4 w-4" />
                      已应用
                    </template>
                    <template v-else>
                      <Loader2 v-if="isApplyingGrants" class="h-4 w-4 animate-spin" />
                      <Check v-else class="h-4 w-4" />
                      应用当前变更
                    </template>
                  </Button>
               </div>

               <!-- 次要操作区：下拉菜单 (释放空间) -->
               <DropdownMenu>
                 <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" class="h-9 w-9 rounded-xl hover:bg-accent">
                      <MoreVertical class="h-4 w-4" />
                    </Button>
                 </DropdownMenuTrigger>
                 <DropdownMenuContent align="end" class="w-48 rounded-xl border-border/20 shadow-xl p-1.5">
                    <DropdownMenuItem class="rounded-lg gap-2 cursor-pointer" @click="showChangePassword = true">
                      <KeyRound class="h-4 w-4 text-amber-500/70" />
                      <span class="text-xs font-medium">重置登录密码</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      class="rounded-lg gap-2 cursor-pointer"
                      :class="grantUser.accountLocked === 'Y' ? 'text-emerald-600' : 'text-destructive/80'"
                      @click="toggleUserLock(grantUser)"
                    >
                      <component :is="grantUser.accountLocked === 'Y' ? Unlock : Lock" class="h-4 w-4" />
                      <span class="text-xs font-medium">{{ grantUser.accountLocked === 'Y' ? '解除账户锁定' : '锁定该账户' }}</span>
                    </DropdownMenuItem>
                 </DropdownMenuContent>
               </DropdownMenu>
            </div>
          </div>

          <!-- 导航 Tabs -->
          <div class="flex border-b border-border/20 bg-muted/5 px-6">
            <button
              v-for="tab in [{id: 'overview', label: '概览', icon: Info}, {id: 'global', label: '全局权限', icon: Globe}, {id: 'database', label: '数据库级', icon: DatabaseIcon}]"
              :key="tab.id"
              class="flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-medium transition-all"
              :class="activeTab === tab.id ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50'"
              @click="activeTab = tab.id as any"
            >
              <component :is="tab.icon" class="h-3.5 w-3.5" />
              {{ tab.label }}
            </button>
          </div>

          <!-- 权限编辑器区域 -->
          <ScrollArea class="flex-1">
            <div v-if="isLoadingGrants" class="flex items-center justify-center py-20">
              <Loader2 class="h-8 w-8 animate-spin text-primary/30" />
            </div>

            <div v-else-if="grantError" class="p-8">
              <div class="rounded-lg border border-destructive/20 bg-destructive/5 p-4 flex gap-3 text-destructive">
                <AlertTriangle class="h-5 w-5 shrink-0" />
                <div class="text-sm">
                  <p class="font-bold">加载权限失败</p>
                  <p class="opacity-80">{{ grantError }}</p>
                </div>
              </div>
            </div>

            <div v-else class="p-6">
              <!-- Tab: 概览 -->
              <div v-if="activeTab === 'overview'" class="space-y-6">
                <!-- 原始语句卡片 -->
                <div class="rounded-xl border border-border/30 bg-muted/10 overflow-hidden shadow-sm">
                  <div class="bg-muted/30 px-4 py-2 border-b border-border/20 flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <Globe class="h-3.5 w-3.5 text-primary/60" />
                      <span class="text-[11px] font-bold text-foreground/80 uppercase tracking-wider">原始授权语句 (Original Statements)</span>
                    </div>
                    <Button 
                      v-if="currentGrants.length"
                      variant="ghost" 
                      size="sm" 
                      class="h-7 gap-1.5 text-[10px] hover:bg-primary/5 transition-all opacity-60 hover:opacity-100"
                      @click="exportToSql"
                    >
                      <Download class="h-3 w-3" /> 导出 SQL
                    </Button>
                  </div>
                  <div class="p-4 space-y-2 font-mono text-[10px]">
                    <div v-for="(g, i) in currentGrants" :key="i" class="p-2.5 rounded-lg bg-background/80 border border-border/30 text-foreground/70 leading-relaxed shadow-sm hover:border-primary/20 transition-colors">
                      {{ g }}
                    </div>
                  </div>
                </div>

                <!-- 汇总统计 -->
                <div class="grid grid-cols-2 gap-4">
                   <div class="p-4 rounded-xl border border-border/30 bg-card/50 shadow-sm relative overflow-hidden group hover:border-primary/30 transition-all">
                      <div class="absolute -right-2 -bottom-2 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
                        <Shield class="h-16 w-16 text-primary" />
                      </div>
                      <div class="text-[10px] text-muted-foreground font-bold uppercase mb-1 flex items-center gap-1.5">
                        <Globe class="h-3 w-3 text-primary/60" />
                        全局权限数
                      </div>
                      <div class="text-3xl font-black text-primary tracking-tight">{{ checkedGlobalPrivileges.size }}</div>
                   </div>
                   <div class="p-4 rounded-xl border border-border/30 bg-card/50 shadow-sm relative overflow-hidden group hover:border-amber-500/30 transition-all">
                      <div class="absolute -right-2 -bottom-2 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
                        <DatabaseIcon class="h-16 w-16 text-amber-500" />
                      </div>
                      <div class="text-[10px] text-muted-foreground font-bold uppercase mb-1 flex items-center gap-1.5">
                        <DatabaseIcon class="h-3 w-3 text-amber-500/60" />
                        已授权数据库
                      </div>
                      <div class="text-3xl font-black text-amber-500 tracking-tight">{{ dbPrivileges.size }}</div>
                   </div>
                </div>
              </div>

              <!-- Tab: 全局权限 -->
              <div v-if="activeTab === 'global'" class="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div v-for="(privs, category) in CATEGORIZED_GLOBAL_PRIVILEGES" :key="category" class="space-y-3">
                  <h4 class="text-xs font-bold flex items-center gap-2 text-muted-foreground/80 ml-1">
                    <div class="h-1 w-1 rounded-full bg-primary/40" />
                    {{ category }}
                  </h4>
                  <div class="grid grid-cols-3 gap-2 ml-4">
                    <div
                      v-for="priv in privs"
                      :key="priv"
                      class="group flex items-center justify-between gap-2 p-2 rounded-lg border transition-all"
                      :class="[
                        checkedGlobalPrivileges.has(priv) 
                          ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/10' 
                          : 'border-border/40 bg-background/50 hover:border-border hover:bg-muted/30',
                        !hasGrantOption ? 'opacity-50 pointer-events-none' : 'cursor-pointer'
                      ]"
                      @click="toggleGlobalPrivilege(priv)"
                    >
                      <div class="flex flex-col min-w-0">
                        <span class="text-[11px] font-bold truncate group-hover:text-primary transition-colors" :class="{ 'text-primary': checkedGlobalPrivileges.has(priv) }">{{ priv }}</span>
                        <span class="text-[9px] text-muted-foreground/60 truncate">{{ privLabels[priv] || '系统权限' }}</span>
                      </div>
                      <div class="h-4 w-4 rounded border border-border/60 flex items-center justify-center transition-colors shadow-inner" :class="{ 'bg-primary border-primary text-primary-foreground': checkedGlobalPrivileges.has(priv) }">
                         <Check v-if="checkedGlobalPrivileges.has(priv)" class="h-3 w-3" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Tab: 数据库级权限 -->
              <div v-if="activeTab === 'database'" class="flex h-[500px] gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <!-- 左列：库列表 -->
                <div class="flex w-[240px] flex-col rounded-xl border border-border/30 bg-muted/10 overflow-hidden shadow-sm">
                   <div class="p-2 border-b border-border/20 bg-muted/20">
                      <div class="relative">
                        <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40" />
                        <Input v-model="dbSearchQuery" class="h-7 pl-6 text-[10px] bg-background/50" placeholder="查找数据库..." />
                      </div>
                   </div>
                   <ScrollArea class="flex-1">
                      <div class="p-1 space-y-0.5">
                        <div
                          v-for="db in filteredDatabases"
                          :key="db"
                          class="group flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] cursor-pointer"
                          :class="activeDb === db ? 'bg-amber-500/10 text-amber-700 font-bold' : 'hover:bg-accent/50 text-muted-foreground'"
                          @click="activeDb = db"
                        >
                          <DatabaseIcon class="h-3.5 w-3.5 shrink-0 opacity-50" :class="{ 'text-amber-500 opacity-100': activeDb === db }" />
                          <span class="flex-1 truncate">{{ db }}</span>
                          <div v-if="dbPrivileges.has(db)" class="h-4 w-4 rounded-full bg-amber-500/20 text-amber-600 flex items-center justify-center text-[9px] font-black">
                            {{ dbPrivileges.get(db)?.size }}
                          </div>
                        </div>
                      </div>
                   </ScrollArea>
                </div>

                <!-- 右列：库权限详情 -->
                <div class="flex-1 rounded-xl border border-border/30 bg-card/60 overflow-hidden flex flex-col shadow-inner">
                   <template v-if="activeDb">
                      <div class="flex items-center justify-between border-b border-border/20 bg-muted/20 px-4 py-2.5">
                        <div class="flex items-center gap-2">
                          <DatabaseIcon class="h-4 w-4 text-amber-500" />
                          <span class="text-xs font-bold">{{ activeDb }} 权限</span>
                        </div>
                        <Button 
                          v-if="dbPrivileges.has(activeDb)" 
                          variant="ghost" 
                          size="sm" 
                          class="h-6 text-[10px] text-destructive hover:bg-destructive/10"
                          @click="revokeAllFromDb(activeDb!)"
                        >
                          <Trash2 class="h-3 w-3 mr-1" /> 撤销全部
                        </Button>
                      </div>
                      
                      <div class="p-4 grid grid-cols-2 gap-x-6 gap-y-3 overflow-y-auto">
                        <div
                          v-for="priv in DB_LEVEL_PRIVS"
                          :key="priv"
                          class="flex items-center justify-between gap-3 group p-2 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border/30"
                          :class="{ 'bg-amber-50/30 font-bold': dbPrivileges.get(activeDb!)?.has(priv) }"
                          @click="toggleDbPrivilege(activeDb!, priv)"
                        >
                          <div class="flex flex-col">
                            <span class="text-[11px] font-mono group-hover:text-amber-600 transition-colors" :class="{ 'text-amber-600': dbPrivileges.get(activeDb!)?.has(priv) }">{{ priv }}</span>
                            <span class="text-[9px] text-muted-foreground/50 font-normal">{{ privLabels[priv] || '操作权限' }}</span>
                          </div>
                          <div class="h-4 w-4 rounded-md border border-border/60 flex items-center justify-center transition-all bg-background shadow-inner" :class="{ 'bg-amber-500 border-amber-500 text-white rotate-6 scale-110 shadow-lg': dbPrivileges.get(activeDb!)?.has(priv) }">
                             <Check v-if="dbPrivileges.get(activeDb)?.has(priv)" class="h-3 w-3 stroke-[3px]" />
                          </div>
                        </div>
                      </div>
                   </template>
                   <div v-else class="flex-1 flex flex-col items-center justify-center text-center opacity-40">
                      <DatabaseIcon class="h-10 w-10 mb-2 stroke-1" />
                      <p class="text-xs font-medium">请从左侧选择数据库<br/>以配置专属权限</p>
                   </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </template>

        <!-- 未选中用户时的占位 -->
        <template v-else>
          <div class="flex h-full flex-col items-center justify-center overflow-hidden">
             <!-- 动态背景背景组件 -->
             <div class="absolute inset-0 opacity-10 pointer-events-none">
                <div class="absolute top-1/4 left-1/4 h-64 w-64 rounded-full bg-primary/20 blur-3xl animate-pulse" />
                <div class="absolute bottom-1/4 right-1/4 h-80 w-80 rounded-full bg-amber-500/20 blur-3xl" />
             </div>
             
             <div class="relative flex flex-col items-center text-center max-w-[280px]">
                <div class="relative mb-8">
                  <div class="absolute inset-0 animate-ping rounded-full bg-primary/20 scale-125 opacity-10 duration-1000" />
                  <div class="relative h-20 w-20 rounded-3xl bg-gradient-to-br from-primary/10 to-primary/30 border border-primary/20 flex items-center justify-center shadow-xl shadow-primary/10">
                    <Shield class="h-10 w-10 text-primary/60" />
                  </div>
                </div>
                <h3 class="text-xl font-bold text-foreground/80 mb-3 tracking-tight">欢迎使用权限指挥中心</h3>
                <p class="text-[11px] font-medium text-muted-foreground/50 leading-relaxed px-2">
                  请从左侧账户列表中选取一个指挥官。<br/>
                  在这里，您可以精确控制 MySQL 用户的每一项权力。
                </p>
             </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 弹窗部分 -->
    
    <!-- 1. 新建用户对话框 -->
    <Dialog v-model:open="showCreateDialog">
      <DialogContent class="max-w-md rounded-2xl border-border/20 shadow-2xl overflow-hidden p-0 animate-in zoom-in-95 duration-200">
        <div class="bg-primary/5 px-6 py-4 border-b border-border/20 flex items-center gap-3">
            <div class="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Plus class="h-4 w-4 text-primary" />
            </div>
            <div>
              <DialogTitle class="text-sm font-bold">创建新指挥官</DialogTitle>
              <DialogDescription class="text-[10px] opacity-60">为您的数据库服务器配置新的访问权</DialogDescription>
            </div>
        </div>
        
        <div class="p-6 space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <Label class="text-[11px] font-bold text-muted-foreground ml-1 uppercase">用户名</Label>
              <Input v-model="createForm.username" class="h-9 text-sm bg-muted/20 border-border/50 focus:border-primary/40 focus:bg-background transition-all" placeholder="例如: web_app" />
            </div>
            <div class="space-y-1.5">
              <Label class="text-[11px] font-bold text-muted-foreground ml-1 uppercase">登录主机</Label>
              <Input v-model="createForm.host" class="h-9 text-sm bg-muted/20 border-border/50" placeholder="例如: 127.0.0.1" />
            </div>
          </div>

          <div class="space-y-1.5">
            <Label class="text-[11px] font-bold text-muted-foreground ml-1 uppercase">认证密码</Label>
            <div class="relative">
               <KeyRound class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
               <Input v-model="createForm.password" type="password" class="h-9 pl-10 text-sm bg-muted/20 border-border/50" placeholder="••••••••" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
             <div class="space-y-1.5">
                <Label class="text-[11px] font-bold text-muted-foreground ml-1 uppercase">认证插件</Label>
                <Select :model-value="createForm.plugin" @update:model-value="createForm.plugin = $event">
                  <SelectTrigger class="h-9 text-xs bg-muted/20 border-border/50">
                    <SelectValue placeholder="选择认证方式" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="caching_sha2_password">SHA2 (推荐)</SelectItem>
                    <SelectItem value="mysql_native_password">Native (旧版)</SelectItem>
                  </SelectContent>
                </Select>
             </div>
             <div class="space-y-1.5">
                <Label class="text-[11px] font-bold text-muted-foreground ml-1 uppercase">密码有效期 (天)</Label>
                <Input type="number" :model-value="createForm.passwordExpireDays ?? ''" @update:model-value="createForm.passwordExpireDays = $event ? Number($event) : null" class="h-9 text-sm bg-muted/20 border-border/50" placeholder="永久" />
             </div>
          </div>

          <div v-if="createError" class="rounded-lg bg-destructive/10 p-3 flex gap-2 text-destructive border border-destructive/20 animate-in shake-in-from-left-1 duration-200">
            <AlertTriangle class="h-4 w-4 shrink-0" />
            <span class="text-[11px] font-medium leading-tight">{{ createError }}</span>
          </div>
        </div>

        <div class="px-6 py-4 bg-muted/10 border-t border-border/20 flex justify-end gap-2">
           <Button variant="ghost" class="h-8 text-xs font-bold" @click="showCreateDialog = false">我再想想</Button>
           <Button class="h-8 px-6 text-xs font-bold shadow-lg shadow-primary/20" :disabled="isCreating" @click="handleCreateUser">
              <Loader2 v-if="isCreating" class="h-3 w-3 animate-spin mr-2" />
              确认创建
           </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- 2. 修改密码对话框 -->
    <Dialog v-model:open="showChangePassword">
      <DialogContent class="max-w-sm rounded-2xl p-0 overflow-hidden shadow-2xl border-border/20">
        <div class="p-6">
           <div class="h-12 w-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-4 border border-amber-500/20">
              <KeyRound class="h-6 w-6 text-amber-600" />
           </div>
           <DialogTitle class="text-base font-bold mb-1">重置密码</DialogTitle>
           <p class="text-xs text-muted-foreground mb-6">正在为 <b>{{ selectedUser?.user }}</b> 设置新的访问凭据</p>
           
           <div class="space-y-4">
              <div class="space-y-2">
                 <Label class="text-[10px] font-black text-muted-foreground uppercase tracking-widest">新密码</Label>
                 <Input v-model="newPassword" type="password" class="h-10 text-sm bg-muted/30 border-border/50 px-4" placeholder="••••••••" @keydown.enter="handleChangePassword" />
              </div>
           </div>
        </div>
        <div class="p-4 bg-muted/20 border-t border-border/10 flex gap-2">
           <Button variant="ghost" class="flex-1 h-9 text-xs" @click="showChangePassword = false">取消</Button>
           <Button class="flex-1 h-9 bg-amber-600 hover:bg-amber-700 text-xs shadow-lg shadow-amber-600/20" :disabled="isChangingPassword || !newPassword" @click="handleChangePassword">
              <Loader2 v-if="isChangingPassword" class="h-3 w-3 animate-spin mr-2" />
              提交重置
           </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- 3. 删除用户确认 -->
    <ConfirmDialog
      v-model:open="showDeleteConfirm"
      title="确认移除用户账户？"
      :description="userToDelete?.user.startsWith('mysql.') 
        ? `🚨 高危预警：'${userToDelete?.user}' 是系统内置账户，移除可能导致数据库服务异常或无法管理。建议仅在完全了解后果的情况下继续。` 
        : `您正在尝试永久移除用户 '${userToDelete?.user ?? ''}'@'${userToDelete?.host ?? ''}'。该操作将撤销其所有关联权限且不可恢复。`"
      confirm-label="确认注销"
      cancel-label="取消"
      variant="destructive"
      class="max-w-md"
      @confirm="handleDeleteUser"
    />
  </div>
</template>

<style scoped>
.pulse-small {
  animation: pulse-dot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse-dot {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.85);
  }
}

.blink {
  animation: blinker 1.5s cubic-bezier(0.5, 0, 1, 0.5) infinite alternate;
}

@keyframes blinker {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0.4; transform: scale(0.8); }
}

/* 用户列表项统一阴影效果，不受内容宽度影响 */
.user-list-item {
  box-shadow: none;
  transition: background-color 0.2s ease, box-shadow 0.2s ease;
}

.user-list-item:hover {
  box-shadow: 0 1px 4px 0 rgba(0, 0, 0, 0.04);
}

/* 优化背景渐变质感 */
.bg-card\/50 {
  backdrop-filter: blur(8px);
}
</style>
