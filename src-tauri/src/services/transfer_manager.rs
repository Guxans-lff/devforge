use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh_sftp::client::rawsession::RawSftpSession;
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
fn lock_or_recover<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
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
    pub transferred_bytes: Arc<AtomicU64>,
}

impl TransferTask {
    pub fn new(id: String, task_type: TransferType, total_bytes: u64) -> Self {
        Self {
            id,
            task_type,
            state: Arc::new(Mutex::new(TransferState::Pending)),
            cancel_token: CancellationToken::new(),
            total_bytes,
            transferred_bytes: Arc::new(AtomicU64::new(0)),
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
    /// 用于流水线上传的 RawSftpSession（可选）
    raw_sftp: Option<Arc<RawSftpSession>>,
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
        self.scheduler_tx = Some(tx.clone());

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
                    tx.clone(),
                ).await;
            }
        });

        // 发送初始信号
        if let Some(tx) = self.scheduler_tx.as_ref() {
            let _ = tx.send(());
        }
    }

    /// 处理队列中的待处理任务
    async fn process_queue(
        active_tasks: Arc<Mutex<HashMap<String, Arc<TransferTask>>>>,
        pending_queue: Arc<Mutex<VecDeque<PendingTransfer>>>,
        config: &TransferConfig,
        app_handle: &AppHandle,
        scheduler_tx: mpsc::UnboundedSender<()>,
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
                        pending.raw_sftp,
                        pending.total_bytes,
                        active_tasks.clone(),
                        config.clone(),
                        app_handle.clone(),
                        Some(scheduler_tx.clone()),
                    ).await;
                }
                TransferType::Download { remote_path, local_path } => {
                    let _ = Self::execute_transfer(
                        pending.id,
                        TransferType::Download { remote_path, local_path },
                        pending.sftp_session,
                        pending.raw_sftp,
                        pending.total_bytes,
                        active_tasks.clone(),
                        config.clone(),
                        app_handle.clone(),
                        Some(scheduler_tx.clone()),
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
        raw_sftp: Option<Arc<RawSftpSession>>,
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

        // 创建进度跟踪器 (共享任务的原子计数器)
        let progress_tracker = Arc::new(ProgressTracker::with_atomic(
            id.clone(),
            total_bytes,
            Duration::from_millis(config.progress_emit_interval),
            Duration::from_secs(config.speed_window_size),
            task.transferred_bytes.clone(),
        ));

        // 创建 SFTP 处理器（上传时使用流水线模式）
        let handler = if let Some(raw) = raw_sftp {
            SftpHandler::with_raw_session(sftp, raw)
        } else {
            SftpHandler::new(sftp)
        };

        // 克隆需要的变量
        let cancel_token = task.cancel_token.clone();
        let task_state = task.state.clone();
        let task_id = id.clone();
        let chunk_size = config.chunk_size;

        // 在后台任务中执行传输
        let bg_cancel_token = cancel_token.clone();
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

            log::debug!("[Transfer] Task {} background work finished, result: {:?}", task_id, result.is_ok());

            // 更新任务状态
            {
                let mut state = lock_or_recover(&task_state);
                
                // 关键防御：如果任务已经因为暂停或取消而被外部打断
                // 或者已经通过 resume 启动了新一代任务，则不处理结果
                if bg_cancel_token.is_cancelled() || matches!(*state, TransferState::Paused { .. }) {
                    return;
                }

                match result {
                    Ok(_) => {
                        *state = TransferState::Completed;
                    }
                    Err(e) => {
                        *state = TransferState::Failed { error: e.clone() };
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
            }

            // 非暂停任务：延迟后移除
            tokio::time::sleep(Duration::from_secs(3)).await;
            
            let mut tasks = lock_or_recover(&active_tasks);
            if let Some(current_task) = tasks.get(&task_id) {
                // 关键修复：只有当活动列表中的任务依然是当前这个 Arc 实例时，才执行移除
                // 防止旧任务的清理逻辑误杀了刚刚通过 resume 启动的新任务实例
                if Arc::ptr_eq(current_task, &task) {
                    tasks.remove(&task_id);
                }
            }

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
        raw_sftp: Option<Arc<RawSftpSession>>,
        total_bytes: u64,
    ) {
        let pending = PendingTransfer {
            id,
            transfer_type,
            connection_id,
            sftp_session,
            raw_sftp,
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
        raw_sftp: Option<Arc<RawSftpSession>>,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        let metadata = tokio::fs::metadata(&local_path)
            .await
            .map_err(|e| format!("Failed to get file metadata: {}", e))?;

        Self::execute_transfer(
            id,
            TransferType::Upload { local_path, remote_path },
            sftp,
            raw_sftp,
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
            None, // 下载不需要流水线
            metadata.size.unwrap_or(0),
            self.active_tasks.clone(),
            self.config.clone(),
            app_handle,
            self.scheduler_tx.clone(),
        ).await
    }

    /// 暂停任务
    pub fn pause_task(&self, id: &str, app_handle: &AppHandle) -> Result<(), String> {
        let tasks = lock_or_recover(&self.active_tasks);
        let task = tasks.get(id)
            .ok_or_else(|| format!("Task not found: {}", id))?;

        let mut state = lock_or_recover(&task.state);

        // 只有运行中的任务可以暂停
        if let TransferState::Running { .. } = *state {
            let offset = task.transferred_bytes.load(Ordering::SeqCst);
            *state = TransferState::Paused { offset };
            task.cancel_token.cancel();
            
            // 全网通知：我停了
            let _ = app_handle.emit("transfer://paused", id);
            Ok(())
        } else {
            Err(format!("Task {} is not running", id))
        }
    }

    /// 取消任务
    pub fn cancel_task(&self, id: &str, app_handle: &AppHandle) -> Result<(), String> {
        let mut tasks = lock_or_recover(&self.active_tasks);
        let task = tasks.remove(id)
            .ok_or_else(|| format!("Task not found: {}", id))?;

        let mut state = lock_or_recover(&task.state);
        *state = TransferState::Failed { error: "已取消".to_string() };
        task.cancel_token.cancel();

        // 清理文件
        match &task.task_type {
            TransferType::Upload { .. } => {
                // 远程文件清理通常在 execute_transfer 的 Err 分支处理
            }
            TransferType::Download { local_path, .. } => {
                let _ = std::fs::remove_file(local_path);
            }
        }

        // 全网通知：我废了
        let _ = app_handle.emit("transfer://cancelled", id);
        Ok(())
    }

    /// 恢复任务
    pub async fn resume_task(
        &self,
        id: &str,
        sftp: Arc<SftpSession>,
        raw_sftp: Option<Arc<RawSftpSession>>,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        // 创建新的取消令牌
        let new_cancel_token = CancellationToken::new();

        let (task_type, task_state, total_bytes, offset, task_transferred_bytes, new_task) = {
            let mut tasks = lock_or_recover(&self.active_tasks);
            let task = tasks.get(id)
                .ok_or_else(|| format!("Task not found: {}", id))?;

            let offset = {
                let mut state = lock_or_recover(&task.state);
                if let TransferState::Paused { offset } = *state {
                    *state = TransferState::Running { offset };
                    offset
                } else {
                    return Err(format!("Task {} is not paused", id));
                }
            };

            let result = (
                task.task_type.clone(),
                task.state.clone(),
                task.total_bytes,
                offset,
                task.transferred_bytes.clone(),
            );

            // 替换 task 实例以更新 cancel_token，保证后续 pause_task 能取消恢复后的任务
            let nt = Arc::new(TransferTask {
                id: id.to_string(),
                task_type: task.task_type.clone(),
                state: task.state.clone(),
                cancel_token: new_cancel_token.clone(),
                total_bytes: task.total_bytes,
                transferred_bytes: task.transferred_bytes.clone(),
            });
            tasks.insert(id.to_string(), nt.clone());

            (result.0, result.1, result.2, result.3, result.4, nt)
        };

        // 创建进度跟踪器 (共享任务的原子计数器)
        let progress_tracker = Arc::new(ProgressTracker::with_atomic(
            id.to_string(),
            total_bytes,
            Duration::from_millis(self.config.progress_emit_interval),
            Duration::from_secs(self.config.speed_window_size),
            task_transferred_bytes,
        ));

        // 创建 SFTP 处理器
        let handler = if let Some(raw) = raw_sftp {
            SftpHandler::with_raw_session(sftp, raw)
        } else {
            SftpHandler::new(sftp)
        };

        // 克隆需要的变量
        let task_id = id.to_string();
        let active_tasks = self.active_tasks.clone();
        let chunk_size = self.config.chunk_size;
        let scheduler_tx = self.scheduler_tx.clone();

        // 在后台任务中执行恢复
        let bg_task = new_task.clone();
        let bg_cancel_token = new_cancel_token.clone();
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
            {
                let mut state = lock_or_recover(&task_state);
                
                // 关键防御：如果本代任务已被取消或再次暂停
                if bg_cancel_token.is_cancelled() || matches!(*state, TransferState::Paused { .. }) {
                    return; 
                }

                match result {
                    Ok(_) => {
                        *state = TransferState::Completed;
                    }
                    Err(e) => {
                        *state = TransferState::Failed {
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
            }

            // 非暂停任务：延迟后移除
            tokio::time::sleep(Duration::from_secs(3)).await;

            let mut tasks = lock_or_recover(&active_tasks);
            if let Some(current_task) = tasks.get(&task_id) {
                // 关键修复：只有当活动列表中的任务依然是当前这个 Arc 实例时，才执行移除
                if Arc::ptr_eq(current_task, &bg_task) {
                    tasks.remove(&task_id);
                }
            }
            drop(tasks);

            // 通知调度器检查队列，触发等待中的任务
            if let Some(tx) = scheduler_tx {
                let _ = tx.send(());
            }
        });

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
