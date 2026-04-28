import type { PatchReviewReport } from '@/ai-gui/patchReview'

export interface VerificationPreset {
  id: string
  label: string
  description: string
  commands: string[]
}

export const BASE_VERIFICATION_PRESETS: VerificationPreset[] = [
  {
    id: 'frontend-light',
    label: '前端轻量验证',
    description: '运行单测和类型检查，适合 TS/Vue/AI GUI 改动。',
    commands: ['pnpm vitest run', 'pnpm test:typecheck'],
  },
  {
    id: 'backend-rust',
    label: '后端 Rust 验证',
    description: '检查 Tauri/Rust 后端编译。',
    commands: ['pnpm check:rust'],
  },
  {
    id: 'ai-quality',
    label: 'AI 链路验证',
    description: '验证 AI GUI、后台任务和代码智能相关测试。',
    commands: [
      'pnpm vitest run src/ai-gui/__tests__/patchReview.test.ts src/ai-gui/__tests__/verificationReport.test.ts src/ai-gui/__tests__/codeIntelligence.test.ts src/stores/__tests__/background-job.test.ts src/composables/__tests__/useJobWorker.test.ts',
      'pnpm test:typecheck',
    ],
  },
]

export function buildVerificationPresets(report?: PatchReviewReport | null): VerificationPreset[] {
  if (!report) return BASE_VERIFICATION_PRESETS
  const commands = report.suggestedCommands
  if (commands.length === 0) return BASE_VERIFICATION_PRESETS
  return [
    {
      id: 'patch-suggested',
      label: '当前 diff 建议验证',
      description: '根据 Patch Review 影响面自动生成。',
      commands,
    },
    ...BASE_VERIFICATION_PRESETS,
  ]
}
