# P1-03: 体验优化组合方案

> 优先级：P1 | 预估工作量：中 | 影响面：日常操作效率和安全性

---

## 一、现状分析

### 当前能力
- ✅ 命令面板（CommandPalette.vue - 235 行 + Store 235 行）
- ✅ 连接管理（connections.ts - 388 行，含搜索/分组/收藏/排序）
- ✅ 工作区持久化（workspace.ts - 217 行，localStorage 快照）
- ✅ 快捷键系统（settings.ts 中 36 个预定义快捷键）
- ✅ 欢迎页（WelcomeView.vue - 200+ 行，动态问候 + 快速操作）
- ✅ 连接对话框（ConnectionDialog.vue + DatabaseForm.vue）
- ✅ 自动重连（最多 3 次，间隔 5 秒）

### 当前缺失
- ❌ 连接环境标记（生产/测试/开发 颜色区分）
- ❌ 全局搜索增强（跨连接搜索表/列/数据）
- ❌ Onboarding 引导（新用户首次使用引导）
- ❌ 操作确认机制（危险操作二次确认）
- ❌ 连接状态视觉反馈优化
- ❌ 面包屑导航（当前位置：连接 > 数据库 > 表）
- ❌ 操作历史/撤销（undo 关闭的标签页等）

---

## 二、优化方案

### 2.1 连接环境标记

#### 2.1.1 问题描述

当同时连接多个数据库（如 dev、staging、production）时，容易混淆操作目标，误操作生产库是常见的灾难性事故。

#### 2.1.2 设计方案

**连接类型扩展**（`src/types/connection.ts`）：

```typescript
// 现有 ConnectionRecord 扩展
interface ConnectionRecord {
  // ... 现有字段
  environment?: 'production' | 'staging' | 'development' | 'testing' | 'local'
  color?: string        // 自定义颜色（Hex 值）
  readOnly?: boolean    // 只读模式
  confirmDanger?: boolean  // 危险操作确认（默认 production = true）
}

// 环境预设
const ENV_PRESETS = {
  production:  { color: '#EF4444', icon: 'shield-alert',  confirmDanger: true },
  staging:     { color: '#F59E0B', icon: 'flask',         confirmDanger: true },
  development: { color: '#10B981', icon: 'code',          confirmDanger: false },
  testing:     { color: '#6366F1', icon: 'test-tube',     confirmDanger: false },
  local:       { color: '#6B7280', icon: 'laptop',        confirmDanger: false },
}
```

**视觉体现**：

1. **Tab 标签颜色条**：连接标签页顶部/左侧显示环境颜色条
2. **侧边栏连接图标**：不同环境不同图标颜色
3. **状态栏提示**：底部状态栏显示当前连接环境
4. **全局顶部横条**（Production 模式）：红色警告条，持续提醒

```
┌─[!] 生产环境 - mysql-prod (192.168.1.100) ──────────────┐  ← 红色警告条
│ ┌──────┬──────────┬──────────┐                            │
│ │🔴prod│ 🟡staging│ 🟢dev   │  ← Tab 颜色标识           │
│ └──────┴──────────┴──────────┘                            │
```

**危险操作确认**：
- 当环境为 `production` 或 `staging` 时，以下操作需二次确认：
  - `DROP TABLE` / `DROP DATABASE`
  - `TRUNCATE`
  - `DELETE` 不带 `WHERE`
  - `ALTER TABLE` 修改/删除列
  - `UPDATE` 不带 `WHERE`

**确认弹窗设计**：
```
┌──────────────────────────────────────┐
│  ⚠️ 危险操作确认                      │
│                                      │
│  您正在 [生产环境] 执行以下操作：       │
│                                      │
│  DROP TABLE users                    │
│                                      │
│  连接: mysql-prod (192.168.1.100)    │
│  数据库: app_production              │
│                                      │
│  请输入数据库名确认: [____________]    │
│                                      │
│  [取消]                    [确认执行] │
└──────────────────────────────────────┘
```

**涉及文件**：
- 修改 `src/types/connection.ts` - 环境字段
- 修改 `src/components/connection/DatabaseForm.vue` - 环境选择 UI
- 新增 `src/components/common/EnvironmentBanner.vue` - 环境警告条
- 修改 `src/components/layout/MainLayout.vue` - 顶部警告条集成
- 修改 `src/views/DatabaseView.vue` - Tab 颜色条
- 新增 `src/composables/useDangerConfirm.ts` - 危险操作确认
- 修改 `src/components/database/QueryPanel.vue` - SQL 执行前检查
- 修改 `src-tauri/src/models/connection.rs` - Rust 类型扩展
- 修改 `src-tauri/src/services/storage.rs` - 存储字段

---

### 2.2 全局搜索增强

#### 2.2.1 现状

