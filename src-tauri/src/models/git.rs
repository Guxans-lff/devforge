use serde::{Deserialize, Serialize};

/// 仓库基本信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryInfo {
    /// 仓库路径
    pub path: String,
    /// 当前分支名
    pub current_branch: String,
    /// HEAD 提交哈希
    pub head_commit: String,
    /// 是否为裸仓库
    pub is_bare: bool,
    /// 远程列表
    pub remotes: Vec<String>,
}

/// 工作区状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// 当前分支
    pub current_branch: String,
    /// 已暂存的文件
    pub staged: Vec<GitFileStatus>,
    /// 未暂存的修改
    pub unstaged: Vec<GitFileStatus>,
    /// 未跟踪的文件
    pub untracked: Vec<String>,
    /// 是否有冲突
    pub has_conflicts: bool,
    /// 领先远程的提交数
    pub ahead: u32,
    /// 落后远程的提交数
    pub behind: u32,
}

/// 文件状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    /// 文件路径
    pub path: String,
    /// 状态：added / modified / deleted / renamed / conflicted
    pub status: String,
}

/// 提交记录
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    /// 完整哈希
    pub hash: String,
    /// 短哈希（7 位）
    pub short_hash: String,
    /// 提交消息（第一行）
    pub message: String,
    /// 完整消息体
    pub body: Option<String>,
    /// 作者
    pub author: String,
    /// 作者邮箱
    pub author_email: String,
    /// 提交时间（Unix 秒）
    pub timestamp: i64,
    /// 父提交哈希列表
    pub parents: Vec<String>,
    /// 关联的引用（分支/标签/HEAD）
    pub refs: Vec<GitRef>,
}

/// Git 引用标签
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRef {
    /// 类型：branch / tag / remote / HEAD
    pub ref_type: String,
    /// 名称
    pub name: String,
}

/// 分支图节点
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphNode {
    /// 完整哈希
    pub hash: String,
    /// 短哈希
    pub short_hash: String,
    /// 提交消息
    pub message: String,
    /// 作者
    pub author: String,
    /// 时间戳
    pub timestamp: i64,
    /// 行号（从 0 开始）
    pub row: usize,
    /// 列号（分支线位置）
    pub col: usize,
    /// 到父提交的连线
    pub parents: Vec<GitGraphEdge>,
    /// 关联引用
    pub refs: Vec<GitRef>,
}

/// 分支图边（节点到父节点的连线）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphEdge {
    /// 父提交哈希
    pub parent_hash: String,
    /// 父提交的列位置
    pub parent_col: usize,
}

/// 分支图数据
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraph {
    /// 节点列表（按时间倒序）
    pub nodes: Vec<GitGraphNode>,
    /// 最大列数（用于计算图宽度）
    pub max_cols: usize,
}

/// Diff 统计
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffStats {
    /// 新增行数
    pub insertions: usize,
    /// 删除行数
    pub deletions: usize,
    /// 变更文件数
    pub files_changed: usize,
}

/// 文件级 Diff
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiff {
    /// 文件路径
    pub path: String,
    /// 旧路径（重命名时有值）
    pub old_path: Option<String>,
    /// 状态：added / modified / deleted / renamed
    pub status: String,
    /// Hunk 列表
    pub hunks: Vec<GitDiffHunk>,
    /// 是否为二进制文件
    pub is_binary: bool,
}

/// Diff Hunk
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffHunk {
    /// Hunk 头（@@ -x,y +x,y @@）
    pub header: String,
    /// 行列表
    pub lines: Vec<GitDiffLine>,
}

/// Diff 行
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffLine {
    /// 行类型：+ / - / 空格
    pub origin: String,
    /// 行内容
    pub content: String,
    /// 旧文件行号
    pub old_lineno: Option<u32>,
    /// 新文件行号
    pub new_lineno: Option<u32>,
}

/// 完整 Diff 数据
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    /// 统计信息
    pub stats: GitDiffStats,
    /// 文件 Diff 列表
    pub files: Vec<GitFileDiff>,
}

/// 分支信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    /// 分支名
    pub name: String,
    /// 是否为本地分支
    pub is_local: bool,
    /// 是否为当前分支
    pub is_current: bool,
    /// 上游分支名
    pub upstream: Option<String>,
    /// HEAD 提交哈希
    pub head_commit: String,
    /// 领先上游提交数
    pub ahead: u32,
    /// 落后上游提交数
    pub behind: u32,
}

/// Stash 条目
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStash {
    /// 索引
    pub index: usize,
    /// 消息
    pub message: String,
    /// 提交哈希
    pub commit_hash: String,
}

/// 远程仓库信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemote {
    /// 远程名称（如 origin）
    pub name: String,
    /// Push URL
    pub url: Option<String>,
    /// Fetch URL
    pub fetch_url: Option<String>,
}

/// 标签信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTag {
    /// 标签名
    pub name: String,
    /// 消息（annotated tag 有值）
    pub message: Option<String>,
    /// 创建者
    pub tagger: Option<String>,
    /// 目标提交哈希
    pub hash: String,
    /// 时间戳（Unix 秒）
    pub timestamp: i64,
    /// 是否为 lightweight tag
    pub is_lightweight: bool,
}

/// 合并结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeResult {
    /// 是否成功（无冲突）
    pub success: bool,
    /// 冲突文件列表
    pub conflicts: Vec<String>,
    /// 合并消息
    pub message: String,
}

/// Git 用户配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConfig {
    /// 用户名（user.name）
    pub user_name: Option<String>,
    /// 邮箱（user.email）
    pub user_email: Option<String>,
}

/// Blame 行信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameLine {
    /// 行号
    pub line_number: u32,
    /// 行内容
    pub content: String,
    /// 提交短哈希
    pub commit_hash: String,
    /// 作者
    pub author: String,
    /// 提交时间（Unix 秒）
    pub timestamp: i64,
}

/// 贡献者统计
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitContributor {
    /// 作者名
    pub name: String,
    /// 邮箱
    pub email: String,
    /// 提交数
    pub commits: usize,
    /// 最近提交时间（Unix 秒）
    pub last_commit: i64,
    /// 首次提交时间（Unix 秒）
    pub first_commit: i64,
}

/// 交互式 Rebase 操作类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RebaseAction {
    /// 保留提交
    Pick,
    /// 合并到上一个提交（保留消息）
    Squash,
    /// 合并到上一个提交（丢弃消息）
    Fixup,
    /// 修改提交消息
    Reword(String),
    /// 丢弃提交
    Drop,
}

/// 交互式 Rebase 计划条目
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseEntry {
    /// 完整提交哈希
    pub hash: String,
    /// 短哈希
    pub short_hash: String,
    /// 提交消息
    pub message: String,
    /// 作者
    pub author: String,
    /// 时间戳
    pub timestamp: i64,
    /// 操作
    pub action: RebaseAction,
}

/// 交互式 Rebase 执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseResult {
    /// 是否全部完成
    pub success: bool,
    /// 冲突文件列表（有冲突时非空）
    pub conflicts: Vec<String>,
    /// 已完成的步骤数
    pub completed_steps: usize,
    /// 总步骤数
    pub total_steps: usize,
    /// 结果消息
    pub message: String,
}
