# 需求文档：文件传输实时进度优化

## 简介

本规范定义了 DevForge 项目中文件传输功能的优化需求。当前系统已实现基础的文件传输进度显示（Phase 1），但存在以下问题：
- 小文件传输瞬间完成，用户无法看到进度反馈
- 大文件因一次性读取整个文件再上传，无法显示实时进度
- 缺少传输控制功能（暂停/恢复/取消）

本次优化将实现分块读取、分块上传、实时进度更新和传输控制功能，提升用户体验。

## 术语表

- **Transfer_System**: 文件传输系统，负责处理文件上传和下载
- **Chunk**: 文件块，将大文件分割成的固定大小的数据块
- **Progress_Event**: 进度事件，从后端发送到前端的传输进度更新
- **Transfer_Task**: 传输任务，代表一个文件的上传或下载操作
- **Transfer_Store**: Pinia 状态管理存储，管理所有传输任务的状态
- **SFTP_Handler**: SFTP 处理器，后端负责实际文件传输的模块
- **Chunk_Size**: 分块大小，每个文件块的字节数
- **Progress_Throttle**: 进度节流，控制进度事件发送频率的机制

## 需求

### 需求 1：分块文件读取

**用户故事：** 作为系统开发者，我希望能够分块读取文件，以便支持大文件的流式处理和实时进度更新。

#### 验收标准

1. WHEN 读取文件时，THE Transfer_System SHALL 将文件分割成固定大小的 Chunk
2. WHEN Chunk_Size 未配置时，THE Transfer_System SHALL 使用默认值 1MB (1048576 字节)
3. WHEN 文件大小小于 Chunk_Size 时，THE Transfer_System SHALL 将整个文件作为单个 Chunk 处理
4. WHEN 读取每个 Chunk 时，THE Transfer_System SHALL 按顺序读取文件内容
5. THE Transfer_System SHALL 支持配置 Chunk_Size 的最小值为 64KB，最大值为 10MB

### 需求 2：分块文件上传

**用户故事：** 作为用户，我希望大文件能够分块上传，以便看到实时的上传进度。

#### 验收标准

1. WHEN 上传文件时，THE SFTP_Handler SHALL 逐块发送文件数据到远程服务器
2. WHEN 每个 Chunk 上传完成后，THE SFTP_Handler SHALL 发送 Progress_Event
3. WHEN 所有 Chunk 上传完成后，THE SFTP_Handler SHALL 发送传输完成事件
4. IF 某个 Chunk 上传失败，THEN THE SFTP_Handler SHALL 返回错误信息并停止传输
5. THE SFTP_Handler SHALL 保持 SFTP 连接在整个传输过程中有效

### 需求 3：分块文件下载

**用户故事：** 作为用户，我希望大文件能够分块下载，以便看到实时的下载进度。

#### 验收标准

1. WHEN 下载文件时，THE SFTP_Handler SHALL 逐块读取远程文件数据
2. WHEN 每个 Chunk 下载完成后，THE SFTP_Handler SHALL 将数据写入本地文件
3. WHEN 每个 Chunk 写入完成后，THE SFTP_Handler SHALL 发送 Progress_Event
4. WHEN 所有 Chunk 下载完成后，THE SFTP_Handler SHALL 发送传输完成事件
5. IF 某个 Chunk 下载失败，THEN THE SFTP_Handler SHALL 返回错误信息并停止传输

### 需求 4：实时进度更新

**用户故事：** 作为用户，我希望看到文件传输的实时进度，以便了解传输状态和预估完成时间。

#### 验收标准

1. WHEN 传输进行中时，THE Transfer_System SHALL 计算已传输字节数、总字节数和传输速度
2. WHEN 发送 Progress_Event 时，THE Transfer_System SHALL 包含任务ID、已传输字节数、总字节数和当前速度
3. WHEN Progress_Event 被接收时，THE Transfer_Store SHALL 更新对应任务的状态
4. THE Transfer_System SHALL 使用滑动窗口算法计算传输速度（基于最近 3 秒的数据）
5. THE Transfer_System SHALL 限制 Progress_Event 发送频率为每 100 毫秒最多一次

### 需求 5：传输速度和剩余时间显示

**用户故事：** 作为用户，我希望看到当前传输速度和预估剩余时间，以便了解传输何时完成。

#### 验收标准

1. WHEN 传输进行中时，THE Transfer_Store SHALL 计算并存储当前传输速度
2. WHEN 传输速度大于 0 时，THE Transfer_Store SHALL 计算预估剩余时间
3. WHEN 显示速度时，THE UI SHALL 使用人类可读格式（B/s, KB/s, MB/s, GB/s）
4. WHEN 显示剩余时间时，THE UI SHALL 使用人类可读格式（秒、分钟、小时）
5. WHEN 传输速度为 0 或任务未开始时，THE UI SHALL 显示 "--" 作为剩余时间