命令面板支持：连接搜索、基础命令、视图控制、最近项目。
ObjectTree 支持：当前连接内的对象搜索。

**缺失**：
- 无法跨连接搜索
- 无法按列名/数据类型搜索
- 无法搜索查询历史内容

#### 2.2.2 增强方案

**命令面板分类扩展**：

```typescript
// 现有 category 扩展
type CommandCategory =
  | 'connection' | 'view' | 'settings' | 'recent' | 'action'
  | 'table'      // 新增：表搜索
  | 'column'     // 新增：列搜索
  | 'history'    // 新增：查询历史
  | 'shortcut'   // 新增：快捷键
```

**搜索模式前缀**：

| 前缀 | 搜索范围 | 示例 |
|------|---------|------|
| 无前缀 | 全部 | `users` → 匹配所有 |
| `>` | 命令 | `>new query` |
| `@` | 表/视图 | `@users` → 所有连接中的 users 表 |
| `.` | 列名 | `.email` → 包含 email 列的表 |
| `:` | 查询历史 | `:SELECT` → 包含 SELECT 的历史 |
| `#` | 连接 | `#prod` → 生产连接 |

**搜索结果格式**：
```
@users
├── 📋 mysql-prod / app_db / users (32 columns, 15.2k rows)
├── 📋 mysql-dev / app_db / users (30 columns, 500 rows)
└── 📋 mysql-test / test_db / users (28 columns, 100 rows)
```

**搜索索引**：
- 使用已有的 SchemaCache 数据（无需额外查询）
- 缓存所有已连接数据库的表/列信息
- 支持模糊匹配（首字母缩写、驼峰匹配）

**涉及文件**：
- 修改 `src/stores/command-palette.ts` - 搜索分类 + 前缀解析
- 修改 `src/components/layout/CommandPalette.vue` - 搜索 UI 增强
- 新增 `src/composables/useGlobalSearch.ts` - 全局搜索逻辑
- 修改 `src/composables/useSchemaCache.ts` - 跨连接缓存

---

### 2.3 Onboarding 引导

#### 2.3.1 问题描述

首次使用的用户（即使是自己，换新设备后也需要）缺少功能引导。

#### 2.3.2 设计方案

**引导类型**：

**A. 首次使用引导（Welcome Tour）**

触发条件：检测到无任何连接配置时自动触发

步骤：
1. 欢迎弹窗 → 简介核心功能
2. 高亮"新建连接"按钮 → 引导创建第一个连接
3. 连接成功后 → 引导对象树操作
4. 高亮查询 Tab → 引导执行第一个 SQL
5. 完成 → 展示快捷键速查表

**B. 功能提示（Feature Tips）**

场景化提示，在用户首次接触特定功能时触发：
- 首次打开查询面板 → 提示 `Ctrl+Enter` 执行
- 首次点击表 → 提示可以双击查看数据
- 首次使用命令面板 → 提示搜索前缀功能

**C. 快捷键提示卡**

`Ctrl+/` 打开快捷键速查表（Cheat Sheet）

```
┌─────────── 快捷键速查 ───────────┐
│ 常用操作                          │
│ Ctrl+Enter    执行 SQL            │
│ Ctrl+T        新建查询            │
│ Ctrl+W        关闭标签页          │
│ Ctrl+P        命令面板            │
│ Ctrl+D        行详情              │
│                                   │
│ 编辑器                            │
│ Ctrl+Shift+F  格式化 SQL          │
│ Ctrl+S        保存片段            │
│ F5            执行                │
└───────────────────────────────────┘
```

**实现方式**：

```typescript
// src/composables/useOnboarding.ts

interface OnboardingState {
  completedTours: string[]
  seenTips: string[]
  firstLaunch: boolean
}

// localStorage 持久化
// 提供 composable API：
// - showTour(tourId) - 展示引导
// - showTip(tipId, targetEl) - 展示提示
// - markComplete(id) - 标记完成
// - resetAll() - 重置（设置页可用）
```

**涉及文件**：
- 新增 `src/composables/useOnboarding.ts` - 引导状态管理
- 新增 `src/components/common/OnboardingTour.vue` - 引导步骤组件
- 新增 `src/components/common/FeatureTip.vue` - 功能提示气泡
- 新增 `src/components/common/ShortcutSheet.vue` - 快捷键速查表
- 修改 `src/views/WelcomeView.vue` - 首次启动检测
- 修改 `src/views/DatabaseView.vue` - 功能提示触发

---

### 2.4 面包屑导航

#### 2.4.1 问题描述

在深层操作时（如编辑某张表的某个列），用户可能失去位置感。

#### 2.4.2 设计方案

**面包屑结构**：

```
🔴 mysql-prod > app_db > users > [查询]
🟢 mysql-dev > test_db > orders > [表编辑器]
```

