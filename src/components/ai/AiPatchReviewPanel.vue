<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, CheckCircle2, GitCompare, Loader2, PlayCircle, RotateCcw, ShieldAlert, XCircle } from 'lucide-vue-next'
import { gitGetDiffWorking } from '@/api/git'
import { aiReadContextFile } from '@/api/ai'
import { analyzeCodeText, type CodeIntelligenceSummary } from '@/ai-gui/codeIntelligence'
import { analyzePatchReview, type PatchReviewReport, type PatchReviewSeverity } from '@/ai-gui/patchReview'
import { latestVerificationJob, parseVerificationReport } from '@/ai-gui/verificationReport'
import { buildVerificationPresets } from '@/ai-gui/verificationPresets'
import { loadVerificationArchive, saveVerificationArchive, upsertVerificationArchiveRecord, type VerificationArchiveRecord } from '@/ai-gui/verificationArchive'
import type { BackgroundJob } from '@/stores/background-job'

const props = defineProps<{
  workDir?: string
  jobs?: BackgroundJob[]
  verifying?: boolean
}>()

const emit = defineEmits<{
  (e: 'verify', commands: string[]): void
}>()

const loading = ref(false)
const error = ref<string | null>(null)
const report = ref<PatchReviewReport | null>(null)
const codeInsights = ref<Array<{ path: string; summary: CodeIntelligenceSummary }>>([])
const expandedRisks = ref(false)
const expandedFiles = ref(false)
const loadingCodeIntel = ref(false)
const verificationArchive = ref<VerificationArchiveRecord[]>(loadVerificationArchive())

const latestJob = computed(() => latestVerificationJob(props.jobs ?? []))
const verificationReport = computed(() => parseVerificationReport(latestJob.value?.result ?? latestJob.value?.error))
const topRisks = computed(() => report.value?.risks.slice(0, expandedRisks.value ? 16 : 4) ?? [])
const visibleFiles = computed(() => report.value?.files.slice(0, expandedFiles.value ? 20 : 5) ?? [])
const lastCommands = computed(() => verificationReport.value?.commands.map(item => item.command).filter(Boolean) ?? [])
const presets = computed(() => buildVerificationPresets(report.value))
const topCodeInsights = computed(() => codeInsights.value.slice(0, 5))
const recentArchive = computed(() => verificationArchive.value.slice(0, 5))

watch(latestJob, (job) => {
  if (!job || job.kind !== 'verification' || (job.status !== 'succeeded' && job.status !== 'failed')) return
  verificationArchive.value = upsertVerificationArchiveRecord(verificationArchive.value, {
    id: job.id,
    sessionId: job.sessionId,
    status: job.status,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    report: parseVerificationReport(job.result ?? job.error),
    raw: job.result ?? job.error,
  })
  saveVerificationArchive(verificationArchive.value)
}, { immediate: true })

function severityClass(severity: PatchReviewSeverity): string {
  switch (severity) {
    case 'high': return 'text-red-400 border-red-400/25 bg-red-500/10'
    case 'medium': return 'text-amber-400 border-amber-400/25 bg-amber-500/10'
    default: return 'text-emerald-400 border-emerald-400/25 bg-emerald-500/10'
  }
}

function statusIcon(status?: string) {
  if (status === 'succeeded') return CheckCircle2
  if (status === 'failed') return XCircle
  return Loader2
}

