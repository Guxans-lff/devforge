<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Plus, RotateCcw, Trash2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { WorkspaceConfig, WorkspaceSkillConfig, WorkspaceSkillPermission } from '@/types/ai'
import {
  normalizePermissions,
  normalizeWorkspaceSkill,
  normalizeWorkspaceSkills,
  summarizeWorkspaceSkills,
  validateWorkspaceSkills,
} from '@/ai-gui/workspaceSkills'

const props = defineProps<{
  config?: WorkspaceConfig | null
  workDir?: string
  saving?: boolean
}>()

const emit = defineEmits<{
  save: [skills: WorkspaceSkillConfig[]]
}>()

interface EditableSkill {
  id: string
  name: string
  description: string
  path: string
  permissions: WorkspaceSkillPermission[]
  enabled: boolean
}

const rows = reactive<EditableSkill[]>([])
const dirty = ref(false)
const permissionOptions: Array<{ value: WorkspaceSkillPermission; label: string; risk: 'low' | 'medium' | 'high' }> = [
  { value: 'read', label: '读取', risk: 'low' },
  { value: 'write', label: '写入', risk: 'medium' },
  { value: 'execute', label: '执行命令', risk: 'high' },
  { value: 'network', label: '网络访问', risk: 'high' },
  { value: 'mcp', label: 'MCP 工具', risk: 'high' },
]

const canEdit = computed(() => !!props.workDir && !props.saving)
const normalized = computed(() => normalizeWorkspaceSkills(rows))
const summary = computed(() => summarizeWorkspaceSkills(normalized.value))
const riskSummary = computed(() => validateWorkspaceSkills(normalized.value))

function syncRows(skills: WorkspaceConfig['skills']): void {
  rows.splice(0, rows.length, ...normalizeWorkspaceSkills(skills).map(skill => ({
    id: skill.id,
    name: skill.name,
    description: skill.description ?? '',
    path: skill.path ?? '',
    permissions: normalizePermissions(skill.permissions),
    enabled: skill.enabled !== false,
  })))
  dirty.value = false
}

function markDirty(): void {
  dirty.value = true
}

function addSkill(): void {
  rows.push({
    id: `skill-${Date.now()}`,
    name: '',
    description: '',
    path: '',
    permissions: [],
    enabled: true,
  })
  markDirty()
}

function removeSkill(index: number): void {
  rows.splice(index, 1)
  markDirty()
}

function resetRows(): void {
  syncRows(props.config?.skills)
}

function togglePermission(skill: EditableSkill, permission: WorkspaceSkillPermission): void {
  const current = normalizePermissions(skill.permissions)
  skill.permissions = current.includes(permission)
    ? current.filter(item => item !== permission)
    : [...current, permission]
  markDirty()
}

function save(): void {
  const skills = rows.map((row, index) => normalizeWorkspaceSkill(row, index))
    .filter(skill => skill.name.trim() || skill.path?.trim())
  emit('save', skills)
  dirty.value = false
}

watch(
  () => props.config?.skills,
  skills => syncRows(skills),
  { immediate: true, deep: true },
)
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span class="rounded bg-muted px-2 py-1">共 {{ summary.total }} 个</span>
        <span class="rounded bg-emerald-500/10 px-2 py-1 text-emerald-600 dark:text-emerald-400">启用 {{ summary.enabled }} 个</span>
        <span v-if="summary.disabled" class="rounded bg-muted px-2 py-1">禁用 {{ summary.disabled }} 个</span>
        <span v-if="summary.missingPath" class="rounded bg-amber-500/10 px-2 py-1 text-amber-600 dark:text-amber-400">
          {{ summary.missingPath }} 个缺少路径
        </span>
        <span v-if="summary.risky" class="rounded bg-rose-500/10 px-2 py-1 text-rose-600 dark:text-rose-400">
          {{ summary.risky }} 个高风险权限
        </span>
      </div>
      <Button size="sm" variant="outline" class="h-8" :disabled="!canEdit" @click="addSkill">
        <Plus class="mr-1 h-3.5 w-3.5" /> 添加 Skill
      </Button>
    </div>

    <div
      v-if="riskSummary.issues.length > 0"
      class="rounded-lg border p-3 text-xs"
      :class="riskSummary.highestLevel === 'danger'
        ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'"
    >
      <p class="font-semibold">Skill Manifest 风险摘要</p>
      <ul class="mt-2 space-y-1">
        <li v-for="issue in riskSummary.issues.slice(0, 5)" :key="`${issue.skillId}-${issue.code}-${issue.message}`">
          {{ issue.skillName }}：{{ issue.message }}
        </li>
      </ul>
    </div>

    <div v-if="!workDir" class="rounded-lg border border-dashed border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
      未选择工作目录，无法写入 .devforge/config.json。
    </div>

    <div v-if="rows.length === 0" class="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4 text-xs text-muted-foreground">
      当前项目还没有配置 Skill。添加后可用于记录项目推荐能力、Skill 文件路径和启用状态。
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="(skill, index) in rows"
        :key="skill.id || index"
        class="rounded-xl border border-border/50 bg-background/60 p-3"
      >
        <div class="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <div class="space-y-1.5">
            <Label class="text-[11px]">名称</Label>
            <Input v-model="skill.name" class="h-8 text-xs" :disabled="!canEdit" placeholder="例如：frontend-design" @input="markDirty" />
          </div>
          <div class="space-y-1.5">
            <Label class="text-[11px]">Skill 文件路径</Label>
            <Input v-model="skill.path" class="h-8 text-xs" :disabled="!canEdit" placeholder=".agents/skills/name/SKILL.md" @input="markDirty" />
          </div>
          <div class="flex items-end gap-2">
            <div class="flex h-8 items-center gap-2 rounded-md border border-border/50 px-2 text-xs">
              <Switch v-model:checked="skill.enabled" :disabled="!canEdit" @update:checked="markDirty" />
              <span>{{ skill.enabled ? '启用' : '禁用' }}</span>
            </div>
            <button class="h-8 rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50" :disabled="!canEdit" @click="removeSkill(index)">
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
        </div>
        <div class="mt-3 space-y-1.5">
          <Label class="text-[11px]">说明</Label>
          <Input v-model="skill.description" class="h-8 text-xs" :disabled="!canEdit" placeholder="说明这个 Skill 适合什么时候使用" @input="markDirty" />
        </div>
        <div class="mt-3 space-y-1.5">
          <Label class="text-[11px]">权限声明</Label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="permission in permissionOptions"
              :key="permission.value"
              type="button"
              class="rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-50"
              :class="skill.permissions.includes(permission.value)
                ? permission.risk === 'high'
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300'
                  : permission.risk === 'medium'
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                : 'border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40'"
              :disabled="!canEdit"
              @click="togglePermission(skill, permission.value)"
            >
              {{ permission.label }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="flex items-center justify-between gap-3">
      <p class="text-[11px] text-muted-foreground">
        保存后写入当前 workspace 的 `.devforge/config.json`，空列表会移除项目级 Skill 覆盖。
      </p>
      <div class="flex gap-2">
        <Button size="sm" variant="outline" class="h-8" :disabled="!dirty || saving" @click="resetRows">
          <RotateCcw class="mr-1 h-3.5 w-3.5" /> 还原
        </Button>
        <Button size="sm" class="h-8 min-w-[96px]" :disabled="!canEdit || saving" @click="save">
          {{ saving ? '保存中...' : '保存 Skill' }}
        </Button>
      </div>
    </div>
  </div>
</template>