**交互**：
- 点击连接名 → 切换连接
- 点击数据库名 → 切换数据库（触发 USE）
- 点击表名 → 打开表数据
- 下拉菜单 → 快速切换同级项目

**位置**：Tab 栏下方或 Tab 内容区顶部

**涉及文件**：
- 新增 `src/components/database/BreadcrumbNav.vue` - 面包屑组件
- 修改 `src/views/DatabaseView.vue` - 集成面包屑
- 修改 `src/stores/database-workspace.ts` - 当前上下文追踪

---

### 2.5 撤销关闭标签页

#### 2.5.1 问题描述

误关闭查询标签页后，未保存的 SQL 丢失。

#### 2.5.2 设计方案

**实现方式**：

```typescript
// 在 database-workspace.ts 中
interface ClosedTabRecord {
  tab: InnerTab
  closedAt: number
  sqlContent?: string  // 保存关闭时的 SQL 内容
}

// 最多保留 20 个关闭记录
const closedTabs: ClosedTabRecord[] = []

// Ctrl+Shift+T → 恢复最近关闭的标签页
function reopenLastClosedTab()
```

**涉及文件**：
- 修改 `src/stores/database-workspace.ts` - 关闭记录 + 恢复逻辑
- 修改 `src/composables/useKeyboardShortcuts.ts` - `Ctrl+Shift+T` 快捷键

---

### 2.6 操作反馈优化

#### 2.6.1 连接状态视觉反馈

**现状**：连接状态通过图标颜色表示，但不够直观

**优化**：
- 连接中：脉冲动画（breathing animation）
- 断开：灰色 + 断开图标
- 重连中：旋转动画 + 重连次数提示
- 错误：红色高亮 + 错误摘要

#### 2.6.2 SQL 执行反馈优化

**现状**：执行结果在查询面板显示

**优化**：
- 执行中：编辑器底部进度条
- 执行成功：底部状态栏显示耗时、影响行数（带淡出动画）
- 执行失败：编辑器内红色错误标记（标记到具体行）
- 长时间执行（>5s）：通知提示 + 取消按钮

**涉及文件**：
- 修改 `src/components/database/SqlEditor.vue` - 执行状态 UI
- 修改 `src/components/database/QueryPanel.vue` - 反馈逻辑
- 修改 `src/stores/connections.ts` - 连接状态动画数据

---

## 三、实施阶段

### 阶段 1：连接环境标记（工作量：2-3 天）
1. [ ] ConnectionRecord 类型扩展 + Rust 模型
2. [ ] DatabaseForm 环境选择 UI
3. [ ] Tab 颜色条 + 侧边栏图标
4. [ ] 生产环境警告横条
5. [ ] 危险操作确认弹窗
6. [ ] SQL 解析检测危险语句

### 阶段 2：全局搜索增强（工作量：2-3 天）
1. [ ] 命令面板前缀搜索解析
2. [ ] 跨连接表/列搜索
3. [ ] 查询历史搜索
4. [ ] 搜索结果 UI 优化

### 阶段 3：引导 + 快捷键（工作量：1-2 天）
1. [ ] Onboarding 状态管理
2. [ ] 首次使用引导流程
3. [ ] 快捷键速查表
4. [ ] 功能提示气泡

### 阶段 4：导航 + 撤销（工作量：1-2 天）
1. [ ] 面包屑导航组件
2. [ ] 撤销关闭标签页
3. [ ] 连接状态视觉优化

---

## 四、对标分析

| 功能 | DevForge（当前） | DataGrip | DBeaver | Navicat |
|------|-----------------|----------|---------|---------|
| 环境标记 | ❌→✅ | ✅（颜色标签） | ✅（基础） | ❌ |
| 危险操作确认 | ❌→✅ | ✅（可配置） | ✅ | ✅（基础） |
| 全局搜索 | 基础→✅ | ✅（优秀） | ✅ | ✅ |
| Onboarding | ❌→✅ | ✅（Tip of Day） | ❌ | ❌ |
| 面包屑导航 | ❌→✅ | ✅ | ✅ | ❌ |
| 撤销关闭 | ❌→✅ | ✅ | ❌ | ❌ |

---

## 五、风险与注意事项

1. **环境标记迁移**：已有连接需要默认标记为 `development`，避免突然弹确认框
2. **危险 SQL 检测准确性**：简单正则可能误判（如 `DELETE` 在注释中），需结合 SQL parser
3. **全局搜索性能**：多连接 Schema 缓存的内存占用需控制
4. **Onboarding 侵入性**：引导不能影响正常使用，必须可一键跳过和永久关闭
5. **快捷键冲突**：新增快捷键需检查与系统/浏览器/现有快捷键的冲突
