<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ShieldAlert } from 'lucide-vue-next'
import {
  clearWriteScopesBySession,
  createWriteScope,
  detectWriteScopeConflicts,
  loadWorkspaceIsolationPolicy,
  loadWriteScopes,
  pruneExpiredWriteScopes,
  saveWorkspaceIsolationPolicy,
  saveWriteScopes,
  updateTouchedPaths,
  type WorkspaceIsolationPolicyMode,
  type WorkspaceWriteScope,
} from '@/ai-gui/workspaceIsolation'

const props = defineProps<{
  files?: string[]
  sessionId?: string
}>()

const scopes = ref<WorkspaceWriteScope[]>(pruneExpiredWriteScopes(loadWriteScopes()))
const policy = ref<WorkspaceIsolationPolicyMode>(loadWorkspaceIsolationPolicy())
const conflicts = computed(() => detectWriteScopeConflicts(scopes.value))
const expiredCount = computed(() => loadWriteScopes().length - pruneExpiredWriteScopes(loadWriteScopes()).length)

function addCurrentPatchScope(): void {
  const paths = props.files ?? []
  if (paths.length === 0) return
  const scope = updateTouchedPaths(
    createWriteScope(`patch-${Date.now()}`, 'Current Patch Review', paths),
    paths,
  )
  scopes.value = [scope, ...scopes.value].slice(0, 10)
}

function clearScopes(): void {
  scopes.value = []
}

function pruneScopes(): void {
  scopes.value = pruneExpiredWriteScopes(loadWriteScopes())
}

function clearCurrentSessionScopes(): void {
  if (!props.sessionId) return
  scopes.value = clearWriteScopesBySession(scopes.value, props.sessionId)
}

watch(scopes, value => saveWriteScopes(value), { deep: true })
watch(policy, value => saveWorkspaceIsolationPolicy(value))
</script>

<template>
  <section class="mx-auto max-w-4xl px-5">
    <div class="rounded-xl border border-border/40 bg-card/30 p-3 text-xs">
      <div class="flex flex-wrap items-center gap-2">
        <ShieldAlert class="h-4 w-4 text-primary/75" />
        <div class="min-w-0 flex-1">
          <div class="text-xs font-semibold text-foreground/85">Workspace Isolation Preview</div>
          <div class="text-[11px] text-muted-foreground">记录当前 patch 触碰文件，提前发现并行任务覆盖风险。</div>
        </div>
        <button class="rounded-md border border-border/40 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 disabled:opacity-50" :disabled="!files?.length" @click="addCurrentPatchScope">
          记录当前 Patch
        </button>
        <button class="rounded-md border border-border/40 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 disabled:opacity-50" :disabled="scopes.length === 0" @click="clearScopes">
          清空
        </button>
        <button class="rounded-md border border-border/40 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 disabled:opacity-50" :disabled="expiredCount === 0" @click="pruneScopes">
          清理过期 {{ expiredCount || '' }}
        </button>
        <button class="rounded-md border border-border/40 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 disabled:opacity-50" :disabled="!sessionId || scopes.length === 0" @click="clearCurrentSessionScopes">
          清理本会话
        </button>
        <select v-model="policy" class="rounded-md border border-border/40 bg-background px-2 py-1 text-[11px] text-muted-foreground">
          <option value="warn">冲突时审批</option>
          <option value="deny">冲突时拒绝</option>
          <option value="smart">智能分级</option>
        </select>
      </div>

      <div v-if="conflicts.length" class="mt-3 space-y-1 rounded-lg border border-amber-400/25 bg-amber-500/10 p-2 text-[11px] text-amber-200">
        <div class="font-medium">检测到潜在覆盖冲突</div>
        <div v-for="conflict in conflicts.slice(0, 5)" :key="conflict.path" class="font-mono">
          {{ conflict.path }} · {{ conflict.owners.join(' / ') }}
        </div>
      </div>

      <div v-if="scopes.length" class="mt-3 space-y-1">
        <div v-for="scope in scopes.slice(0, 5)" :key="scope.ownerId" class="rounded-lg border border-border/20 bg-background/35 px-2 py-1.5">
          <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span class="font-medium text-foreground/75">{{ scope.ownerLabel }}</span>
            <span class="ml-auto">{{ scope.touchedPaths.length }} files</span>
          </div>
          <div class="mt-1 truncate font-mono text-[10px] text-muted-foreground/75">
            {{ scope.touchedPaths.slice(0, 4).join(' · ') }}
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
