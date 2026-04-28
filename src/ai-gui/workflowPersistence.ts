import { restoreWorkflowRuntime, type WorkflowRuntimeState } from '@/ai-gui/workflowRuntime'

const STORAGE_KEY = 'devforge.ai.workflow.runtime.v1'

export function loadWorkflowRuntime(storage: Storage | undefined = globalThis.localStorage, now = Date.now()): WorkflowRuntimeState | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as WorkflowRuntimeState
    if (!parsed?.runId || !Array.isArray(parsed.steps)) return null
    return restoreWorkflowRuntime(parsed, now)
  } catch {
    return null
  }
}

export function saveWorkflowRuntime(state: WorkflowRuntimeState | null, storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) return
  if (!state) {
    storage.removeItem(STORAGE_KEY)
    return
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(state))
}
