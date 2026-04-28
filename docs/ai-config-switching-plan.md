# AI 配置切换能力详细方案

更新时间：2026-04-25

参考项目：`D:\Project\cc-switch-main`

## 1. 背景与目标

DevForge 目前已经具备 AI Provider 管理、Workspace 配置、Prompt/Skill/MCP/Feature Gate 等能力，但这些能力还比较分散：

- Provider、Model、API Endpoint、API Key、权限策略分别在不同 UI 与 store 中维护。
- Workspace 级配置能影响发送链路，但缺少“配置档案”概念。
- 用户如果想在“官方 OpenAI / 中转 NewAPI / Claude / 本地模型 / 项目专用配置”之间快速切换，需要手动改多个地方。
- 后续如果接入 Codex、Claude Code 等外部 CLI 配置文件，直接覆盖配置会有丢配置风险。

`cc-switch-main` 的核心价值不是 UI，而是它的配置治理模型：

1. 使用数据库作为配置单一事实源（SSOT）。
2. 切换时才写入目标 CLI 的 live config。
3. 切换前做当前 live config 回填，避免手动修改丢失。
4. 区分 exclusive provider 与 additive provider。
5. 代理接管运行中使用 hot-switch，不盲目写文件。
6. 配置导入、导出、备份、恢复形成闭环。

DevForge 应该吸收这些设计，建设自己的“AI 配置切换系统”。目标是：

- 一键切换 AI 配置档案。
- 切换内容覆盖 Provider、Model、Endpoint、Key 引用、Prompt、Skill、MCP、权限与 Feature Gate。
- 支持 workspace 级默认配置与本机个人覆盖。
- 支持 dry-run diff、备份、回滚。
- 后续可扩展到外部 CLI，如 Claude Code、Codex、Gemini CLI。
- 切换不阻塞 UI，不破坏正在运行的对话或后台 job。

## 2. 从 cc-switch-main 学到的关键模式

### 2.1 SSOT 与 Live Config 分层

`cc-switch-main` 把 provider 存在 SQLite 中，真实 CLI 配置文件只作为“运行态输出”。这点非常重要。

DevForge 应采用同样思路：

- `AiConfigProfile` 存在 DevForge 数据库或 workspace config 中。
- 当前应用实际使用的 provider/model/prompt/mcp 是切换后的“生效态”。
- 外部文件如 `.devforge/config.json`、`.mcp.json`、`~/.codex/config.toml` 只是 target adapter 的输出结果。

不要把 live config 当成唯一来源，否则容易出现：

- 手动改配置和 UI 改配置互相覆盖。
- 切换时无法知道哪些字段属于当前档案。
- 无法安全回滚。

### 2.2 Backfill 回填

`cc-switch-main` 在切换 provider 前，会读取当前 live config，把外部手动修改的内容回填到当前 provider。

DevForge 对应场景：

- 用户手动改了 `.devforge/config.json`。
- 用户手动改了 `.mcp.json`。
- 用户手动改了 Claude/Codex 配置文件。
- 用户在设置面板临时改了 prompt 或 model，但还没保存到配置档案。

切换前应先做 backfill：

1. 读取当前 active profile 对应的 live config。
2. 提取可归属字段。
3. 写回当前 profile 的 draft 或 revision。
4. 如果无法自动归属，进入 conflict list，提示用户确认。

### 2.3 Adapter 模式

`cc-switch-main` 为不同 CLI 写了不同适配器，例如 Codex TOML、Gemini env、OpenCode JSON、OpenClaw JSON5。

DevForge 也需要 adapter 层：

- `devforge-workspace`：写 `.devforge/config.json`。
- `devforge-runtime`：只切换当前应用内运行态，不写文件。
- `mcp-json`：写 `.mcp.json`。
- `codex-cli`：写 `~/.codex/config.toml` 与 auth。
- `claude-code`：写 `~/.claude/settings.json` 或相关配置。
- `external-env`：生成 shell env，不直接写用户环境变量。