async function refreshReview(): Promise<void> {
  if (!props.workDir) {
    error.value = '缺少工作目录，无法读取 Git diff。'
    return
  }
  loading.value = true
  error.value = null
  try {
    const diff = await gitGetDiffWorking(props.workDir)
    report.value = analyzePatchReview(diff)
    codeInsights.value = []
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function refreshCodeIntel(): Promise<void> {
  if (!props.workDir || !report.value) return
  loadingCodeIntel.value = true
  try {
    const readableFiles = report.value.files
      .filter(file => /\.(ts|tsx|js|jsx|vue|rs)$/i.test(file.path))
      .slice(0, 5)
    const next = []
    for (const file of readableFiles) {
      const content = await aiReadContextFile(props.workDir, file.path, 240)
      next.push({ path: file.path, summary: analyzeCodeText(file.path, content) })
    }
    codeInsights.value = next
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingCodeIntel.value = false
  }
}

function runVerification(commands?: string[]): void {
  const nextCommands = commands ?? report.value?.suggestedCommands ?? []
  if (nextCommands.length > 0) emit('verify', nextCommands)
}
</script>

<template>
  <section class="mx-auto max-w-4xl px-5">
    <div class="rounded-xl border border-border/40 bg-card/35 p-3">
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <GitCompare class="h-4 w-4 shrink-0 text-primary/75" />
          <div class="min-w-0">
            <div class="text-xs font-semibold text-foreground/85">Patch Review / Verification Center</div>
            <div class="text-[11px] text-muted-foreground">审查当前 diff，生成风险、影响面和验证证据。</div>
          </div>
        </div>
        <button class="inline-flex items-center gap-1 rounded-md border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:cursor-wait disabled:opacity-50" :disabled="loading || !workDir" @click="refreshReview">
          <Loader2 v-if="loading" class="h-3 w-3 animate-spin" />
          <ShieldAlert v-else class="h-3 w-3" />
          审查 diff
        </button>
        <button class="inline-flex items-center gap-1 rounded-md border border-primary/25 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!report?.suggestedCommands.length || verifying" @click="runVerification()">
          <Loader2 v-if="verifying" class="h-3 w-3 animate-spin" />
          <PlayCircle v-else class="h-3 w-3" />
          跑建议验证
        </button>
        <button class="inline-flex items-center gap-1 rounded-md border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50" :disabled="lastCommands.length === 0 || verifying" @click="runVerification(lastCommands)">
          <RotateCcw class="h-3 w-3" />
          重跑上次
        </button>
        <button class="inline-flex items-center gap-1 rounded-md border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:cursor-wait disabled:opacity-50" :disabled="!report || loadingCodeIntel" @click="refreshCodeIntel">
          <Loader2 v-if="loadingCodeIntel" class="h-3 w-3 animate-spin" />
          <ShieldAlert v-else class="h-3 w-3" />
          代码智能
        </button>
      </div>

      <p v-if="error" class="mt-2 rounded-lg border border-destructive/25 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">{{ error }}</p>

      <div v-if="report" class="mt-3 space-y-3">
        <div class="rounded-lg border border-border/25 bg-background/45 px-3 py-2 text-xs text-muted-foreground">
          <span class="mr-2 rounded border px-2 py-0.5" :class="severityClass(report.riskLevel)">风险：{{ report.riskLevel }}</span>
          {{ report.summary }}
        </div>

        <div v-if="report.impactGroups.length > 0" class="flex flex-wrap gap-1.5">
          <span v-for="group in report.impactGroups" :key="group.key" class="rounded border px-2 py-0.5 text-[10px]" :class="severityClass(group.riskLevel)">
            {{ group.label }} × {{ group.files.length }}
          </span>
        </div>

        <div v-if="topRisks.length > 0" class="space-y-1.5">
          <div v-for="risk in topRisks" :key="`${risk.title}:${risk.path ?? ''}`" class="rounded-lg border border-border/25 bg-background/35 px-2.5 py-2 text-xs">
            <div class="flex items-center gap-2">
              <AlertTriangle class="h-3.5 w-3.5" :class="severityClass(risk.severity)" />
              <span class="font-medium text-foreground/80">{{ risk.title }}</span>
              <span v-if="risk.path" class="ml-auto max-w-[45%] truncate font-mono text-[10px] text-muted-foreground" :title="risk.path">{{ risk.path }}</span>
            </div>
            <div class="mt-1 text-[11px] text-muted-foreground">{{ risk.detail }}</div>
          </div>
          <button v-if="report.risks.length > 4" class="text-[11px] text-muted-foreground hover:text-foreground" @click="expandedRisks = !expandedRisks">
            {{ expandedRisks ? '收起风险' : `显示全部 ${report.risks.length} 个风险` }}
          </button>
        </div>
        <div v-else class="inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 class="h-3.5 w-3.5" /> 未发现明显高风险 diff。</div>

        <div v-if="visibleFiles.length > 0" class="space-y-1">
          <div v-for="file in visibleFiles" :key="file.path" class="flex items-center gap-2 rounded border border-border/15 bg-background/25 px-2 py-1 text-[11px]">
            <span class="rounded bg-muted px-1.5 py-0.5 uppercase text-muted-foreground">{{ file.status }}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-muted-foreground" :title="file.path">{{ file.path }}</span>
            <span class="text-emerald-400">+{{ file.insertions }}</span>
            <span class="text-red-400">-{{ file.deletions }}</span>
          </div>
          <button v-if="report.files.length > 5" class="text-[11px] text-muted-foreground hover:text-foreground" @click="expandedFiles = !expandedFiles">
            {{ expandedFiles ? '收起文件' : `显示更多文件 ${report.files.length}` }}
          </button>
        </div>

        <div v-if="report.suggestedCommands.length > 0" class="flex flex-wrap gap-1.5">
          <span v-for="command in report.suggestedCommands" :key="command" class="rounded bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{{ command }}</span>
        </div>

        <div class="space-y-1.5">
          <p class="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/50">验证预设</p>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="preset in presets" :key="preset.id" class="rounded border border-border/30 px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-50" :disabled="verifying" :title="preset.description" @click="runVerification(preset.commands)">
              {{ preset.label }}
            </button>
          </div>
        </div>

        <div v-if="topCodeInsights.length > 0" class="space-y-1.5">
          <p class="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/50">代码智能摘要</p>
          <div v-for="item in topCodeInsights" :key="item.path" class="rounded-lg border border-border/20 bg-background/35 px-2.5 py-2 text-xs">
            <div class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/75" :title="item.path">{{ item.path }}</span>
              <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{{ item.summary.language }}</span>
            </div>
            <div class="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
              <span>symbols {{ item.summary.symbols.length }}</span>
              <span>imports {{ item.summary.imports.length }}</span>
              <span>exports {{ item.summary.exports.length }}</span>
              <span :class="item.summary.diagnostics.length > 0 ? 'text-amber-400' : 'text-emerald-400'">diagnostics {{ item.summary.diagnostics.length }}</span>
            </div>
            <div v-if="item.summary.symbols.length > 0" class="mt-1 truncate text-[10px] text-muted-foreground">
              {{ item.summary.symbols.slice(0, 6).map(symbol => `${symbol.kind}:${symbol.name}`).join(' · ') }}
            </div>
            <div v-if="item.summary.diagnostics.length > 0" class="mt-1 text-[10px] text-amber-400">
              {{ item.summary.diagnostics.slice(0, 2).join('；') }}
            </div>
          </div>
        </div>
      </div>

      <div v-if="latestJob" class="mt-3 rounded-lg border border-border/25 bg-background/45 px-3 py-2 text-xs">
        <div class="flex items-center gap-2">
          <component :is="statusIcon(latestJob.status)" class="h-3.5 w-3.5" :class="latestJob.status === 'running' || latestJob.status === 'queued' ? 'animate-spin text-amber-400' : latestJob.status === 'succeeded' ? 'text-emerald-400' : 'text-red-400'" />
          <span class="font-medium text-foreground/80">最近验证</span>
          <span class="ml-auto text-[10px] text-muted-foreground">{{ latestJob.progress }}%</span>
        </div>
        <p v-if="verificationReport" class="mt-1 text-[11px] text-muted-foreground">{{ verificationReport.summary }}</p>
        <div v-if="verificationReport?.commands.length" class="mt-2 space-y-1">
          <div v-for="item in verificationReport.commands.slice(0, 4)" :key="item.command" class="rounded bg-muted/30 px-2 py-1 font-mono text-[10px] text-muted-foreground">
            <span :class="item.status === 'ok' ? 'text-emerald-400' : item.status === 'failed' ? 'text-red-400' : 'text-muted-foreground'">{{ item.status }}</span>
            <span class="ml-1">{{ item.command }}</span>
            <span v-if="item.durationMs" class="ml-1 opacity-70">{{ item.durationMs }}ms</span>
          </div>
        </div>
      </div>

      <div v-if="recentArchive.length" class="mt-3 rounded-lg border border-border/25 bg-background/35 px-3 py-2 text-xs">
        <div class="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/50">Verification History</div>
        <div class="space-y-1">
          <div v-for="item in recentArchive" :key="item.id" class="flex items-center gap-2 rounded bg-muted/20 px-2 py-1 text-[11px] text-muted-foreground">
            <span :class="item.status === 'succeeded' ? 'text-emerald-400' : 'text-red-400'">{{ item.status }}</span>
            <span class="min-w-0 flex-1 truncate">{{ item.report?.summary ?? item.id }}</span>
            <span v-if="item.report?.durationMs" class="font-mono text-[10px] opacity-70">{{ item.report.durationMs }}ms</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
