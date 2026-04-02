<script setup lang="ts">
/**
 * 用户权限详情面板组件
 * 展示选中用户的权限概览、全局权限编辑、数据库级权限编辑
 */
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Shield, Loader2, AlertTriangle, Check, Lock, Unlock,
  KeyRound, Database as DatabaseIcon, Globe, Settings2,
  Info, Download, MoreVertical, Search, Trash2,
} from 'lucide-vue-next'
import type { MysqlUser } from '@/types/database'
import {
  PRIV_LABELS, CATEGORIZED_GLOBAL_PRIVILEGES, DB_LEVEL_PRIVS,
} from '@/types/user-management-constants'

defineProps<{
  grantUser: MysqlUser
  activeTab: 'global' | 'database' | 'overview'
  currentGrants: string[]
  isLoadingGrants: boolean
  grantError: string | null
  isApplySuccess: boolean
  isApplyingGrants: boolean
  hasGrantOption: boolean
  hasGrantChanges: boolean
  checkedGlobalPrivileges: Set<string>
  dbPrivileges: Map<string, Set<string>>
  filteredDatabases: string[]
  activeDb: string | null
  dbSearchQuery: string
}>()

const emit = defineEmits<{
  'update:activeTab': [value: 'global' | 'database' | 'overview']
  'update:activeDb': [value: string | null]
  'update:dbSearchQuery': [value: string]
  toggleGlobalPrivilege: [priv: string]
  toggleDbPrivilege: [db: string, priv: string]
  revokeAllFromDb: [db: string]
  applyGrants: []
  exportToSql: []
  changePassword: []
  toggleLock: [user: MysqlUser]
}>()