### 2.4 Exclusive 与 Additive 两类配置

`cc-switch-main` 把 Claude/Codex/Gemini 视为 exclusive provider：同一时间只有一个 current provider。

OpenCode/OpenClaw/Hermes 更像 additive provider：多个 provider 可以共存，只切默认模型或入口。

DevForge 应明确区分：

- Exclusive：切换后当前会话默认使用一个 profile。
- Additive：多个 provider/tool/mcp 同时存在，切换的是默认路由或优先级。

DevForge AI 聊天主链路建议先做 exclusive profile；MCP 和 Skill 可用 additive 策略。

### 2.5 热切换与非热切换

如果当前有流式对话、工具执行、后台 job，不应直接覆盖运行中的配置。

建议分两种切换：

- Cold switch：写配置并设置为后续默认，当前运行任务不受影响。
- Hot switch：只更新运行时路由，用于代理/Provider Adapter 支持的场景。

第一阶段建议默认 cold switch，运行中任务只给提示，不强行重路由。

## 3. 功能边界

### 3.1 第一阶段必须支持

- 新建配置档案。
- 编辑配置档案。
- 删除配置档案。
- 复制当前配置为新档案。
- 一键切换当前 workspace 的 AI 配置档案。
- 切换前 dry-run diff。
- 切换前自动备份当前配置。
- 切换失败自动回滚。
- 显示当前 active profile 来源：default / local / workspace / imported。

### 3.2 第二阶段支持

- 导入/导出 profile。
- Profile revision 历史。
- 外部 CLI adapter：Codex / Claude Code。
- MCP profile 子集切换。
- Prompt/Skill bundle 切换。
- 配置冲突检测与手动合并。

### 3.3 暂不建议第一阶段做

- 直接修改系统环境变量。
- 自动扫描并覆盖所有外部 CLI 配置。
- 流式对话中强制切 provider。
- 多人协作远程同步。
- 复杂权限审批工作流。

## 4. 数据模型设计

### 4.1 AiConfigProfile

```ts
export interface AiConfigProfile {
  id: string
  name: string
  description?: string
  scope: 'global' | 'workspace'
  source: 'default' | 'local' | 'workspace' | 'imported'
  enabled: boolean
  provider: AiConfigProviderRef
  model: AiConfigModelRef
  endpoint?: AiConfigEndpoint
  credentialRef?: AiCredentialRef
  prompt?: AiConfigPromptBundle
  skills?: AiConfigSkillBundle
  mcp?: AiConfigMcpBundle
  permissions?: AiConfigPermissionPolicy
  featureGates?: Record<string, boolean>
  outputStyle?: string
  adapters: AiConfigTargetAdapter[]
  metadata: AiConfigProfileMetadata
}
```

### 4.2 Provider 与 Model 引用

```ts
export interface AiConfigProviderRef {
  providerId: string
  providerType: string
  displayName?: string
}

export interface AiConfigModelRef {
  modelId: string
  displayName?: string
  capabilities?: {
    toolUse?: boolean
    vision?: boolean
    thinking?: boolean
    jsonMode?: boolean
  }
}

export interface AiConfigEndpoint {
  baseUrl: string
  apiPath?: string
  headers?: Record<string, string>
}

export interface AiCredentialRef {
  kind: 'credential-store' | 'env' | 'manual'
  key: string
  label?: string
}
```

原则：profile 不应直接存明文 API Key，只存 credential reference。

### 4.3 Prompt / Skill / MCP Bundle

```ts
export interface AiConfigPromptBundle {
  systemPrompt?: string
  systemPromptExtra?: string
  memoryEnabled?: boolean
  outputStyle?: string
}

export interface AiConfigSkillBundle {
  enabledSkillIds: string[]
  disabledSkillIds?: string[]
  mode: 'replace' | 'merge'
}

export interface AiConfigMcpBundle {
  mode: 'replace' | 'merge'
  servers: Record<string, AiConfigMcpServer>
}

export interface AiConfigMcpServer {
  transport: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  enabled?: boolean
}
```

