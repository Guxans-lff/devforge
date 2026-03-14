# TypeScript 类型告警清理清单

> 来源：`pnpm build`（vue-tsc -b 严格模式）
> 总计：70 个告警，12 个文件
> 影响：不影响 Vite 打包和运行时，影响 CI 构建流水线

---

## 按文件分类

### 1. TableEditorPanel.vue — 22 个（最多）

**位置：** `src/components/database/TableEditorPanel.vue`

| 行号 | 类型 | 说明 | 修复方式 |
|------|------|------|----------|
| 222 | TS6133 | `idx` 未使用 | 改为 `_idx` 或删除 |
| 230 | TS6133 | `isDeletedColumn` 未使用 | 删除声明 |
| 413 (x2) | TS2322 | `undefined` 不可赋值给列定义类型 | 加 `!` 或 `?? defaultCol` |
| 425 | TS2532 | 对象可能为 undefined | 加可选链 `?.` |
| 442 | TS2345 | 参数可能为 undefined | 加空值检查 |
| 517, 522 | TS2304 | 找不到 `idx` | 变量作用域错误，检查循环/解构 |
| 648 | TS6133 | `updateIndexColumns` 未使用 | 删除或标记 `_` |
| 1016-1043 (x12) | TS2532 | 对象可能为 undefined | 批量加可选链 `?.` |

---

### 2. PerformanceDashboard.vue — 9 个

**位置：** `src/components/database/PerformanceDashboard.vue`

| 行号 | 类型 | 说明 | 修复方式 |
|------|------|------|----------|
| 12 | TS6133 | `CheckCircle2` 未使用 | 从 import 中移除 |
| 75 | TS2353 | `activeSubTab` 不存在于类型中 | 扩展 TabContext 类型或移除属性 |
| 321, 325 | TS2345 | `string \| undefined` 不可赋值给 `string` | 加 `?? ''` 或 `!` |
| 349, 363-374 (x6) | TS2532 | 对象可能为 undefined | 加可选链 `?.` |

---

### 3. RunSqlFileDialog.vue — 9 个

**位置：** `src/components/database/RunSqlFileDialog.vue`

| 行号 | 类型 | 说明 | 修复方式 |
|------|------|------|----------|
| 11 | TS6133 | `Switch` 未使用 | 从 import 中移除 |
| 15 (x2) | TS6133 | `AlertCircle`、`Database` 未使用 | 从 import 中移除 |
| 16 (x2) | TS6133 | `Check`、`Settings2` 未使用 | 从 import 中移除 |
| 18 | TS6133 | `Label` 未使用 | 从 import 中移除 |
| 133 (x2) | TS2339 | `fail`、`isFinished` 不存在于 `never` 类型 | 检查类型推断，可能需要 type assertion |
| 188 | TS2339 | `path` 不存在于 `never` 类型 | 同上 |

---

### 4. 测试文件 — 15 个

**位置：** `src/components/database/__tests__/`

| 文件 | 告警数 | 问题 | 修复方式 |
|------|--------|------|----------|
| `virtual-scroll-bug-condition.test.ts` | 8 | `node:fs`/`node:path` 找不到；`__dirname` 未定义；未使用变量 | tsconfig 添加 `"types": ["node"]`；改用 `import.meta.url` |
| `virtual-scroll-preservation.test.ts` | 7 | 同上 | 同上 |

**根本原因：** tsconfig.app.json 未包含 Node.js 类型声明，测试文件应由 tsconfig.node.json 或单独的 tsconfig.test.json 覆盖。

---

### 5. SqlEditor.vue — 2 个

**位置：** `src/components/database/SqlEditor.vue`

| 行号 | 类型 | 说明 | 修复方式 |
|------|------|------|----------|
| 119, 131 | TS2345 | `ICodeEditor` 不可赋值给 `IStandaloneCodeEditor` | 改用 `as IStandaloneCodeEditor` 类型断言 |

---

### 6. 其他文件 — 各 1-3 个

| 文件 | 告警数 | 问题 | 修复方式 |
|------|--------|------|----------|
| `ObjectTree.vue` | 3 | `onBeforeUnmount`/`clearObjectSearch` 未使用；`Key` 类型不兼容 | 移除未使用 import；类型断言 |
| `QueryHistoryPanel.vue` | 3 | `X`/`ChevronRight`/`handleDelete` 未使用 | 移除未使用的 import 和函数 |
| `QueryPanel.vue` | 1 | `resultPanelRef` 未使用 | vue-tsc -b 误报（template ref 实际使用），可忽略 |
| `EditDatabaseDialog.vue` | 1 | `newVal` 未使用 | 改为 `_newVal` |
| `SshForm.vue` | 1 | `AcceptableValue` 不可赋值给 `string` | 加 `as string` 或 `String()` |
| `SchemaComparePanel.vue` | 1 | `boolean` 不可赋值给 `number` | notification.warning 第三参数从 `true` 改为 `0` |

---

## 修复优先级

### 高（影响正确性）
- `TableEditorPanel.vue:517,522` — `idx` 找不到，可能导致运行时错误
- `RunSqlFileDialog.vue:133,188` — `never` 类型上的属性访问，类型推断异常

### 中（代码质量）
- 所有 `possibly undefined`（TS2532）— 加可选链防止潜在 null 引用
- 类型不兼容（TS2345/TS2322）— 加类型断言或空值检查

### 低（代码整洁）
- 未使用的 import/变量（TS6133）— 纯清理，约 15 个
- 测试文件 Node 类型 — 配置层面，加 tsconfig.test.json 即可

---

## 快速命令

```bash
# 查看所有告警
pnpm build 2>&1 | grep "error TS"

# 按文件统计告警数
pnpm build 2>&1 | grep "error TS" | sed 's/(.*//;s/src\///' | sort | uniq -c | sort -rn

# 仅跑 Vite 打包（跳过类型检查，验证运行时正常）
npx vite build
```