### 需求 6：传输控制（暂停/恢复）

**用户故事：** 作为用户，我希望能够暂停和恢复文件传输，以便在需要时控制网络带宽使用。

#### 验收标准

1. WHEN 用户点击暂停按钮时，THE Transfer_System SHALL 停止发送新的 Chunk
2. WHEN 传输被暂停时，THE Transfer_Task SHALL 将状态更新为 'paused'
3. WHEN 用户点击恢复按钮时，THE Transfer_System SHALL 从上次停止的位置继续传输
4. WHEN 传输恢复时，THE Transfer_Task SHALL 将状态更新为 'transferring'
5. THE Transfer_System SHALL 保存暂停时的传输位置（已传输的字节数）

### 需求 7：传输取消

**用户故事：** 作为用户，我希望能够取消正在进行的文件传输，以便停止不需要的传输操作。

#### 验收标准

1. WHEN 用户点击取消按钮时，THE Transfer_System SHALL 立即停止传输
2. WHEN 传输被取消时，THE Transfer_System SHALL 清理临时文件和资源
3. WHEN 传输被取消时，THE Transfer_Task SHALL 从活动任务列表中移除
4. IF 取消上传操作，THEN THE Transfer_System SHALL 删除远程服务器上的不完整文件
5. IF 取消下载操作，THEN THE Transfer_System SHALL 删除本地的不完整文件

### 需求 8：小文件优化

**用户故事：** 作为用户，我希望小文件传输保持快速和流畅，不因为分块机制而变慢。

#### 验收标准

1. WHEN 文件大小小于 Chunk_Size 时，THE Transfer_System SHALL 使用单次传输
2. WHEN 文件大小小于 100KB 时，THE Transfer_System SHALL 至少显示进度 200 毫秒
3. WHEN 小文件传输完成时，THE UI SHALL 显示完成状态至少 1 秒
4. THE Transfer_System SHALL 不为小文件创建不必要的临时文件
5. THE Transfer_System SHALL 确保小文件传输的总开销不超过 50 毫秒

### 需求 9：错误处理和恢复

**用户故事：** 作为用户，我希望系统能够妥善处理传输错误，并提供清晰的错误信息。

#### 验收标准

1. WHEN 传输过程中发生错误时，THE Transfer_System SHALL 捕获错误并记录详细信息
2. WHEN 错误发生时，THE Transfer_System SHALL 发送错误事件到前端
3. WHEN 错误事件被接收时，THE Transfer_Store SHALL 更新任务状态为 'error'
4. WHEN 显示错误时，THE UI SHALL 显示用户友好的错误消息
5. THE Transfer_System SHALL 区分可恢复错误（网络超时）和不可恢复错误（权限拒绝）

### 需求 10：配置管理

**用户故事：** 作为系统管理员，我希望能够配置传输参数，以便根据不同环境优化性能。

#### 验收标准

1. THE Transfer_System SHALL 支持配置 Chunk_Size（默认 1MB）
2. THE Transfer_System SHALL 支持配置 Progress_Throttle 间隔（默认 100ms）
3. THE Transfer_System SHALL 支持配置速度计算窗口大小（默认 3 秒）
4. THE Transfer_System SHALL 支持配置并发传输任务数量上限（默认 3）
5. WHERE 配置文件存在，THE Transfer_System SHALL 从配置文件加载参数

### 需求 11：UI 兼容性

**用户故事：** 作为开发者，我希望新功能能够与现有 UI 无缝集成，不破坏现有用户体验。

#### 验收标准

1. THE Transfer_Store SHALL 保持现有的接口签名不变
2. THE TransferQueue 组件 SHALL 继续使用现有的数据结构
3. WHEN 添加新功能时，THE UI SHALL 保持现有的视觉风格和布局
4. THE Transfer_System SHALL 继续支持现有的事件监听机制
5. THE Transfer_System SHALL 向后兼容现有的传输任务格式

### 需求 12：性能要求

**用户故事：** 作为用户，我希望文件传输功能高效且不影响应用程序的整体性能。

#### 验收标准

1. WHEN 传输大文件时，THE Transfer_System SHALL 保持内存使用低于 100MB
2. WHEN 多个文件同时传输时，THE Transfer_System SHALL 合理分配 CPU 资源
3. THE Transfer_System SHALL 确保 UI 线程不被传输操作阻塞
4. THE Transfer_System SHALL 在传输完成后及时释放所有资源
5. WHEN 发送 Progress_Event 时，THE Transfer_System SHALL 确保事件处理延迟低于 10ms