### 4.4 权限与 Feature Gate

```ts
export interface AiConfigPermissionPolicy {
  mode: 'normal' | 'strict' | 'readonly' | 'unsafe'
  requireApprovalForRead?: boolean
  requireApprovalForWrite?: boolean
  allowedTools?: string[]
  deniedTools?: string[]
  allowedPaths?: string[]
  deniedPaths?: string[]
}
```

### 4.5 Adapter 配置

```ts
export interface AiConfigTargetAdapter {
  id: string
  kind:
    | 'devforge-runtime'
    | 'devforge-workspace'
    | 'mcp-json'
    | 'codex-cli'
    | 'claude-code'
    | 'external-env'
  enabled: boolean
  targetPath?: string
  mode: 'write' | 'preview' | 'disabled'
}
```

### 4.6 Revision 与 Backup

```ts
export interface AiConfigProfileRevision {
  id: string
  profileId: string
  createdAt: number
  reason: 'create' | 'update' | 'switch' | 'backfill' | 'import' | 'rollback'
  snapshot: AiConfigProfile
}

export interface AiConfigSwitchBackup {
  id: string
  profileId: string
  createdAt: number
  adapterKind: AiConfigTargetAdapter['kind']
  targetPath?: string
  contentBefore?: string
  contentAfter?: string
  diff?: string
}
```

## 5. 存储方案

### 5.1 推荐表结构

后端建议新增表：

```sql
CREATE TABLE ai_config_profiles (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  workspace_root TEXT,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ai_config_profile_revisions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE ai_config_active_profile (
  scope TEXT NOT NULL,
  workspace_root TEXT,
  profile_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, workspace_root)
);

CREATE TABLE ai_config_switch_backups (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  adapter_kind TEXT NOT NULL,
  target_path TEXT,
  content_before TEXT,
  content_after TEXT,
  diff TEXT,
  created_at INTEGER NOT NULL
);
```

### 5.2 Workspace 文件落地

Workspace 级配置建议继续写入：

- `.devforge/config.json`：保存 active profile id、workspace override。
- `.devforge/ai-profiles/*.json`：可选，保存可分享 profile，不存密钥。
- `.mcp.json`：作为 MCP adapter 的输出文件。

建议不要把所有 profile 都塞进 `.devforge/config.json`，否则文件会越来越大，也不好合并。

## 6. 后端命令设计

### 6.1 Profile CRUD

```rust
#[tauri::command]
async fn ai_config_list_profiles(workspace_root: Option<String>) -> Result<Vec<AiConfigProfile>, AppError>;

#[tauri::command]
async fn ai_config_get_profile(id: String) -> Result<Option<AiConfigProfile>, AppError>;

#[tauri::command]
async fn ai_config_save_profile(profile: AiConfigProfile) -> Result<(), AppError>;

#[tauri::command]
async fn ai_config_delete_profile(id: String) -> Result<(), AppError>;
```

### 6.2 Switch / Preview / Rollback

```rust
#[tauri::command]
async fn ai_config_preview_switch(input: AiConfigSwitchInput) -> Result<AiConfigSwitchPreview, AppError>;

#[tauri::command]
async fn ai_config_apply_switch(input: AiConfigSwitchInput) -> Result<AiConfigSwitchResult, AppError>;

#[tauri::command]
async fn ai_config_rollback_switch(backup_id: String) -> Result<(), AppError>;
```

```ts
export interface AiConfigSwitchInput {
  profileId: string
  workspaceRoot?: string
  mode: 'runtime-only' | 'workspace' | 'external'
  dryRun?: boolean
  adapters?: string[]
}

export interface AiConfigSwitchPreview {
  profileId: string
  changes: AiConfigAdapterChange[]
  warnings: AiConfigSwitchWarning[]
  requiresRestart?: boolean
}

export interface AiConfigSwitchResult {
  profileId: string
  backupIds: string[]
  appliedAdapters: string[]
  warnings: AiConfigSwitchWarning[]
}
```

