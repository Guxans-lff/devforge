use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh_sftp::client::SftpSession;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::models::transfer::{ErrorEvent, TransferConfig};
use crate::services::progress_tracker::ProgressTracker;
use crate::services::sftp_handler::SftpHandler;

/// TransferManager 的状态类型(用于 Tauri State)
pub type TransferManagerState = Arc<tokio::sync::Mutex<TransferManager>>;

/// 传输类型
#[derive(Debug, Clone)]
pub enum TransferType {
    Upload {
        local_path: PathBuf,
        remote_path: String,
    },
    Download {
        remote_path: String,
        local_path: PathBuf,
    },
}

/// 传输状态
#[derive(Debug, Clone, PartialEq)]
pub enum TransferState {
    Pending,
    Running { offset: u64 },
    Paused { offset: u64 },
    Completed,
    Failed { error: String },
}

/// 安全地获取 Mutex 锁（即使 mutex 被 poison 也不会 panic）
fn lock_or_recover<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

/// 传输任务
pub struct TransferTask {
    #[allow(dead_code)]
    pub id: String,
    pub task_type: TransferType,
    pub state: Arc<Mutex<TransferState>>,
    pub cancel_token: CancellationToken,
    pub total_bytes: u64,
}

impl TransferTask {
    pub fn new(id: String, task_type: TransferType, total_bytes: u64) -> Self {
        Self {
            id,
            task_type,
            state: Arc::new(Mutex::new(TransferState::Pending)),
            cancel_token: CancellationToken::new(),
            total_bytes,
        }
    }
}

impl Drop for TransferTask {
    fn drop(&mut self) {
        // 使用 if let 替代 expect，防止 Drop 中的双重 panic 导致进程 abort
        if let Ok(state) = self.state.lock() {
            if matches!(*state, TransferState::Running { .. } | TransferState::Paused { .. }) {
                // cancel_token.cancel() 是幂等的，可以安全调用
                self.cancel_token.cancel();

                // 清理临时文件
                if let TransferType::Download { local_path, .. } = &self.task_type {
                    let _ = std::fs::remove_file(local_path);
                }
            }
        } else {
            // mutex 被 poison 时仍然尝试取消任务（cancel 是无锁操作）
            self.cancel_token.cancel();
        }
    }
}

/// 待处理的传输任务
#[derive(Clone)]
struct PendingTransfer {
    id: String,
    transfer_type: TransferType,
    #[allow(dead_code)]
    connection_id: String,
    sftp_session: Arc<SftpSession>,
    total_bytes: u64,
}

/// 传输管理器
pub struct TransferManager {
    active_tasks: Arc<Mutex<HashMap<String, Arc<TransferTask>>>>,
    pending_queue: Arc<Mutex<VecDeque<PendingTransfer>>>,
    config: TransferConfig,
    scheduler_tx: Option<mpsc::UnboundedSender<()>>,
}

impl TransferManager {
    /// 创建新的传输管理器
    pub fn new(config: TransferConfig) -> Self {
        Self {
            active_tasks: Arc::new(Mutex::new(HashMap::new())),
            pending_queue: Arc::new(Mutex::new(VecDeque::new())),
            config,
            scheduler_tx: None,
        }
    }

    /// 使用默认配置创建传输管理器
    pub fn with_default_config() -> Self {
        Self::new(TransferConfig::default())
    }