const tabItems = [
  { id: 'overview' as const, label: '概览', icon: Info },
  { id: 'global' as const, label: '全局权限', icon: Globe },
  { id: 'database' as const, label: '数据库级', icon: DatabaseIcon },
]
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0 bg-background relative">
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
            <div class="h-2 w-2 shrink-0 rounded-full shadow-sm blink" :class="grantUser.accountLocked === 'Y' ? 'bg-destructive' : 'bg-df-success'" />
            <span v-if="grantUser.user.startsWith('mysql.')" class="shrink-0 text-[8px] font-black tracking-widest text-primary/40 bg-primary/5 px-1.5 py-0.5 rounded-lg border border-primary/20 uppercase">
              System
            </span>
          </div>
          <p class="text-[9px] text-muted-foreground font-mono opacity-50 flex items-center gap-1.5 truncate mt-0.5">
            <Settings2 class="h-2.5 w-2.5 shrink-0" />
            {{ grantUser.plugin || 'default' }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <div class="flex items-center gap-2 pr-2 border-r border-border/50">
          <Button
            v-if="currentGrants.length"
            variant="outline" size="sm"
            class="h-9 px-3 gap-1.5 text-xs text-primary/80 hover:text-primary hover:bg-primary/5 border-primary/10 rounded-lg shrink-0 shadow-sm"
            @click="emit('exportToSql')"
          >
            <Download class="h-4 w-4" /> 导出SQL
          </Button>
          <Button
            v-if="hasGrantOption"
            :variant="isApplySuccess ? 'outline' : (hasGrantChanges ? 'default' : 'outline')"
            size="sm"
            class="h-9 px-4 gap-1.5 text-xs shadow-lg transition-[background-color,color,box-shadow,scale] active:scale-95 shrink-0"
            :class="[
              isApplySuccess ? 'text-df-success border-df-success/30' : '',
              hasGrantChanges && !isApplySuccess ? 'shadow-primary/20' : 'shadow-none'
            ]"
            :disabled="(!hasGrantChanges && !isApplySuccess) || isApplyingGrants"
            @click="emit('applyGrants')"
          >
            <template v-if="isApplySuccess"><Check class="h-4 w-4" /> 已应用</template>
            <template v-else>
              <Loader2 v-if="isApplyingGrants" class="h-4 w-4 animate-spin" />
              <Check v-else class="h-4 w-4" />
              应用当前变更
            </template>
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" class="h-9 w-9 rounded-xl hover:bg-accent">
              <MoreVertical class="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48 rounded-xl border-border/20 shadow-xl p-1.5">
            <DropdownMenuItem class="rounded-lg gap-2 cursor-pointer" @click="emit('changePassword')">
              <KeyRound class="h-4 w-4 text-df-warning/70" />
              <span class="text-xs font-medium">重置登录密码</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              class="rounded-lg gap-2 cursor-pointer"
              :class="grantUser.accountLocked === 'Y' ? 'text-df-success' : 'text-destructive/80'"
              @click="emit('toggleLock', grantUser)"
            >
              <component :is="grantUser.accountLocked === 'Y' ? Unlock : Lock" class="h-4 w-4" />
              <span class="text-xs font-medium">{{ grantUser.accountLocked === 'Y' ? '解除账户锁定' : '锁定该账户' }}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <!-- Tab 导航 -->
    <div class="flex border-b border-border/20 bg-muted/5 px-6">
      <button
        v-for="tab in tabItems" :key="tab.id"
        class="flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-medium transition-[background-color,color,border-color]"
        :class="activeTab === tab.id ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50'"
        @click="emit('update:activeTab', tab.id)"
      >
        <component :is="tab.icon" class="h-3.5 w-3.5" />
        {{ tab.label }}
      </button>
    </div>

    <!-- 权限编辑区域 -->
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
          <div class="rounded-xl border border-border/30 bg-muted/10 overflow-hidden shadow-sm">
            <div class="bg-muted/30 px-4 py-2 border-b border-border/20 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Globe class="h-3.5 w-3.5 text-primary/60" />
                <span class="text-[11px] font-bold text-foreground/80 uppercase tracking-wider">原始授权语句 (Original Statements)</span>
              </div>
              <Button
                v-if="currentGrants.length"
                variant="ghost" size="sm"
                class="h-7 gap-1.5 text-[10px] hover:bg-primary/5 transition-[background-color,opacity] opacity-60 hover:opacity-100"
                @click="emit('exportToSql')"
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

          <div class="grid grid-cols-2 gap-4">
            <div class="p-4 rounded-xl border border-border/30 bg-card/50 shadow-sm relative overflow-hidden group hover:border-primary/30 transition-[background-color,border-color]">
              <div class="absolute -right-2 -bottom-2 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
                <Shield class="h-16 w-16 text-primary" />
              </div>
              <div class="text-[10px] text-muted-foreground font-bold uppercase mb-1 flex items-center gap-1.5">
                <Globe class="h-3 w-3 text-primary/60" /> 全局权限数
              </div>
              <div class="text-3xl font-black text-primary tracking-tight">{{ checkedGlobalPrivileges.size }}</div>
            </div>
            <div class="p-4 rounded-xl border border-border/30 bg-card/50 shadow-sm relative overflow-hidden group hover:border-df-warning/30 transition-[background-color,border-color]">
              <div class="absolute -right-2 -bottom-2 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
                <DatabaseIcon class="h-16 w-16 text-df-warning" />
              </div>
              <div class="text-[10px] text-muted-foreground font-bold uppercase mb-1 flex items-center gap-1.5">
                <DatabaseIcon class="h-3 w-3 text-df-warning/60" /> 已授权数据库
              </div>
              <div class="text-3xl font-black text-df-warning tracking-tight">{{ dbPrivileges.size }}</div>
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
                v-for="priv in privs" :key="priv"
                class="group flex items-center justify-between gap-2 p-2 rounded-lg border transition-[background-color,border-color,box-shadow]"
                :class="[
                  checkedGlobalPrivileges.has(priv)
                    ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/10'
                    : 'border-border/40 bg-background/50 hover:border-border hover:bg-muted/30',
                  !hasGrantOption ? 'opacity-50 pointer-events-none' : 'cursor-pointer'
                ]"
                @click="emit('toggleGlobalPrivilege', priv)"
              >
                <div class="flex flex-col min-w-0">
                  <span class="text-[11px] font-bold truncate group-hover:text-primary transition-colors" :class="{ 'text-primary': checkedGlobalPrivileges.has(priv) }">{{ priv }}</span>
                  <span class="text-[9px] text-muted-foreground/60 truncate">{{ PRIV_LABELS[priv] || '系统权限' }}</span>
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
                <Input
                  :model-value="dbSearchQuery"
                  class="h-7 pl-6 text-[10px] bg-background/50"
                  placeholder="查找数据库..."
                  @update:model-value="emit('update:dbSearchQuery', $event as string)"
                />
              </div>
            </div>
            <ScrollArea class="flex-1">
              <div class="p-1 space-y-0.5">
                <div
                  v-for="db in filteredDatabases" :key="db"
                  class="group flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] cursor-pointer"
                  :class="activeDb === db ? 'bg-df-warning/10 text-df-warning font-bold' : 'hover:bg-accent/50 text-muted-foreground'"
                  @click="emit('update:activeDb', db)"
                >
                  <DatabaseIcon class="h-3.5 w-3.5 shrink-0 opacity-50" :class="{ 'text-df-warning opacity-100': activeDb === db }" />
                  <span class="flex-1 truncate">{{ db }}</span>
                  <div v-if="dbPrivileges.has(db)" class="h-4 w-4 rounded-full bg-df-warning/20 text-df-warning flex items-center justify-center text-[9px] font-black">
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
                  <DatabaseIcon class="h-4 w-4 text-df-warning" />
                  <span class="text-xs font-bold">{{ activeDb }} 权限</span>
                </div>
                <Button
                  v-if="dbPrivileges.has(activeDb)"
                  variant="ghost" size="sm"
                  class="h-6 text-[10px] text-destructive hover:bg-destructive/10"
                  @click="emit('revokeAllFromDb', activeDb!)"
                >
                  <Trash2 class="h-3 w-3 mr-1" /> 撤销全部
                </Button>
              </div>

              <div class="p-4 grid grid-cols-2 gap-x-6 gap-y-3 overflow-y-auto">
                <div
                  v-for="priv in DB_LEVEL_PRIVS" :key="priv"
                  class="flex items-center justify-between gap-3 group p-2 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border/30"
                  :class="{ 'bg-df-warning/10 font-bold': dbPrivileges.get(activeDb!)?.has(priv) }"
                  @click="emit('toggleDbPrivilege', activeDb!, priv)"
                >
                  <div class="flex flex-col">
                    <span class="text-[11px] font-mono group-hover:text-df-warning transition-colors" :class="{ 'text-df-warning': dbPrivileges.get(activeDb!)?.has(priv) }">{{ priv }}</span>
                    <span class="text-[9px] text-muted-foreground/50 font-normal">{{ PRIV_LABELS[priv] || '操作权限' }}</span>
                  </div>
                  <div class="h-4 w-4 rounded-md border border-border/60 flex items-center justify-center transition-[background-color,border-color,box-shadow,scale,rotate] bg-background shadow-inner" :class="{ 'bg-df-warning border-df-warning text-white rotate-6 scale-110 shadow-lg': dbPrivileges.get(activeDb!)?.has(priv) }">
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
  </div>
</template>

<style scoped>
.blink {
  animation: blinker 1.5s cubic-bezier(0.5, 0, 1, 0.5) infinite alternate;
}
@keyframes blinker {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0.4; transform: scale(0.8); }
}
</style>
