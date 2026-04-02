<script setup lang="ts">
/**
 * 用户权限管理面板（编排层）
 * 使用 useUserManagement composable 管理逻辑，委托子组件渲染 UI
 */
import { onMounted, toRef } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Shield, Plus, Loader2, AlertTriangle, KeyRound } from 'lucide-vue-next'
import { useUserManagement } from '@/composables/useUserManagement'
import UserList from './user-management/UserList.vue'
import UserGrantPanel from './user-management/UserGrantPanel.vue'

const props = defineProps<{
  connectionId: string
  isConnected: boolean
}>()

const mgmt = useUserManagement({
  connectionId: toRef(props, 'connectionId'),
  isConnected: toRef(props, 'isConnected'),
})

onMounted(() => mgmt.init())
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-background">
    <!-- 主体内容：左右分栏 -->
    <div class="flex flex-1 min-h-0">
      <!-- 左侧：用户列表 -->
      <UserList
        :users="mgmt.users.value"
        :filtered-users="mgmt.filteredUsers.value"
        :selected-user="mgmt.selectedUser.value"
        :is-loading="mgmt.isLoading.value"
        :has-grant-option="mgmt.hasGrantOption.value"
        :checking-grant="mgmt.checkingGrant.value"
        :search-query="mgmt.searchQuery.value"
        @update:search-query="(v) => mgmt.searchQuery.value = v"
        @select-user="mgmt.openGrantEditor"
        @delete-user="mgmt.confirmDeleteUser"
        @create-user="mgmt.openCreateDialog"
        @refresh="mgmt.loadUsers"
      />

      <!-- 右侧：权限详情 -->
      <UserGrantPanel
        v-if="mgmt.showGrantPanel.value && mgmt.grantUser.value"
        :grant-user="mgmt.grantUser.value"
        :active-tab="mgmt.activeTab.value"
        :current-grants="mgmt.currentGrants.value"
        :is-loading-grants="mgmt.isLoadingGrants.value"
        :grant-error="mgmt.grantError.value"
        :is-apply-success="mgmt.isApplySuccess.value"
        :is-applying-grants="mgmt.isApplyingGrants.value"
        :has-grant-option="mgmt.hasGrantOption.value"
        :has-grant-changes="mgmt.hasGrantChanges.value"
        :checked-global-privileges="mgmt.checkedGlobalPrivileges.value"
        :db-privileges="mgmt.dbPrivileges.value"
        :filtered-databases="mgmt.filteredDatabases.value"
        :active-db="mgmt.activeDb.value"
        :db-search-query="mgmt.dbSearchQuery.value"
        @update:active-tab="(v) => mgmt.activeTab.value = v"
        @update:active-db="(v) => mgmt.activeDb.value = v"
        @update:db-search-query="(v) => mgmt.dbSearchQuery.value = v"
        @toggle-global-privilege="mgmt.toggleGlobalPrivilege"
        @toggle-db-privilege="mgmt.toggleDbPrivilege"
        @revoke-all-from-db="mgmt.revokeAllFromDb"
        @apply-grants="mgmt.applyGrants"
        @export-to-sql="mgmt.exportToSql"
        @change-password="() => mgmt.showChangePassword.value = true"
        @toggle-lock="mgmt.toggleUserLock"
      />

      <!-- 未选中用户时的占位 -->
      <div v-else class="flex-1 flex h-full flex-col items-center justify-center overflow-hidden relative">
        <div class="absolute inset-0 opacity-10 pointer-events-none">
          <div class="absolute top-1/4 left-1/4 h-64 w-64 rounded-full bg-primary/20 blur-3xl animate-pulse" />
          <div class="absolute bottom-1/4 right-1/4 h-80 w-80 rounded-full bg-df-warning/20 blur-3xl" />
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
    </div>

    <!-- ===== 对话框 ===== -->

    <!-- 新建用户 -->
    <Dialog v-model:open="mgmt.showCreateDialog.value">
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
              <Input v-model="mgmt.createForm.value.username" class="h-9 text-sm bg-muted/20 border-border/50 focus:border-primary/40 focus:bg-background transition-[border-color,background-color]" placeholder="例如: web_app" />
            </div>
            <div class="space-y-1.5">
              <Label class="text-[11px] font-bold text-muted-foreground ml-1 uppercase">登录主机</Label>
              <Input v-model="mgmt.createForm.value.host" class="h-9 text-sm bg-muted/20 border-border/50" placeholder="例如: 127.0.0.1" />
            </div>
          </div>

          <div class="space-y-1.5">
            <Label class="text-[11px] font-bold text-muted-foreground ml-1 uppercase">认证密码</Label>
            <div class="relative">
              <KeyRound class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
              <Input v-model="mgmt.createForm.value.password" type="password" class="h-9 pl-10 text-sm bg-muted/20 border-border/50" placeholder="••••••••" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <Label class="text-[11px] font-bold text-muted-foreground ml-1 uppercase">认证插件</Label>
              <Select :model-value="mgmt.createForm.value.plugin" @update:model-value="mgmt.createForm.value.plugin = $event as string | null">
                <SelectTrigger class="h-9 text-xs bg-muted/20 border-border/50"><SelectValue placeholder="选择认证方式" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="caching_sha2_password">SHA2 (推荐)</SelectItem>
                  <SelectItem value="mysql_native_password">Native (旧版)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5">
              <Label class="text-[11px] font-bold text-muted-foreground ml-1 uppercase">密码有效期 (天)</Label>
              <Input type="number" :model-value="mgmt.createForm.value.passwordExpireDays ?? ''" @update:model-value="mgmt.createForm.value.passwordExpireDays = $event ? Number($event) : null" class="h-9 text-sm bg-muted/20 border-border/50" placeholder="永久" />
            </div>
          </div>

          <div v-if="mgmt.createError.value" class="rounded-lg bg-destructive/10 p-3 flex gap-2 text-destructive border border-destructive/20">
            <AlertTriangle class="h-4 w-4 shrink-0" />
            <span class="text-[11px] font-medium leading-tight">{{ mgmt.createError.value }}</span>
          </div>
        </div>

        <div class="px-6 py-4 bg-muted/10 border-t border-border/20 flex justify-end gap-2">
          <Button variant="ghost" class="h-8 text-xs font-bold" @click="mgmt.showCreateDialog.value = false">我再想想</Button>
          <Button class="h-8 px-6 text-xs font-bold shadow-lg shadow-primary/20" :disabled="mgmt.isCreating.value" @click="mgmt.handleCreateUser">
            <Loader2 v-if="mgmt.isCreating.value" class="h-3 w-3 animate-spin mr-2" />
            确认创建
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- 修改密码 -->
    <Dialog v-model:open="mgmt.showChangePassword.value">
      <DialogContent class="max-w-sm rounded-2xl p-0 overflow-hidden shadow-2xl border-border/20">
        <div class="p-6">
          <div class="h-12 w-12 rounded-2xl bg-df-warning/10 flex items-center justify-center mb-4 border border-df-warning/20">
            <KeyRound class="h-6 w-6 text-df-warning" />
          </div>
          <DialogTitle class="text-base font-bold mb-1">重置密码</DialogTitle>
          <p class="text-xs text-muted-foreground mb-6">正在为 <b>{{ mgmt.selectedUser.value?.user }}</b> 设置新的访问凭据</p>
          <div class="space-y-4">
            <div class="space-y-2">
              <Label class="text-[10px] font-black text-muted-foreground uppercase tracking-widest">新密码</Label>
              <Input v-model="mgmt.newPassword.value" type="password" class="h-10 text-sm bg-muted/30 border-border/50 px-4" placeholder="••••••••" @keydown.enter="mgmt.handleChangePassword" />
            </div>
          </div>
        </div>
        <div class="p-4 bg-muted/20 border-t border-border/10 flex gap-2">
          <Button variant="ghost" class="flex-1 h-9 text-xs" @click="mgmt.showChangePassword.value = false">取消</Button>
          <Button class="flex-1 h-9 bg-df-warning hover:bg-df-warning/90 text-xs shadow-lg shadow-df-warning/20" :disabled="mgmt.isChangingPassword.value || !mgmt.newPassword.value" @click="mgmt.handleChangePassword">
            <Loader2 v-if="mgmt.isChangingPassword.value" class="h-3 w-3 animate-spin mr-2" />
            提交重置
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- 删除确认 -->
    <ConfirmDialog
      v-model:open="mgmt.showDeleteConfirm.value"
      title="确认移除用户账户？"
      :description="mgmt.userToDelete.value?.user.startsWith('mysql.')
        ? `高危预警：'${mgmt.userToDelete.value?.user}' 是系统内置账户，移除可能导致数据库服务异常或无法管理。建议仅在完全了解后果的情况下继续。`
        : `您正在尝试永久移除用户 '${mgmt.userToDelete.value?.user ?? ''}'@'${mgmt.userToDelete.value?.host ?? ''}'。该操作将撤销其所有关联权限且不可恢复。`"
      confirm-label="确认注销"
      cancel-label="取消"
      variant="destructive"
      class="max-w-md"
      @confirm="mgmt.handleDeleteUser"
    />
  </div>
</template>
