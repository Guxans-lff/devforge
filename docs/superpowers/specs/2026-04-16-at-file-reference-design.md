# @file 上下文引用 — 设计规格

## 目标

在 DevForge AI 对话中实现 `@` 触发的工作区文件引用，让用户快速将文件内容注入 AI 上下文。同时增强附件选择器为工作区文件浏览器。

## 核心原则

- **零后端改动** — 复用现有 `FileAttachment` + `<file>` 标签管线
- **@ 是 addFile 的快捷方式** — 不引入新的消息协议
- **仅工作区文件** — 数据源为 `workspace-files` store 的 flatNodes

---

## 功能 1: @ 触发文件引用

### 交互流程

1. textarea 输入 `@` → 弹出 `AtMentionPopover` 浮层
2. 浮层定位在光标下方，显示工作区文件列表（fuzzy 搜索）
3. 继续输入作为搜索词，↑↓ 导航，Enter 选中，Esc 关闭
4. 选中后：
   - textarea 中 `@` 替换为 `@filename.ts `（带尾部空格）
   - 调用 `useFileAttachment.addFile(absolutePath)` 添加到附件栏
5. 发送时剥离 `@xxx` 文本标记，实际内容由 FileAttachment 注入

### AtMentionPopover 组件

- **定位**: textarea `selectionStart` + mirror div 计算光标坐标
- **数据源**: `workspace-files.flatNodes` 过滤目录和 rootHeader，通过 `fuzzyFilter` 搜索
- **UI**: 宽 300px，最大高度 320px，最多 10 条结果
- **空搜索**: 显示最近修改的文件（前 10 个）
- **关闭条件**: Esc、点击外部、删除 `@` 字符

---

## 功能 2: 工作区文件选择器

### 触发

点击输入框附件按钮（原系统对话框）→ 改为弹出 `WorkspaceFilePicker`

### WorkspaceFilePicker 组件

- 对话框形式，顶部搜索框 + 文件树
- 多选模式 — 点击文件打勾，点击目录展开/收起
- 底部"浏览其他文件..."按钮 → 回退到系统对话框（保留原能力）
- 确定后批量 `addFile()`
- 复用 `workspace-files` store 的目录数据

---

## 数据流

```
用户输入: "@main.ts 分析这个文件"
附件栏: [FileAttachment{ path: ".../main.ts", status: "ready" }]
     ↓ send()
剥离 @ 标记 → "分析这个文件"
     ↓ buildFileMarkedContent(text, attachments)
发给 AI: "分析这个文件\n<file name="main.ts" ...>内容</file>"
```

---

## 改动范围

| 文件 | 类型 | 改动 |
|------|------|------|
| `components/ai/AtMentionPopover.vue` | 新建 | @ fuzzy 搜索浮层 |
| `components/ai/WorkspaceFilePicker.vue` | 新建 | 树形文件多选对话框 |
| `components/ai/AiInputArea.vue` | 修改 | @ 检测、弹出浮层、插入标记 |
| `composables/useFileAttachment.ts` | 修改 | 新增去重逻辑 |
| `views/AiChatView.vue` | 修改 | 附件按钮改为打开 WorkspaceFilePicker |

**不改动**: 后端、消息类型 `ai.ts`、store `ai-chat.ts`、消息气泡渲染、`file-markers.ts`
