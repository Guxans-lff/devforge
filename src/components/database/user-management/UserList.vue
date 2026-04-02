<script setup lang="ts">
/**
 * 用户列表侧边栏组件
 * 展示可搜索的 MySQL 用户列表，支持选中、删除操作
 */
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Users, Plus, Trash2, Loader2, AlertTriangle, RefreshCw,
  Search, Lock,
} from 'lucide-vue-next'
import type { MysqlUser } from '@/types/database'

defineProps<{
  users: MysqlUser[]
  filteredUsers: MysqlUser[]
  selectedUser: MysqlUser | null
  isLoading: boolean
  hasGrantOption: boolean
  checkingGrant: boolean
  searchQuery: string
}>()

const emit = defineEmits<{
  'update:searchQuery': [value: string]
  selectUser: [user: MysqlUser]
  deleteUser: [user: MysqlUser]
  createUser: []
  refresh: []
}>()
</script>

<template>
  <div class="flex w-[310px] flex-col border-r border-border/5 bg-muted/5">
    <!-- 顶部工具栏 -->
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
    </div>

    <!-- 操作栏 + 搜索 -->
    <div class="px-4 py-3 border-b border-border/5 space-y-2">
      <div class="flex items-center gap-2">
        <!-- 权限警告 -->
        <div v-if="!hasGrantOption && !checkingGrant" class="flex items-center gap-1.5 rounded-lg bg-df-warning/5 px-2.5 py-1.5 text-[10px] font-bold text-df-warning border border-df-warning/10">
          <AlertTriangle class="h-3.5 w-3.5" />
          <span>权限受限</span>
        </div>
        <div class="flex-1" />
        <Button
          variant="default" size="sm"
          class="h-8 px-3 gap-1.5 rounded-lg shadow-lg shadow-primary/10 font-bold text-xs"
          :disabled="!hasGrantOption || isLoading"
          @click="emit('createUser')"
        >
          <Plus class="h-3.5 w-3.5" />
          新建
        </Button>
        <Button
          variant="ghost" size="icon"
          class="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
          :disabled="isLoading"
          @click="emit('refresh')"
        >
          <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isLoading }" />
        </Button>
      </div>
      <div class="relative group">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/30 group-focus-within:text-primary transition-colors" />
        <Input
          :model-value="searchQuery"
          class="h-9 pl-9 text-xs bg-muted/20 border-border/10 rounded-lg"
          placeholder="搜索用户或主机..."
          @update:model-value="emit('update:searchQuery', $event as string)"
        />
      </div>
    </div>

    <!-- 用户列表 -->
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
          class="user-list-item group relative flex items-center gap-3 px-4 h-[72px] cursor-pointer transition-[background-color,color,box-shadow] duration-200 border-b border-border/10 shrink-0 select-none rounded-lg mx-1"
          :class="[
            selectedUser?.user === user.user && selectedUser?.host === user.host
              ? 'bg-primary/[0.06] text-primary shadow-sm shadow-primary/5'
              : 'hover:bg-accent/10 text-muted-foreground hover:text-foreground'
          ]"
          @click="emit('selectUser', user)"
        >
          <!-- 用户头像 -->
          <div
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-background font-bold uppercase transition-colors shadow-sm group-hover:bg-accent/10"
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
            <div class="flex items-center h-3.5 opacity-60">
              <span class="truncate text-[10px] font-medium leading-none">{{ user.host }}</span>
            </div>
            <div class="flex items-center gap-1.5 mt-1.5 flex-nowrap overflow-hidden h-5">
              <span v-if="user.accountLocked === 'Y'" class="shrink-0 flex items-center gap-1 text-[10px] font-bold text-destructive/80 bg-destructive/5 px-1.5 py-0.5 rounded-lg border border-destructive/10 uppercase whitespace-nowrap">
                <Lock class="h-2.5 w-2.5" /> 锁定
              </span>
              <span v-else-if="user.passwordExpired === 'Y'" class="shrink-0 flex items-center gap-1 text-[10px] font-bold text-df-warning bg-df-warning/5 px-1.5 py-0.5 rounded-lg border border-df-warning/10 uppercase whitespace-nowrap">
                <AlertTriangle class="h-2.5 w-2.5" /> 过期
              </span>
              <span v-else class="shrink-0 flex items-center gap-1 text-[10px] font-bold text-df-success/70 bg-df-success/5 px-1.5 py-0.5 rounded-lg border border-df-success/10 whitespace-nowrap">
                <div class="h-1.5 w-1.5 rounded-full bg-df-success/50 blink" /> 活跃
              </span>
              <span v-if="user.user.startsWith('mysql.')" class="shrink-0 text-[9px] font-black tracking-widest text-primary/30 bg-primary/5 px-1.5 py-0.5 rounded-lg border border-primary/10 uppercase whitespace-nowrap">
                System
              </span>
            </div>
          </div>

          <!-- 删除按钮 -->
          <div class="shrink-0 transition-opacity duration-300" :class="selectedUser?.user === user.user ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'">
            <Button
              v-if="hasGrantOption"
              variant="ghost" size="icon"
              class="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl"
              @click.stop="emit('deleteUser', user)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </Button>
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
.user-list-item {
  box-shadow: none;
  transition: background-color 0.2s ease, box-shadow 0.2s ease;
}
.user-list-item:hover {
  box-shadow: 0 1px 4px 0 rgba(0, 0, 0, 0.04);
}
</style>
