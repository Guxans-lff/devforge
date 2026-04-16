# DevForge v2 迭代路线图

> 基于 claude-code-sourcemap、jetbrains-cc-gui、claude-code-main (CCB) 三个竞品分析得出的改进方向。

## 定位

DevForge = **全栈开发工作台**（DB + SSH + SFTP + AI + 文件管理一体化），与竞品"AI 编码助手"形成差异化。

---

## Phase 1: @file 上下文引用（优先级最高）

**目标**: AI 对话中可直接引用工作区文件作为上下文

**灵感来源**: jetbrains-cc-gui 的 @file 引用机制

**核心功能**:
- AI 输入框支持 `@` 触发文件选择器（fuzzy search）
- 选中文件自动读取内容并注入 AI 上下文
- 支持引用整个文件或选中片段（行范围）
- 引用的文件显示为可点击的 chip/tag
- 支持多文件同时引用
- 引用文件变更时提示用户刷新上下文

**技术方案**:
- 复用 FilesPanel 的 `fuzzyFilter` + 工作区文件索引
- Tauri 后端读取文件内容（已有 `ws_read_directory` 基础）
- AI 消息协议扩展：`attachments: { type: 'file', path, content, range? }[]`

**预估工作量**: 3-5 天

---

## Phase 2: 对话记忆系统

**目标**: AI 对话上下文持久化、跨会话记忆、智能压缩

**灵感来源**: CCB 的 /dream 记忆管理

**核心功能**:
- **会话摘要**: 对话结束时自动生成摘要，存入 SQLite
- **项目记忆**: 每个工作区维护独立知识库（技术栈、架构决策、常见问题）
- **智能召回**: 新对话开始时，根据当前上下文自动召回相关记忆
- **手动管理**: 用户可查看/编辑/删除记忆条目
- **记忆衰减**: 过期记忆自动降权，避免噪音累积

**技术方案**:
- SQLite `ai_memories` 表：id, workspace_id, type(summary/knowledge/preference), content, embedding?, created_at, last_used, weight
- 对话结束 hook → 调用 AI 生成摘要 → 存储
- 新对话开始 → 检索相关记忆 → 注入 system prompt

**预估工作量**: 5-8 天

---

## Phase 3: 插件/Skill 框架

**目标**: 可扩展能力框架，支持社区贡献

**灵感来源**: claude-code-sourcemap 的 Skill/Plugin 系统

**核心功能**:
- **Skill 定义格式**: Markdown 描述 + JSON Schema 参数 + 执行脚本
- **内置 Skill**: 代码审查、Git 操作、SQL 生成、文档生成
- **Skill 市场**: 本地目录扫描 + 远程仓库（后期）
- **权限沙箱**: Skill 执行受限于声明的权限范围
- **MCP 兼容**: 支持 Model Context Protocol 标准

**技术方案**:
- `~/.devforge/skills/` 目录约定
- Skill Manifest: `skill.json` (name, description, permissions, entry)
- 运行时：Tauri sidecar 或 WASM 沙箱执行
- AI 侧：动态注册工具描述到 LLM tool_use

**预估工作量**: 10-15 天

---

## Phase 4: 多实例协作（远期）

**目标**: 多个 DevForge 实例间协作

**灵感来源**: CCB 的 Pipe IPC + LAN 零配置发现

**核心功能**:
- LAN 内 DevForge 实例自动发现（mDNS/UDP broadcast）
- 共享工作区状态（谁在编辑什么）
- AI 任务分发（主实例派发子任务到其他实例）

**预估工作量**: 15-20 天，远期规划

---

## 优先级排序

| Phase | 功能 | 投入 | 收益 | ROI |
|-------|------|------|------|-----|
| 1 | @file 引用 | 小 | 高 | ⭐⭐⭐⭐⭐ |
| 2 | 记忆系统 | 中 | 高 | ⭐⭐⭐⭐ |
| 3 | 插件框架 | 大 | 长期高 | ⭐⭐⭐ |
| 4 | 多实例协作 | 大 | 中 | ⭐⭐ |

**建议执行顺序**: Phase 1 → Phase 2 → Phase 3 → Phase 4
