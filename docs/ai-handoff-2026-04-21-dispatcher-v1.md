# AI Handoff 2026-04-21: Dispatcher V1 Incomplete Work

## Background

This handoff records the current status of the concurrent spawned-task dispatcher V1 work in `D:\Project\DevForge\devforge`.

The original target was:

- extend `[SPAWN:...]` into a real concurrent scheduler protocol
- support `headless` and `tab` execution modes
- enforce dependency-aware auto scheduling with workspace-level concurrency config
- expose dependency/source grouping in the dispatcher panel
- keep existing manual `run / retry / cancel / synthesize` flows working

## What Is Already Implemented

### Protocol and task model

The following are already in place:

- `SpawnedTask` extended with V1 scheduler metadata in [src/composables/ai/chatSideEffects.ts](/D:/Project/DevForge/devforge/src/composables/ai/chatSideEffects.ts)
  - `executionMode`
  - `priority`
  - `summaryMode`
  - `dispatchStatus`
  - `autoRetryBudget`
  - `attemptCount`
  - `resultSummary`
  - `resultSessionId`
  - `startedByDispatcher`
- SPAWN parser now supports:
  - legacy `[SPAWN:task]`
  - alias `#alias`
  - dependencies `depends=a,b`
  - `mode=headless|tab`
  - `priority=high|normal|low`
  - `summary=brief|normal`
- workspace config fields added in [src/types/ai.ts](/D:/Project/DevForge/devforge/src/types/ai.ts)
  - `dispatcherMaxParallel`
  - `dispatcherAutoRetryCount`
  - `dispatcherDefaultMode`
- dispatcher prompt guidance upgraded in [src/composables/useAiChatViewState.ts](/D:/Project/DevForge/devforge/src/composables/useAiChatViewState.ts)

### Scheduler core

A standalone scheduler service now exists in [src/composables/ai/chatTaskDispatcher.ts](/D:/Project/DevForge/devforge/src/composables/ai/chatTaskDispatcher.ts).

Implemented behavior:

- reconcile task `ready / queued / blocked / running / done / error / cancelled`
- priority-aware ready-task selection
- `maxParallel` window enforcement
- dependency release after predecessor completion
- automatic retry once for retryable failures
- pluggable executors for `headless` and `tab`
- runtime events for blocked/start/retry/fail/complete feedback

### UI groundwork

The dispatcher panel has been extended further in [src/components/ai/AiSpawnedTasksPanel.vue](/D:/Project/DevForge/devforge/src/components/ai/AiSpawnedTasksPanel.vue):

- grouped display by source message
- blocked/runnable batch handling
- execution mode badge
- dispatch status badge
- auto retry budget display
- result summary display prefers `resultSummary`
- top stats now include ready/queued/blocked

### Tests already added/passing

Passing targeted suites:

- [src/composables/__tests__/chatTaskDispatcher.test.ts](/D:/Project/DevForge/devforge/src/composables/__tests__/chatTaskDispatcher.test.ts)
- [src/composables/__tests__/chatSideEffects.test.ts](/D:/Project/DevForge/devforge/src/composables/__tests__/chatSideEffects.test.ts)
- [src/composables/__tests__/useAiChatViewState.test.ts](/D:/Project/DevForge/devforge/src/composables/__tests__/useAiChatViewState.test.ts)
- [src/components/ai/__tests__/AiSpawnedTasksPanel.test.ts](/D:/Project/DevForge/devforge/src/components/ai/__tests__/AiSpawnedTasksPanel.test.ts)

Type check status:

- `pnpm exec vue-tsc -b` passed on 2026-04-21

## Not Finished Yet

### 1. Headless executor is still a placeholder

Current implementation in [src/views/AiChatView.vue](/D:/Project/DevForge/devforge/src/views/AiChatView.vue) uses:

- `runHeadlessSpawnedTask(...)`

Current status:

- it does not yet run a real child AI session
- it returns a placeholder summary string
- it does not yet reuse `prepareSendContext` / `streamWithToolLoop` / `finalizeSend`
- it does not yet support real tool loop, provider/model/apiKey wiring, or real abort

