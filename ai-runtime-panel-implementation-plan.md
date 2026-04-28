# AI 对话区右侧 Run Inspector 实施规划

## 目标

基于现有 AI 对话页重构方向，将运行态组件从主对话流中移出，统一收纳到右侧默认隐藏的 `Run Inspector` 面板中。主对话区只保留用户消息、AI 回答、代码、diff、tool output、文件变更，以及必须由用户决策的风险/审批卡片。

参考设计稿：

```text
file:///D:/Project/DevForge/devforge/ai-runtime-panel-layout-options.html
```

## 核心原则

1. **默认隐藏**：右侧运行面板默认不占主对话宽度，只显示一个窄条入口或顶部按钮。
2. **按需展开**：用户点击 `RUN` 窄条或顶部 `Run Inspector` 按钮后展开右侧面板。
3. **主流降噪**：工具就绪、上下文预算、Patch Review、Workflow Runtime、Workspace Isolation 不再默认插入消息流。
4. **只内联决策项**：只有审批、风险阻断、命令确认、失败重试等需要用户处理的内容进入 timeline。
5. **复用现有逻辑**：不重写 AI stream、tool execution、attachment、session、provider 等业务链路，只调整组件组织与展示位置。

## 涉及文件

### 必改

- `src/components/ai/AiChatShell.vue`
  - 增加右侧 Run Inspector 插槽/区域。
  - 增加默认隐藏、展开/收起状态。
  - 保证消息区和 composer 在面板展开/收起时布局稳定。

- `src/views/AiChatView.vue`
  - 将现有运行态组件从主流区域迁移到 `AiChatShell` 的右侧插槽。
  - 只保留真正需要用户决策的组件在主对话区域。

### 可能调整

- `src/components/ai/AiMessageBubble.vue`
  - 确保主流只渲染消息、结构化输出、必要审批卡。

- 现有运行态组件：
  - `AiDiagnosticsPanel`
  - `AiContextBudgetPanel`
  - `AiPlanGateBar`
  - `AiWorkflowRuntimePanel`
  - `AiPatchReviewPanel`
  - `AiVerificationJobPanel`
  - `AiWorkspaceIsolationPanel`

> 具体组件名以当前 `AiChatView.vue` 实际 import 为准。

## 信息架构

```text
AiChatShell
├─ topbar
│  ├─ 新会话 / 工作目录 / 更多
│  ├─ compact run summary：已完成 · 4.7s · tools · ctx
│  └─ Run Inspector 打开按钮
├─ message area
│  ├─ user messages
│  ├─ assistant normal text
│  ├─ code / diff / tool output / file changes
│  └─ action-required cards only
├─ right inspector，默认隐藏
│  ├─ run completed summary
│  ├─ context budget
│  ├─ tools ready
│  ├─ patch review
│  ├─ workflow runtime
│  └─ workspace isolation
└─ composer
```

## `AiChatShell.vue` 实施方案

### 新增 props

```ts
showRunInspector?: boolean
runInspectorCount?: number
runInspectorSummary?: string
```

建议默认值：

```ts
showRunInspector: false
runInspectorCount: 0
runInspectorSummary: ''
```

### 新增 emits

```ts
(e: 'update:showRunInspector', value: boolean): void
```

### 新增 slot

```vue
<slot name="run-inspector" />
```

### 布局规则

默认：

```text
grid-cols-1
```

展开：

```text
xl:grid-cols-[minmax(0,1fr)_348px]
```

建议在消息区域外层保留：

```vue
<div
  class="grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-200"
  :class="showRunInspector ? 'xl:grid-cols-[minmax(0,1fr)_348px]' : 'grid-cols-1'"
>
```

### 右侧入口

当面板关闭时，在主区域右上显示窄条入口：

```vue
<button
  v-if="!showRunInspector"
  type="button"
  class="absolute right-3 top-4 z-10 ..."
  @click="emit('update:showRunInspector', true)"
>
  <span>{{ runInspectorCount }}</span>
  <span class="vertical-writing">RUN</span>
</button>
```

要求：

- 不遮挡正文关键内容。
- 有轻微呼吸动效。
- 数字显示当前待处理项/运行状态数量。

### 右侧面板

```vue
<aside
  v-if="showRunInspector"
  class="hidden min-w-0 border-l border-border/30 bg-background/95 xl:grid xl:grid-rows-[54px_minmax(0,1fr)]"
>
  <header class="flex items-center justify-between border-b border-border/30 px-3">
    <div>
      <div class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Run Inspector</div>
      <strong class="text-sm">运行与验证</strong>
    </div>
    <button @click="emit('update:showRunInspector', false)">×</button>
  </header>

  <div class="min-h-0 overflow-auto p-3">
    <slot name="run-inspector" />
  </div>
</aside>
```

## `AiChatView.vue` 迁移规则

### 迁入右侧 Run Inspector

以下组件默认放入 `#run-inspector`：