### 6.3 Backfill

```rust
#[tauri::command]
async fn ai_config_backfill_active_profile(input: AiConfigBackfillInput) -> Result<AiConfigBackfillResult, AppError>;
```

Backfill 不应该静默覆盖全部字段，应返回：

- 自动回填字段。
- 冲突字段。
- 用户需确认字段。

## 7. Adapter 设计

### 7.1 统一接口

```ts
export interface AiConfigAdapter {
  kind: AiConfigTargetAdapter['kind']
  detect(input: AiConfigAdapterDetectInput): Promise<AiConfigAdapterStatus>
  read(input: AiConfigAdapterReadInput): Promise<AiConfigAdapterSnapshot>
  preview(profile: AiConfigProfile, input: AiConfigAdapterApplyInput): Promise<AiConfigAdapterChange>
  apply(profile: AiConfigProfile, input: AiConfigAdapterApplyInput): Promise<AiConfigAdapterApplyResult>
  rollback(backup: AiConfigSwitchBackup): Promise<void>
}
```

### 7.2 `devforge-runtime` Adapter

只更新当前应用内状态，不写文件：

- selectedProviderId
- selectedModelId
- provider endpoint
- permission mode
- output style
- prompt bundle

适用于即时切换 UI 默认值。

### 7.3 `devforge-workspace` Adapter

写 `.devforge/config.json`：

```json
{
  "activeAiProfileId": "profile-newapi-prod",
  "preferredProvider": "openai-compatible",
  "preferredModel": "gpt-5.4",
  "features": {
    "ai.permission.strict": true
  }
}
```

注意：workspace 文件里只放非敏感信息。

### 7.4 `mcp-json` Adapter

写 `.mcp.json`，支持 merge/replace：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:/Project"]
    }
  }
}
```

需要在 preview 中显示新增、删除、修改 server。

### 7.5 `codex-cli` Adapter

后续可参考 `cc-switch-main/src-tauri/src/codex_config.rs`。

Codex 主要涉及：

- `~/.codex/config.toml`
- `~/.codex/auth.json`

建议第一版只 preview，不默认写入，等用户确认后再 apply。

### 7.6 `claude-code` Adapter

后续可参考 `cc-switch-main` 的 Claude settings 写入逻辑。

Claude Code 主要涉及：

- `~/.claude/settings.json`
- 项目级 `CLAUDE.md` 或 memory 文件。

同样建议第一版 preview-only。

## 8. 切换流程

### 8.1 标准流程

```text
用户选择 Profile
  ↓
加载 Profile + Active Profile
  ↓
检测当前是否有运行中任务
  ↓
读取 live config 做 backfill
  ↓
生成 dry-run preview
  ↓
用户确认
  ↓
创建 backup
  ↓
按 adapter 顺序 apply
  ↓
更新 active profile
  ↓
刷新前端状态 / provider cache / MCP 状态
  ↓
