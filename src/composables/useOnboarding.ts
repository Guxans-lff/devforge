import { ref, computed } from 'vue'

const STORAGE_KEY = 'devforge-onboarding-state'
const CURRENT_VERSION = 1

interface OnboardingState {
  completedSteps: string[]
  dismissed: boolean
  version: number
}

/** 从 localStorage 加载 */
function loadState(): OnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as OnboardingState
      if (parsed.version === CURRENT_VERSION) return parsed
    }
  } catch {
    // 忽略
  }
  return { completedSteps: [], dismissed: false, version: CURRENT_VERSION }
}

/** 保存到 localStorage */
function saveState(state: OnboardingState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 忽略
  }
}

/** 全局单例状态 */
const state = ref<OnboardingState>(loadState())

/**
 * Onboarding 引导状态管理
 * 跟踪用户已完成的引导步骤，支持一键关闭所有提示
 */
export function useOnboarding() {
  /** 是否已全局关闭所有提示 */
  const dismissed = computed(() => state.value.dismissed)

  /** 检查某步骤是否已完成 */
  function isStepCompleted(stepId: string): boolean {
    return state.value.dismissed || state.value.completedSteps.includes(stepId)
  }

  /** 标记某步骤为已完成 */
  function completeStep(stepId: string) {
    if (state.value.completedSteps.includes(stepId)) return
    const updated: OnboardingState = {
      ...state.value,
      completedSteps: [...state.value.completedSteps, stepId],
    }
    state.value = updated
    saveState(updated)
  }

  /** 关闭所有提示 */
  function dismissAll() {
    const updated: OnboardingState = {
      ...state.value,
      dismissed: true,
    }
    state.value = updated
    saveState(updated)
  }

  /** 重置所有状态（调试用） */
  function resetAll() {
    const fresh: OnboardingState = { completedSteps: [], dismissed: false, version: CURRENT_VERSION }
    state.value = fresh
    saveState(fresh)
  }

  return {
    dismissed,
    isStepCompleted,
    completeStep,
    dismissAll,
    resetAll,
  }
}
