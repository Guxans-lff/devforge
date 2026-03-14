/**
 * 用户权限管理核心业务逻辑 composable
 * 从 UserManagementPanel.vue 提取，负责用户 CRUD、权限加载/解析/应用
 */
import { ref, computed, type Ref } from 'vue'
import {
  dbGetUsers, dbCreateUser, dbDropUser,
  dbGetUserGrants, dbApplyGrants, dbExecuteQuery, dbGetDatabases,
} from '@/api/database'
import type { MysqlUser, CreateUserRequest } from '@/types/database'
import { ALL_PRIVS_LIST, DB_LEVEL_PRIVS } from '@/types/user-management-constants'

export interface UseUserManagementOptions {
  connectionId: Ref<string>
  isConnected: Ref<boolean>
}

export function useUserManagement(options: UseUserManagementOptions) {
  const { connectionId, isConnected } = options

  // ===== 用户列表状态 =====
  const users = ref<MysqlUser[]>([])
  const isLoading = ref(false)
  const errorMessage = ref<string | null>(null)
  const searchQuery = ref('')
  const selectedUser = ref<MysqlUser | null>(null)
  const hasGrantOption = ref(true)
  const checkingGrant = ref(false)

  // ===== 新建用户 =====
  const showCreateDialog = ref(false)
  const createForm = ref<CreateUserRequest>({
    username: '', host: '%', password: '',
    plugin: 'mysql_native_password', passwordExpireDays: null,
  })
  const isCreating = ref(false)
  const createError = ref<string | null>(null)

  // ===== 删除用户 =====
  const showDeleteConfirm = ref(false)
  const userToDelete = ref<MysqlUser | null>(null)
  const isDeleting = ref(false)

  // ===== 权限编辑 =====
  const showGrantPanel = ref(false)
  const grantUser = ref<MysqlUser | null>(null)
  const activeTab = ref<'global' | 'database' | 'overview'>('overview')
  const currentGrants = ref<string[]>([])
  const isLoadingGrants = ref(false)
  const grantError = ref<string | null>(null)
  const isApplySuccess = ref(false)
  const isApplyingGrants = ref(false)

  // ===== 全局权限 =====
  const checkedGlobalPrivileges = ref<Set<string>>(new Set())
  const originalGlobalPrivileges = ref<Set<string>>(new Set())

  // ===== 数据库级权限 =====
  const allDatabases = ref<string[]>([])
  const dbSearchQuery = ref('')
  const dbPrivileges = ref<Map<string, Set<string>>>(new Map())
  const originalDbPrivileges = ref<Map<string, Set<string>>>(new Map())
  const activeDb = ref<string | null>(null)

  // ===== 修改密码 =====
  const showChangePassword = ref(false)
  const newPassword = ref('')
  const isChangingPassword = ref(false)

  // ===== computed =====
  const filteredUsers = computed(() => {
    const q = searchQuery.value.toLowerCase().trim()
    if (!q) return users.value
    return users.value.filter(u =>
      u.user.toLowerCase().includes(q) || u.host.toLowerCase().includes(q),
    )
  })

  const hasGrantChanges = computed(() => {
    if (checkedGlobalPrivileges.value.size !== originalGlobalPrivileges.value.size) return true
    for (const p of Array.from(checkedGlobalPrivileges.value)) {
      if (!originalGlobalPrivileges.value.has(p)) return true
    }
    for (const p of originalGlobalPrivileges.value) {
      if (!checkedGlobalPrivileges.value.has(p)) return true
    }
    if (dbPrivileges.value.size !== originalDbPrivileges.value.size) return true
    for (const [db, privs] of Array.from(dbPrivileges.value.entries())) {
      const orig = originalDbPrivileges.value.get(db)
      if (!orig) return true
      if (privs.size !== orig.size) return true
      for (const p of Array.from(privs)) if (!orig.has(p)) return true
    }
    return false
  })

  const filteredDatabases = computed(() => {
    const q = dbSearchQuery.value.toLowerCase().trim()
    return allDatabases.value.filter(db => db.toLowerCase().includes(q))
  })

  // ===== 方法 =====

  async function loadUsers() {
    if (!isConnected.value) return
    isLoading.value = true
    errorMessage.value = null
    try {
      const list = await dbGetUsers(connectionId.value)
      users.value = list
      if (selectedUser.value) {
        const latest = list.find(u => u.user === selectedUser.value?.user && u.host === selectedUser.value?.host)
        if (latest) {
          selectedUser.value = latest
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

  async function checkGrantOption() {
    if (!isConnected.value) return
    checkingGrant.value = true
    try {
      const result = await dbExecuteQuery(connectionId.value, 'SHOW GRANTS FOR CURRENT_USER()')
      const grants = result.rows.map(r => String(r[0] ?? '').toUpperCase())
      hasGrantOption.value = grants.some(g =>
        g.includes('ALL PRIVILEGES') || g.includes('GRANT OPTION'),
      )
    } catch {
      hasGrantOption.value = false
    } finally {
      checkingGrant.value = false
    }
  }

  function openCreateDialog() {
    createForm.value = {
      username: '', host: '%', password: '',
      plugin: 'mysql_native_password', passwordExpireDays: null,
    }
    createError.value = null
    showCreateDialog.value = true
  }

  async function handleCreateUser() {
    if (!createForm.value.username.trim()) { createError.value = '用户名不能为空'; return }
    if (!createForm.value.password.trim()) { createError.value = '密码不能为空'; return }
    isCreating.value = true
    createError.value = null
    try {
      await dbCreateUser(connectionId.value, createForm.value)
      showCreateDialog.value = false
      await loadUsers()
    } catch (e) {
      createError.value = String(e)
    } finally {
      isCreating.value = false
    }
  }

  function confirmDeleteUser(user: MysqlUser) {
    userToDelete.value = user
    showDeleteConfirm.value = true
  }

  async function handleDeleteUser() {
    if (!userToDelete.value) return
    isDeleting.value = true
    try {
      await dbDropUser(connectionId.value, userToDelete.value.user, userToDelete.value.host)
      showDeleteConfirm.value = false
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

  async function openGrantEditor(user: MysqlUser) {
    if (!user) return
    selectedUser.value = user
    grantUser.value = user
    showGrantPanel.value = true
    await loadUserGrants(user)
  }

  async function loadUserGrants(user: MysqlUser) {
    if (!user || user.user === undefined) return
    isLoadingGrants.value = true
    grantError.value = null
    checkedGlobalPrivileges.value = new Set()
    dbPrivileges.value = new Map()
    try {
      currentGrants.value = await dbGetUserGrants(connectionId.value, user.user, user.host)
      parseGrants(currentGrants.value)
      originalGlobalPrivileges.value = new Set(checkedGlobalPrivileges.value)
      originalDbPrivileges.value = new Map(
        Array.from(dbPrivileges.value.entries()).map(([k, v]) => [k, new Set(v)]),
      )
    } catch (e) {
      grantError.value = String(e)
    } finally {
      isLoadingGrants.value = false
    }
  }

  function parseGrants(grants: string[]) {
    const globalPrivs = new Set<string>()
    const dbPrivs = new Map<string, Set<string>>()

    for (const grant of grants) {
      const upper = grant.toUpperCase()

      const globalMatch = upper.match(/^GRANT\s+(.+?)\s+ON\s+\*\.\*\s+TO\s+/)
      if (globalMatch) {
        const privStr = globalMatch[1]!
        if (privStr.includes('ALL PRIVILEGES')) {
          ALL_PRIVS_LIST.forEach(p => { if (p !== 'GRANT OPTION') globalPrivs.add(p) })
        } else {
          privStr.split(',').map(p => p.trim()).forEach(p => {
            if (ALL_PRIVS_LIST.includes(p)) globalPrivs.add(p)
          })
        }
        if (upper.includes('WITH GRANT OPTION')) globalPrivs.add('GRANT OPTION')
        continue
      }

      const dbMatch = upper.match(/^GRANT\s+(.+?)\s+ON\s+[`']?(.+?)[`']?\.\*\s+TO\s+/)
      if (dbMatch) {
        const privStr = dbMatch[1]!
        const dbName = dbMatch[2]!
        const privSet = dbPrivs.get(dbName) ?? new Set<string>()
        if (privStr.includes('ALL PRIVILEGES')) {
          DB_LEVEL_PRIVS.forEach(p => { if (p !== 'GRANT OPTION') privSet.add(p) })
        } else {
          privStr.split(',').map(p => p.trim()).forEach(p => {
            if (DB_LEVEL_PRIVS.includes(p)) privSet.add(p)
          })
        }
        dbPrivs.set(dbName, privSet)
      }
    }

    checkedGlobalPrivileges.value = globalPrivs
    dbPrivileges.value = dbPrivs
  }

  function toggleGlobalPrivilege(priv: string) {
    if (!hasGrantOption.value) return
    const newSet = new Set(checkedGlobalPrivileges.value)
    if (newSet.has(priv)) newSet.delete(priv); else newSet.add(priv)
    checkedGlobalPrivileges.value = newSet
  }

  function toggleDbPrivilege(db: string, priv: string) {
    if (!hasGrantOption.value) return
    const newMap = new Map(dbPrivileges.value)
    const privSet = new Set(newMap.get(db) || [])
    if (privSet.has(priv)) privSet.delete(priv); else privSet.add(priv)
    if (privSet.size === 0) newMap.delete(db); else newMap.set(db, privSet)
    dbPrivileges.value = newMap
  }

  function revokeAllFromDb(db: string) {
    const newMap = new Map(dbPrivileges.value)
    newMap.delete(db)
    dbPrivileges.value = newMap
    if (activeDb.value === db) activeDb.value = null
  }

  async function applyGrants() {
    if (!grantUser.value || !hasGrantChanges.value) return
    isApplyingGrants.value = true
    grantError.value = null

    const user = grantUser.value
    const userSpec = `'${user.user}'@'${user.host}'`
    const statements: string[] = []

    // 全局权限变更
    const toRevokeGlobal = Array.from(originalGlobalPrivileges.value).filter(p => !checkedGlobalPrivileges.value.has(p) && p !== 'GRANT OPTION')
    const toGrantGlobal = Array.from(checkedGlobalPrivileges.value).filter(p => !originalGlobalPrivileges.value.has(p) && p !== 'GRANT OPTION')
    if (toRevokeGlobal.length > 0) statements.push(`REVOKE ${toRevokeGlobal.join(', ')} ON *.* FROM ${userSpec}`)
    if (toGrantGlobal.length > 0) {
      let stmt = `GRANT ${toGrantGlobal.join(', ')} ON *.* TO ${userSpec}`
      if (checkedGlobalPrivileges.value.has('GRANT OPTION')) stmt += ' WITH GRANT OPTION'
      statements.push(stmt)
    }

    const hadGrantOption = originalGlobalPrivileges.value.has('GRANT OPTION')
    const hasGrantOptionNow = checkedGlobalPrivileges.value.has('GRANT OPTION')
    if (hasGrantOptionNow && !hadGrantOption && toGrantGlobal.length === 0) {
      statements.push(`GRANT USAGE ON *.* TO ${userSpec} WITH GRANT OPTION`)
    } else if (!hasGrantOptionNow && hadGrantOption) {
      statements.push(`REVOKE GRANT OPTION ON *.* FROM ${userSpec}`)
    }

    // 数据库级权限变更
    for (const [db, oldPrivs] of Array.from(originalDbPrivileges.value.entries())) {
      const newPrivs = dbPrivileges.value.get(db)
      if (!newPrivs) {
        statements.push(`REVOKE ALL PRIVILEGES ON \`${db}\`.* FROM ${userSpec}`)
      } else {
        const revoked = Array.from(oldPrivs).filter((p: string) => !newPrivs.has(p))
        if (revoked.length > 0) statements.push(`REVOKE ${revoked.join(', ')} ON \`${db}\`.* FROM ${userSpec}`)
      }
    }
    for (const [db, newPrivs] of Array.from(dbPrivileges.value.entries())) {
      const oldPrivs = originalDbPrivileges.value.get(db) || new Set<string>()
      const granted = Array.from(newPrivs).filter((p: string) => !oldPrivs.has(p))
      if (granted.length > 0) statements.push(`GRANT ${granted.join(', ')} ON \`${db}\`.* TO ${userSpec}`)
    }

    if (statements.length === 0) { isApplyingGrants.value = false; return }
    statements.push('FLUSH PRIVILEGES')

    try {
      await dbApplyGrants(connectionId.value, statements)
      await loadUserGrants(grantUser.value)
      isApplySuccess.value = true
      setTimeout(() => { isApplySuccess.value = false }, 3000)
    } catch (e) {
      grantError.value = String(e)
    } finally {
      isApplyingGrants.value = false
    }
  }

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

  async function loadDatabases() {
    try {
      const res = await dbGetDatabases(connectionId.value)
      allDatabases.value = res.map(d => d.name)
    } catch (e) {
      console.error('加载数据库列表失败', e)
    }
  }

  async function handleChangePassword() {
    if (!selectedUser.value || !newPassword.value) return
    isChangingPassword.value = true
    try {
      const userSpec = `'${selectedUser.value.user}'@'${selectedUser.value.host}'`
      await dbExecuteQuery(connectionId.value, `ALTER USER ${userSpec} IDENTIFIED BY '${newPassword.value}'`)
      showChangePassword.value = false
      newPassword.value = ''
      await loadUsers()
    } catch (e) {
      errorMessage.value = `修改密码失败: ${e}`
    } finally {
      isChangingPassword.value = false
    }
  }

  async function toggleUserLock(user: MysqlUser) {
    const isLocked = user.accountLocked === 'Y'
    const action = isLocked ? 'ACCOUNT UNLOCK' : 'ACCOUNT LOCK'
    try {
      const userSpec = `'${user.user}'@'${user.host}'`
      await dbExecuteQuery(connectionId.value, `ALTER USER ${userSpec} ${action}`)
      await loadUsers()
    } catch (e) {
      errorMessage.value = `操作失败: ${e}`
    }
  }

  /** 初始化加载 */
  async function init() {
    await Promise.all([loadUsers(), checkGrantOption(), loadDatabases()])
  }

  return {
    // 用户列表
    users, isLoading, errorMessage, searchQuery, selectedUser,
    hasGrantOption, checkingGrant, filteredUsers,
    // 新建用户
    showCreateDialog, createForm, isCreating, createError,
    openCreateDialog, handleCreateUser,
    // 删除用户
    showDeleteConfirm, userToDelete, isDeleting,
    confirmDeleteUser, handleDeleteUser,
    // 权限编辑
    showGrantPanel, grantUser, activeTab,
    currentGrants, isLoadingGrants, grantError, isApplySuccess, isApplyingGrants,
    checkedGlobalPrivileges, originalGlobalPrivileges,
    allDatabases, dbSearchQuery, dbPrivileges, originalDbPrivileges, activeDb,
    hasGrantChanges, filteredDatabases,
    openGrantEditor, toggleGlobalPrivilege, toggleDbPrivilege,
    revokeAllFromDb, applyGrants, exportToSql,
    // 修改密码
    showChangePassword, newPassword, isChangingPassword, handleChangePassword,
    // 操作
    loadUsers, toggleUserLock, init,
  }
}