失败则 rollback 已写 adapter
```

### 8.2 Adapter 执行顺序

建议顺序：

1. `devforge-runtime`
2. `devforge-workspace`
3. `mcp-json`
4. external CLI adapters

原因：先让应用内配置生效，外部配置写入可失败但不应破坏 DevForge 内部可用性。

### 8.3 运行中任务处理

如果存在：

- streaming conversation
- tool execution
- compact job
- schema compare job
- ERP module load job

则切换 UI 应提示：

- “仅影响后续请求”。
- “当前运行任务继续使用启动时配置”。
- “强制应用到运行中任务”第一阶段不做。

## 9. 前端 UI 设计

### 9.1 入口位置

建议三个入口：

1. AI Chat 顶部 provider/model 区域增加 Profile 快捷切换。
2. AI 设置页增加“配置档案”Tab。
3. Workspace 配置摘要里展示 active profile 与来源。

### 9.2 Profile 列表

列表卡片展示：

- 名称。
- Provider / Model。
- Endpoint 域名。
- 权限模式。
- MCP server 数量。
- Skill 数量。
- 来源：global/workspace/imported。
- 当前是否 active。
- 最近切换时间。

操作：

- 切换。
- 预览差异。
- 编辑。
- 复制。
- 导出。
- 删除。

### 9.3 Switch Preview Dialog

必须展示：

- 将变更的 adapter。
- 每个 adapter 的目标路径。
- diff 摘要。
- 风险提示。
- 是否会写入外部文件。
- 是否会影响当前 workspace。
- 是否需要重启或重新打开会话。

按钮：

- 仅运行时切换。
- 应用到 workspace。
- 应用到外部 CLI。
- 取消。

### 9.4 回滚 UI

在 profile 页面展示最近 switch backups：

- 时间。
- profile。
- adapter。
- 目标路径。
- 回滚按钮。

## 10. 与现有 DevForge 模块的接入点

### 10.1 Provider 配置

接入：

- `src/components/ai/AiProviderConfig.vue`
- `src/stores/ai-chat.ts`
- `src/composables/useAiChatViewState.ts`

切换 profile 后应同步：

- selectedProviderId
- selectedModelId
- 当前 endpoint
- provider capability matrix

### 10.2 发送链路

接入：

- `src/composables/ai/chatSendPreparation.ts`
- `src/composables/useAiChat.ts`
- `src/composables/ai/providers/ProviderAdapter.ts`

要求：

- 每次发送记录 profile id。
- 运行中的 turn 使用 turn start 时的 profile snapshot。
- 防止发送中途 profile 变化导致 tool policy 不一致。

### 10.3 MCP 面板

接入：

- `src/components/ai/AiMcpStatusPanel.vue`
- `src/ai-gui/mcpStatus.ts`
- `src-tauri/src/commands/ai.rs` 中 MCP status 命令。

切换后刷新 MCP status。

### 10.4 Feature Gate

接入：

- `src/stores/ai-feature-gate.ts`
- `src/components/ai/AiFeatureGateSettings.vue`

Profile 里的 feature gates 应作为一层来源：

```text
profile override > workspace override > local settings > default
```

### 10.5 权限策略

接入：

- `src/ai-gui/providerPermissionMapper.ts`
- `src/composables/ai/chatToolExecution.ts`
- `src/components/ai/AiApprovalDialog.vue`

Profile 切换后应立即影响后续 tool approval policy。

## 11. 风险与保护

### 11.1 密钥安全

禁止把 API Key 明文写入：

- profile json
- workspace config
- 导出文件
- 日志
- diagnostic package

只允许：

- credential ref。
- 本地安全存储。
- 用户显式选择“导出包含密钥”时才加密导出。

### 11.2 文件覆盖风险

写外部配置前必须：

- 读取当前内容。
- 创建 backup。
- 生成 diff。
- 原子写入临时文件再 rename。
- 失败 rollback。

### 11.3 格式风险

不同配置格式需要独立 parser：

- JSON。
- JSON5。
- TOML。
- ENV。
- YAML。

不要用字符串拼接写复杂配置。

### 11.4 并发切换风险

同一 workspace 同一时间只允许一个 switch job。

建议复用现有 Background Job：

- kind: `ai_config_switch`
- 同 workspace 去重。
- 支持取消 pending switch。
- running 后不建议强制取消，除非 adapter 支持 rollback。

## 12. 实施任务拆分

### P0：DevForge 内部 Profile 切换

1. 新增 `AiConfigProfile` 类型与 store。
2. 新增 profile CRUD 后端命令。
3. 新增 active profile 读取/写入。
4. AI 设置页增加“配置档案”Tab。
5. AI Chat 顶部增加 Profile 快捷切换。
6. 切换后同步 selectedProviderId / selectedModelId。
7. 每次发送记录 profile snapshot。
8. 添加最小测试：创建、编辑、切换、删除。

### P1：Preview / Backup / Rollback

1. 新增 switch preview API。
2. 新增 adapter change diff。
3. 新增 switch backup 表。
4. 写 `.devforge/config.json` 前备份。
5. 支持 rollback 最近一次 switch。
6. UI 增加 diff dialog。
7. 添加失败 rollback 测试。

### P2：MCP / Prompt / Skill Bundle

1. Profile 支持 prompt bundle。
2. Profile 支持 skill bundle。
3. Profile 支持 MCP bundle。
4. `mcp-json` adapter 支持 merge/replace。
5. 切换后刷新 MCP 面板。
6. 权限策略和 feature gate 纳入 profile 来源。

### P3：外部 CLI Adapter

1. Codex adapter preview。
2. Codex adapter apply。
3. Claude Code adapter preview。
4. Claude Code adapter apply。
5. 外部文件备份与 rollback。
6. 外部配置冲突检测。

### P4：导入导出与团队协作

1. Profile 导出，不含密钥。
2. Profile 导入，credential ref 重新绑定。
3. Workspace profile 分享。
4. Profile revision history。
5. 配置冲突合并 UI。

## 13. 推荐文件结构

```text
src/
  ai-config/
    profileTypes.ts
    profileDiff.ts
    profileValidation.ts
    profilePreview.ts
    adapters/
      devforgeRuntimeAdapter.ts
      devforgeWorkspaceAdapter.ts
      mcpJsonAdapter.ts
      codexCliAdapter.ts
      claudeCodeAdapter.ts
  stores/
    ai-config-profile.ts
  api/
    ai-config.ts
  components/ai-config/
    AiConfigProfileList.vue
    AiConfigProfileEditor.vue
    AiConfigSwitchDialog.vue
    AiConfigDiffViewer.vue
    AiConfigRollbackPanel.vue