    /// 启动队列调度器（在初始化时调用一次）
    pub fn start_scheduler(&mut self, app_handle: AppHandle) {
        let (tx, mut rx) = mpsc::unbounded_channel();
        self.scheduler_tx = Some(tx);

        let active_tasks = self.active_tasks.clone();
        let pending_queue = self.pending_queue.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            while rx.recv().await.is_some() {
                Self::process_queue(
                    active_tasks.clone(),
                    pending_queue.clone(),
                    &config,
                    &app_handle,
                ).await;
            }
        });

        // 发送初始信号
        let _ = self.scheduler_tx.as_ref().unwrap().send(());
    }

    /// 处理队列中的待处理任务
    async fn process_queue(
        active_tasks: Arc<Mutex<HashMap<String, Arc<TransferTask>>>>,
        pending_queue: Arc<Mutex<VecDeque<PendingTransfer>>>,
        config: &TransferConfig,
        app_handle: &AppHandle,
    ) {
        loop {
            // 检查是否可以启动更多任务（短暂持锁，立即释放）
            let active_count = lock_or_recover(&active_tasks).len();
            if active_count >= config.max_concurrent_tasks {
                break;
            }

            // 获取下一个待处理任务（短暂持锁，立即释放）
            let pending = lock_or_recover(&pending_queue).pop_front();

            let Some(pending) = pending else {
                break;
            };

            // 启动任务
            match pending.transfer_type {
                TransferType::Upload { local_path, remote_path } => {
                    let _ = Self::execute_transfer(
                        pending.id,
                        TransferType::Upload { local_path, remote_path },
                        pending.sftp_session,
                        pending.total_bytes,
                        active_tasks.clone(),
                        config.clone(),
                        app_handle.clone(),
                        None,
                    ).await;
                }
                TransferType::Download { remote_path, local_path } => {
                    let _ = Self::execute_transfer(
                        pending.id,
                        TransferType::Download { remote_path, local_path },
                        pending.sftp_session,
                        pending.total_bytes,
                        active_tasks.clone(),
                        config.clone(),
                        app_handle.clone(),
                        None,
                    ).await;
                }
            }
        }
    }

    /// 统一的传输任务执行（消除 execute_upload/execute_download 代码重复）
    #[allow(clippy::too_many_arguments)]
    async fn execute_transfer(
        id: String,
        transfer_type: TransferType,
        sftp: Arc<SftpSession>,
        total_bytes: u64,
        active_tasks: Arc<Mutex<HashMap<String, Arc<TransferTask>>>>,
        config: TransferConfig,
        app_handle: AppHandle,
        scheduler_tx: Option<mpsc::UnboundedSender<()>>,
    ) -> Result<(), String> {
        // 创建任务
        let task = Arc::new(TransferTask::new(
            id.clone(),
            transfer_type.clone(),
            total_bytes,
        ));

        // 添加到活动任务列表（短暂持锁）
        lock_or_recover(&active_tasks).insert(id.clone(), task.clone());

        // 更新状态为运行中
        *lock_or_recover(&task.state) = TransferState::Running { offset: 0 };

        // 创建进度跟踪器
        let progress_tracker = Arc::new(ProgressTracker::new(
            id.clone(),
            total_bytes,
            Duration::from_millis(config.progress_emit_interval),
            Duration::from_secs(config.speed_window_size),
        ));

        // 创建 SFTP 处理器
        let handler = SftpHandler::new(sftp);

        // 克隆需要的变量
        let cancel_token = task.cancel_token.clone();
        let task_state = task.state.clone();
        let task_id = id.clone();
        let chunk_size = config.chunk_size;

        // 在后台任务中执行传输
        tokio::spawn(async move {
            let result = match transfer_type {
                TransferType::Upload { local_path, remote_path } => {
                    handler.upload_chunked(
                        local_path,
                        remote_path,
                        chunk_size,
                        progress_tracker,
                        cancel_token,
                        &app_handle,
                    ).await.map_err(|e| e.user_message())
                }
                TransferType::Download { remote_path, local_path } => {
                    handler.download_chunked(
                        remote_path,
                        local_path,
                        chunk_size,
                        progress_tracker,
                        cancel_token,
                        &app_handle,
                    ).await.map_err(|e| e.user_message())
                }
            };

            // 更新任务状态
            match result {
                Ok(_) => {
                    *lock_or_recover(&task_state) = TransferState::Completed;
                }
                Err(e) => {
                    *lock_or_recover(&task_state) = TransferState::Failed {
                        error: e.clone(),
                    };

                    // 发送错误事件
                    let _ = app_handle.emit(
                        "transfer://error",
                        ErrorEvent {
                            id: task_id.clone(),
                            error: e,
                        },
                    );
                }
            }

            // 延迟后移除任务
            tokio::time::sleep(Duration::from_secs(3)).await;
            lock_or_recover(&active_tasks).remove(&task_id);

            // 通知调度器检查队列
            if let Some(tx) = scheduler_tx {
                let _ = tx.send(());
            }
        });

        Ok(())
    }

    /// 将传输任务加入队列（不会立即启动）
    pub fn enqueue_transfer(
        &self,
        id: String,
        transfer_type: TransferType,
        connection_id: String,
        sftp_session: Arc<SftpSession>,
        total_bytes: u64,
    ) {
        let pending = PendingTransfer {
            id,
            transfer_type,
            connection_id,
            sftp_session,
            total_bytes,
        };

        lock_or_recover(&self.pending_queue).push_back(pending);

        // 通知调度器检查队列
        if let Some(tx) = &self.scheduler_tx {
            let _ = tx.send(());
        }
    }

    /// 获取队列状态（活动任务数，待处理任务数）
    pub fn get_queue_status(&self) -> (usize, usize) {
        let active = lock_or_recover(&self.active_tasks).len();
        let pending = lock_or_recover(&self.pending_queue).len();
        (active, pending)
    }

    /// 开始上传任务（委托给 execute_transfer）
    pub async fn start_upload(
        &self,
        id: String,
        local_path: PathBuf,
        remote_path: String,
        sftp: Arc<SftpSession>,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        let metadata = tokio::fs::metadata(&local_path)
            .await
            .map_err(|e| format!("Failed to get file metadata: {}", e))?;

        Self::execute_transfer(
            id,
            TransferType::Upload { local_path, remote_path },
            sftp,
            metadata.len(),
            self.active_tasks.clone(),
            self.config.clone(),
            app_handle,
            self.scheduler_tx.clone(),
        ).await
    }

    /// 开始下载任务（委托给 execute_transfer）
    pub async fn start_download(
        &self,
        id: String,
        remote_path: String,
        local_path: PathBuf,
        sftp: Arc<SftpSession>,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        let metadata = sftp.metadata(&remote_path)
            .await
            .map_err(|e| format!("Failed to get remote file metadata: {}", e))?;

        Self::execute_transfer(
            id,
            TransferType::Download { remote_path, local_path },
            sftp,
            metadata.size.unwrap_or(0),
            self.active_tasks.clone(),
            self.config.clone(),
            app_handle,
            self.scheduler_tx.clone(),
        ).await
    }

    /// 暂停任务
    pub fn pause_task(&self, id: &str) -> Result<(), String> {
        let tasks = lock_or_recover(&self.active_tasks);
        let task = tasks.get(id)
            .ok_or_else(|| format!("Task not found: {}", id))?;

        let mut state = lock_or_recover(&task.state);

        // 只有运行中的任务可以暂停
        if let TransferState::Running { offset } = *state {
            *state = TransferState::Paused { offset };
            task.cancel_token.cancel();
            Ok(())
        } else {
            Err(format!("Task {} is not running", id))
        }
    }

    /// 恢复任务
    pub async fn resume_task(
        &self,
        id: &str,
        sftp: Arc<SftpSession>,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        let task = {
            let tasks = lock_or_recover(&self.active_tasks);
            tasks.get(id)
                .ok_or_else(|| format!("Task not found: {}", id))?
                .clone()
        };

        let offset = {
            let mut state = lock_or_recover(&task.state);

            // 只有暂停的任务可以恢复
            if let TransferState::Paused { offset } = *state {
                *state = TransferState::Running { offset };
                offset
            } else {
                return Err(format!("Task {} is not paused", id));
            }
        };

        // 创建新的取消令牌
        let new_cancel_token = CancellationToken::new();

        // 创建进度跟踪器
        let progress_tracker = Arc::new(ProgressTracker::new(
            id.to_string(),
            task.total_bytes,
            Duration::from_millis(self.config.progress_emit_interval),
            Duration::from_secs(self.config.speed_window_size),
        ));

        // 创建 SFTP 处理器
        let handler = SftpHandler::new(sftp);

        // 克隆需要的变量
        let task_id = id.to_string();
        let task_type = task.task_type.clone();
        let task_state = task.state.clone();
        let active_tasks = self.active_tasks.clone();
        let chunk_size = self.config.chunk_size;

        // 在后台任务中执行恢复
        tokio::spawn(async move {
            let result = match task_type {
                TransferType::Upload { local_path, remote_path } => {
                    handler.resume_upload(
                        local_path,
                        remote_path,
                        offset,
                        chunk_size,
                        progress_tracker,
                        new_cancel_token,
                        &app_handle,
                    ).await
                }
                TransferType::Download { remote_path, local_path } => {
                    handler.resume_download(
                        remote_path,
                        local_path,
                        offset,
                        chunk_size,
                        progress_tracker,
                        new_cancel_token,
                        &app_handle,
                    ).await
                }
            };

            // 更新任务状态
            match result {
                Ok(_) => {
                    *lock_or_recover(&task_state) = TransferState::Completed;
                }
                Err(e) => {
                    *lock_or_recover(&task_state) = TransferState::Failed {
                        error: e.user_message(),
                    };

                    // 发送错误事件
                    let _ = app_handle.emit(
                        "transfer://error",
                        ErrorEvent {
                            id: task_id.clone(),
                            error: e.user_message(),
                        },
                    );
                }
            }

            // 从活动任务列表中移除
            tokio::time::sleep(Duration::from_secs(3)).await;
            lock_or_recover(&active_tasks).remove(&task_id);
        });

        Ok(())
    }

    /// 取消任务
    pub fn cancel_task(&self, id: &str) -> Result<(), String> {
        let mut tasks = lock_or_recover(&self.active_tasks);
        let task = tasks.remove(id)
            .ok_or_else(|| format!("Task not found: {}", id))?;

        // 取消任务
        task.cancel_token.cancel();

        // 清理文件
        match &task.task_type {
            TransferType::Upload { remote_path, .. } => {
                log::warn!("Remote file cleanup for cancelled upload: {}", remote_path);
            }
            TransferType::Download { local_path, .. } => {
                let _ = std::fs::remove_file(local_path);
            }
        }

        Ok(())
    }

    /// 获取活动任务数量
    #[allow(dead_code)]
    pub fn active_task_count(&self) -> usize {
        lock_or_recover(&self.active_tasks).len()
    }

    /// 获取任务状态
    #[allow(dead_code)]
    pub fn get_task_state(&self, id: &str) -> Option<TransferState> {
        let tasks = lock_or_recover(&self.active_tasks);
        tasks.get(id).map(|task| lock_or_recover(&task.state).clone())
    }
}
