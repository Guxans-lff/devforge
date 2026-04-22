# 进度记录 2026-04-22

## 概览

本轮工作已经完成两条主线：

1. Dispatcher V1 核心闭环落地并完成专项回归
2. AI 主页面从“信息面板”收敛为“仓库工作台”形态

另外已合入数据库导出修复，当前工作区中的相关改动一并保留。

## 已完成内容

### 1. Dispatcher V1 核心闭环

- 新增共享会话执行器：
  - `src/composables/ai/chatSessionRunner.ts`
- 主会话发送链路统一走共享 runner：
  - `src/composables/useAiChat.ts`
- `headless` 子任务改为真实子会话执行：
  - 执行后写回真实 `sessionId`
  - 写回 `resultSessionId`、`taskSessionId`、`resultSummary`
  - 支持真实取消与收口
- 调度桥接修正：
  - 父会话发送后不再等待 dispatcher drain 完成
  - spawned task 改为后台调度，避免主发送链路被阻塞
- `tab` 模式保持当前语义：
  - 本轮不做自动首发
  - 仍支持打开任务 tab 并跟踪结果

### 2. Dispatcher V1 测试补齐与回归

- 新增 runner 单测：
  - `src/composables/__tests__/chatSessionRunner.test.ts`
- 更新和保留的关键测试：
  - `src/composables/__tests__/chatTaskDispatcher.test.ts`
  - `src/composables/__tests__/chatSideEffects.test.ts`
  - `src/components/ai/__tests__/AiSpawnedTasksPanel.test.ts`
  - `src/views/__tests__/AiChatView.interaction.test.ts`
- 已验证覆盖的核心场景：
  - 正常完成
  - 运行中取消
  - 瞬时失败 `retryable: true`
  - 非瞬时失败 `retryable: false`
  - headless 任务写回结果会话信息
  - 父会话发送不等待后台任务完成
  - tab 任务显式打开与完成
  - synthesis 写回父输入框

### 3. AI 主页面改造

目标从“AI 仪表盘”改成“以仓库上下文为中心的工作台”。

本轮已完成：

- 将目录树和当前文件焦点融入 AI 主页面
- 右侧任务区改为按需展开的任务抽屉
- 去掉主区重复任务面板，完整任务操作只保留在抽屉内
- 输入区压缩为更紧凑的单卡片结构
- 主页面文案进一步中文化，减少系统术语和英文暴露
- 顶部工具栏收敛：
  - 主按钮改为更短文案
  - 任务按钮只保留图标和数量
  - repository 模式下不再常驻显示 token 用量徽章
- 空状态去仪表盘化：
  - 统计卡改为轻量摘要标签
  - “当前焦点”并回“当前文件”
  - 目录卡片弱化路径和计数噪音

主要涉及文件：

- `src/views/AiChatView.vue`
- `src/components/ai/AiChatShell.vue`
- `src/components/ai/AiInputArea.vue`
- `src/components/layout/panels/FilesPanel.vue`
- `src/components/layout/panels/files/FileTreeRow.vue`
- `src/components/layout/panels/files/WorkspaceRootHeader.vue`
- `src/views/FileEditorView.vue`
- `src/views/MainLayout.vue`
- `src/stores/workspace-files.ts`
- `src/stores/workspace.ts`
- `src/composables/useFileTree.ts`
- `src/locales/zh-CN.ts`
- `src/locales/en.ts`

### 4. 数据库导出修复

当前工作区包含数据库导出相关修复：

- `src-tauri/src/services/db_backup.rs`
- `src-tauri/src/services/db_drivers/mysql/mod.rs`

本轮按当前仓库状态一并提交。

## 当前验证基线

已通过：

- `pnpm exec vue-tsc -b`
- `pnpm exec vitest run src/composables/__tests__/chatSessionRunner.test.ts src/composables/__tests__/chatTaskDispatcher.test.ts src/composables/__tests__/chatSideEffects.test.ts src/components/ai/__tests__/AiSpawnedTasksPanel.test.ts src/views/__tests__/AiChatView.interaction.test.ts --testTimeout=10000`
- `pnpm exec vitest run src/views/__tests__/AiChatView.interaction.test.ts --testTimeout=10000`
- `pnpm exec vitest run src/stores/__tests__/workspace.test.ts`

## 当前状态判断

- Dispatcher V1：核心闭环已完成，可继续进入增量稳定化
- AI 主页面：已完成一轮明显收敛，当前可先冻结体验方向
- 数据库导出：当前修复已保留在提交范围内

## 后续建议

如果下一轮继续推进，建议优先级如下：

1. 给 dispatcher 补一条更底层的 `headless cancel` 单测
2. 继续做 AI 页面零散交互问题收尾，而不是再做大改版
3. 单独复查数据库导出修复的回归样例和导入兼容性