src-tauri/src/
  commands/
    ai_config.rs
  services/
    ai_config/
      mod.rs
      store.rs
      switch.rs
      backup.rs
      adapters/
        devforge_workspace.rs
        mcp_json.rs
        codex_cli.rs
        claude_code.rs
```

## 14. 测试策略

### 14.1 单元测试

- profile validation。
- diff generation。
- adapter preview。
- credential ref 脱敏。
- merge/replace 策略。

### 14.2 后端测试

- profile CRUD。
- switch apply。
- switch rollback。
- 文件写入失败回滚。
- 外部文件格式损坏时的错误提示。

### 14.3 前端测试

- Profile 列表渲染。
- 切换 dialog 展示 diff。
- 切换后 selected provider/model 更新。
- running task 存在时提示“仅影响后续请求”。

## 15. 验收标准

第一阶段完成后，应满足：

- 用户能创建两个 profile，例如“官方 OpenAI”和“公司 NewAPI”。
- 用户能一键切换，AI 输入区 provider/model 立即更新。
- 切换不会影响正在流式输出的当前 turn。
- 新 turn 使用切换后的 profile。
- 切换前能看到将变更的配置摘要。
- 切换失败不会造成半写状态。
- 导出的 profile 不包含明文密钥。

## 16. 建议优先级

建议先做 P0 + P1，不要一开始直接做外部 CLI 写入。

原因：

- DevForge 内部 profile 切换能最快提升体验。
- Backup / Rollback 是安全底座。
- 外部 CLI adapter 风险较高，必须等 preview 和 rollback 成熟后再做。

最小可交付版本：

1. Profile CRUD。
2. Runtime-only switch。
3. Workspace active profile。
4. Switch preview。
5. Backup/rollback。

完成这些后，再扩展 MCP bundle 和 Codex/Claude adapter。