```vue
<template #run-inspector>
  <AiDiagnosticsPanel />
  <AiContextBudgetPanel />
  <AiPatchReviewPanel />
  <AiWorkflowRuntimePanel />
  <AiWorkspaceIsolationPanel />
</template>
```

具体顺序建议：

1. 完成状态 / 运行摘要
2. 上下文预算
3. 工具就绪 / diagnostics
4. Patch Review
5. Workflow Runtime
6. Workspace Isolation

### 保留在主对话区

只保留这些“需要用户看到或处理”的内容：

- AI 正常回答
- 代码块
- diff / 文件变更
- tool output 的摘要或结果
- 错误信息
- 需要审批的命令
- 需要确认的 diff
- 风险阻断
- 失败重试

### 移除主流中的诊断堆叠

不要再在主消息下方直接堆：

- 工具就绪大卡片
- 上下文预算大卡片
- Patch Review 常驻栏
- Workflow Runtime 常驻栏
- Workspace Isolation 常驻栏

这些只应在右侧 Inspector 展示。

## 状态管理

建议在 `AiChatView.vue` 中维护：

```ts
const showRunInspector = ref(false)
```

传入 `AiChatShell`：

```vue
<AiChatShell
  v-model:show-run-inspector="showRunInspector"
  :run-inspector-count="runInspectorCount"
  :run-inspector-summary="runInspectorSummary"
>
```

### `runInspectorCount`

可先用简单计算：

```ts
const runInspectorCount = computed(() => {
  let count = 0
  if (hasPendingApproval.value) count += 1
  if (verificationRunning.value) count += 1
  if (contextUsagePercent.value >= 80) count += 1
  return count
})
```

如果现有状态字段不同，按当前 store/composable 实际字段映射。

### `runInspectorSummary`

建议格式：

```text
已完成 · 4.7s · tools 10 · ctx 37%
```

没有数据时显示：

```text
Run Inspector
```

## 视觉细节

### 顶部 compact summary

- 绿色点表示健康/完成。
- 文案保持短：`已完成 · 4.7s · ctx 37%`。
- 点击可打开右侧 Inspector。

### 右侧 RUN 窄条

- 固定在主内容右上，不进入消息流。
- 默认展示：数字 + `RUN` 竖排。
- 有轻微呼吸边框，不能过度闪烁。

### Inspector 面板

- 宽度建议：`348px`。
- 背景：深色半透明/渐变，保持 DevForge dark-first。
- 卡片层级：少边框、弱背景、强标题。
- 关键状态用绿色/蓝色/琥珀色，不使用大面积彩色块。

### 动效

只保留轻量动效：

- RUN 窄条呼吸边框。
- 展开右滑入场。
- 运行状态点轻脉冲。
- 上下文进度条流光。
- 当前 workflow step 微闪。

避免：

- 大幅弹跳。
- 高频闪烁。
- 多处同时强动画。
- 影响阅读的背景动画。

## 验收标准

### 布局

- 默认状态下右侧 Inspector 不占宽度。
- 点击入口后右侧面板展开，主对话区自适应缩窄。
- 再次关闭后主对话区恢复完整宽度。
- composer 始终固定可见，不被 Inspector 遮挡。
- 长对话滚动到底部正常。

### 功能

- 新会话、历史、工作目录、更多菜单不受影响。
- 发送、停止、继续生成不受影响。
- 附件、拖拽、粘贴、@、/ 不受影响。
- Patch Review、Workflow Runtime、Workspace Isolation 的原按钮和事件仍可用。
- 需要用户审批/确认的内容仍能进入主对话流。

### 视觉

- 主对话区不再出现大面积运行态卡片堆叠。
- 普通 AI 文本保持无大框文档流。
- 结构化内容仍有精致边界。
- 右侧 Inspector 像 IDE / DevTools 辅助面板，而不是普通表单卡片。

### 回归

- `pnpm build` 通过。
- 打开 AI 页面无控制台报错。
- 面板展开/收起无布局跳动或水平滚动条。
- 小屏下可隐藏 Inspector，至少不破坏主聊天能力。

## 建议实施顺序

1. 在 `AiChatShell.vue` 增加 `showRunInspector`、`runInspectorCount`、`runInspectorSummary`、`run-inspector` slot。
2. 实现右侧隐藏/展开布局和 RUN 窄条入口。
3. 在 `AiChatView.vue` 接入 `v-model:show-run-inspector`。
4. 将运行态组件迁移到 `#run-inspector`。
5. 清理主对话区中不应常驻的诊断组件。
6. 补充轻量动效和 responsive 处理。
7. 运行 `pnpm build`。
8. 手动验证普通对话、工具调用、审批、长对话滚动、附件和输入区。

## 不做事项

- 不重写现有 AI 对话 store。
- 不重写 Tauri stream。
- 不改 tool execution 数据结构。
- 不新增第三方动画库。
- 不把所有诊断信息重新塞回主消息流。