This is the biggest missing item.

### 2. `tab` executor is only partially integrated

What works:

- scheduler can create/open tab metadata consistently
- scheduler can wait for tab meta updates through `tabTaskWaiters`
- tab close / done / error / cancelled can release scheduler waiters

What is still missing:

- no automatic `initialMessage` send path exists in the repo yet
- `tab` mode is still not a true auto-running task tab
- current behavior is closer to “dispatcher opens and tracks task tab” than a fully auto-started tab executor

### 3. `AiChatView` integration is incomplete and likely causing test hang

The scheduler bridge has been partially wired in [src/views/AiChatView.vue](/D:/Project/DevForge/devforge/src/views/AiChatView.vue), but this file is not fully stabilized yet.

Known issue:

- `pnpm exec vitest run src/views/__tests__/AiChatView.interaction.test.ts --testTimeout=10000` timed out
- previous full `vitest` run for this file also hung until external timeout

Most likely causes to inspect first:

- unresolved async path around `tabTaskWaiters`
- old interaction tests still assuming default task mode opens tabs immediately
- scheduler background promises not settling under the mocked test environment

### 4. Workspace config UI is not yet exposed

The config type exists, but no dedicated UI has been added yet for:

- `dispatcherMaxParallel`
- `dispatcherAutoRetryCount`
- `dispatcherDefaultMode`

### 5. Synthesis prompt has not been fully upgraded to V1 task-tree wording everywhere

[src/views/AiChatView.vue](/D:/Project/DevForge/devforge/src/views/AiChatView.vue) still uses the older source-group summary builder as the main implementation baseline.

It is usable, but not yet fully aligned with the final V1 wording/format expectations:

- explicit task tree semantics
- source-group plus dependency tree emphasis
- `dispatchStatus` aware wording

### 6. Runtime feedback is currently implemented as chat notices, but not fully curated

Current scheduler runtime events append `notice` messages into the main chat stream.

Still missing:

- more selective feedback policy to avoid noise
- localized strings instead of English inline messages
- dedicated blocked/retry/start/finish wording polished for users

## Recommended Next Steps

### Priority 1

Finish the real headless child-session runner.

Suggested direction:

- extract a reusable runner service from [src/composables/useAiChat.ts](/D:/Project/DevForge/devforge/src/composables/useAiChat.ts)
- reuse:
  - `prepareSendContext`
  - `streamWithToolLoop`
  - `handleSendFailure`
  - `finalizeSend`
  - existing tool approval / tool execution path
- return real:
  - `summary`
  - `sessionId`
  - `error`
  - `startedAt`
  - `finishedAt`

### Priority 2

Fix the `AiChatView` interaction test hang before adding more dispatcher behavior.

Suggested debugging focus:

- isolate which case hangs in [src/views/__tests__/AiChatView.interaction.test.ts](/D:/Project/DevForge/devforge/src/views/__tests__/AiChatView.interaction.test.ts)
- inspect unresolved `Promise` from `tabTaskWaiters`
- ensure click handlers never `await` long-lived scheduler task execution in UI event handlers
- align mocked tasks with new default `executionMode=headless`

### Priority 3

Add workspace-level configuration UI for scheduler settings.

### Priority 4

Polish synthesis prompt and runtime notices after execution semantics are stable.

## Validation Snapshot

Validated successfully:

- `pnpm exec vue-tsc -b`
- `pnpm exec vitest run src/composables/__tests__/chatTaskDispatcher.test.ts src/components/ai/__tests__/AiSpawnedTasksPanel.test.ts src/composables/__tests__/chatSideEffects.test.ts src/composables/__tests__/useAiChatViewState.test.ts`

Validation still failing / incomplete:

- `pnpm exec vitest run src/views/__tests__/AiChatView.interaction.test.ts --testTimeout=10000`
  - hangs until external timeout in current state

## Environment Notes

At the time of writing, there are active local development processes and residual node/vitest processes in the environment. No force-kill action was performed as part of this handoff.
