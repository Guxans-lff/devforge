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
        // 确保资源被清理
        let state = self.state.lock().unwrap();
        if matches!(*state, TransferState::Running { .. } | TransferState::Paused { .. }) {
            // 取消任务
            self.cancel_token.cancel();
            
            // 清理临时文件
            if let TransferType::Download { local_path, .. } = &self.task_type {
                let _ = std::fs::remove_file(local_path);
            }
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
            // 检查是否可以启动更多任务
            let active_count = active_tasks.lock().unwrap().len();
            if active_count >= config.max_concurrent_tasks {
                break;
            }

            // 获取下一个待处理任务
            let pending = {
                let mut queue = pending_queue.lock().unwrap();
                queue.pop_front()
            };

            let Some(pending) = pending else {
                break;
            };

            // 启动任务
            match pending.transfer_type {
                TransferType::Upload { local_path, remote_path } => {
                    let _ = Self::execute_upload(
                        pending.id,
                        local_path,
                        remote_path,
                        pending.sftp_session,
                        pending.total_bytes,
                        active_tasks.clone(),
                        config.clone(),
                        app_handle.clone(),
                        None, // 不需要在这里传递 scheduler_tx，因为任务完成后会自动触发
                    ).await;
                }
                TransferType::Download { remote_path, local_path } => {
                    let _ = Self::execute_download(
                        pending.id,
                        remote_path,
                        local_path,
                        pending.sftp_session,
                        pending.total_bytes,
                        active_tasks.clone(),
                        config.clone(),
                        app_handle.clone(),
                        None, // 不需要在这里传递 scheduler_tx，因为任务完成后会自动触发
                    ).await;
                }
            }
        }
    }

    /// 执行上传任务
    #[allow(clippy::too_many_arguments)]
    async fn execute_upload(
        id: String,
        local_path: PathBuf,
        remote_path: String,
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
            TransferType::Upload {
                local_path: local_path.clone(),
                remote_path: remote_path.clone(),
            },
            total_bytes,
        ));

        // 添加到活动任务列表
        {
            let mut tasks = active_tasks.lock().unwrap();
            tasks.insert(id.clone(), task.clone());
        }

        // 更新状态为运行中
        *task.state.lock().unwrap() = TransferState::Running { offset: 0 };

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

        // 在后台任务中执行上传
        tokio::spawn(async move {
            let result = handler.upload_chunked(
                local_path,
                remote_path.clone(),
                chunk_size,
                progress_tracker,
                cancel_token,
                &app_handle,
            ).await;

            // 更新任务状态
            match result {
                Ok(_) => {
                    *task_state.lock().unwrap() = TransferState::Completed;
                }
                Err(e) => {
                    *task_state.lock().unwrap() = TransferState::Failed {
                        error: e.to_string(),
                    };

                    // 发送错误事件
                    let _ = app_handle.emit(
                        "transfer:error",
                        ErrorEvent {
                            id: task_id.clone(),
                            error: e.to_string(),
                        },
                    );
                }
            }

            // 延迟后移除任务
            tokio::time::sleep(Duration::from_secs(3)).await;
            active_tasks.lock().unwrap().remove(&task_id);

            // 通知调度器检查队列
            if let Some(tx) = scheduler_tx {
                let _ = tx.send(());
            }
        });

        Ok(())
    }

    /// 执行下载任务
    #[allow(clippy::too_many_arguments)]
    async fn execute_download(
        id: String,
        remote_path: String,
        local_path: PathBuf,
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
            TransferType::Download {
                remote_path: remote_path.clone(),
                local_path: local_path.clone(),
            },
            total_bytes,
        ));

        // 添加到活动任务列表
        {
            let mut tasks = active_tasks.lock().unwrap();
            tasks.insert(id.clone(), task.clone());
        }

        // 更新状态为运行中
        *task.state.lock().unwrap() = TransferState::Running { offset: 0 };

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

        // 在后台任务中执行下载
        tokio::spawn(async move {
            let result = handler.download_chunked(
                remote_path.clone(),
                local_path,
                chunk_size,
                progress_tracker,
                cancel_token,
                &app_handle,
            ).await;

            // 更新任务状态
            match result {
                Ok(_) => {
                    *task_state.lock().unwrap() = TransferState::Completed;
                }
                Err(e) => {
                    *task_state.lock().unwrap() = TransferState::Failed {
                        error: e.to_string(),
                    };

                    // 发送错误事件
                    let _ = app_handle.emit(
                        "transfer:error",
                        ErrorEvent {
                            id: task_id.clone(),
                            error: e.to_string(),
                        },
                    );
                }
            }

            // 延迟后移除任务
            tokio::time::sleep(Duration::from_secs(3)).await;
            active_tasks.lock().unwrap().remove(&task_id);

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

        self.pending_queue.lock().unwrap().push_back(pending);

        // 通知调度器检查队列
        if let Some(tx) = &self.scheduler_tx {
            let _ = tx.send(());
        }
    }

    /// 获取队列状态（活动任务数，待处理任务数）
    pub fn get_queue_status(&self) -> (usize, usize) {
        let active = self.active_tasks.lock().unwrap().len();
        let pending = self.pending_queue.lock().unwrap().len();
        (active, pending)
    }
    
    /// 开始上传任务
    pub async fn start_upload(
        &self,
        id: String,
        local_path: PathBuf,
        remote_path: String,
        sftp: Arc<SftpSession>,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        // 获取文件大小
        let metadata = tokio::fs::metadata(&local_path)
            .await
            .map_err(|e| format!("Failed to get file metadata: {}", e))?;
        let total_bytes = metadata.len();
        
        // 创建任务
        let task = Arc::new(TransferTask::new(
            id.clone(),
            TransferType::Upload {
                local_path: local_path.clone(),
                remote_path: remote_path.clone(),
            },
            total_bytes,
        ));
        
        // 添加到活动任务列表
        {
            let mut tasks = self.active_tasks.lock().unwrap();
            tasks.insert(id.clone(), task.clone());
        }
        
        // 更新状态为运行中
        *task.state.lock().unwrap() = TransferState::Running { offset: 0 };
        
        // 创建进度跟踪器
        let progress_tracker = Arc::new(ProgressTracker::new(
            id.clone(),
            total_bytes,
            Duration::from_millis(self.config.progress_emit_interval),
            Duration::from_secs(self.config.speed_window_size),
        ));
        
        // 创建 SFTP 处理器
        let handler = SftpHandler::new(sftp);
        
        // 克隆需要的变量
        let cancel_token = task.cancel_token.clone();
        let task_state = task.state.clone();
        let active_tasks = self.active_tasks.clone();
        let chunk_size = self.config.chunk_size;
        let scheduler_tx = self.scheduler_tx.clone();

        // 在后台任务中执行上传
        tokio::spawn(async move {
            let result = handler.upload_chunked(
                local_path,
                remote_path.clone(),
                chunk_size,
                progress_tracker,
                cancel_token,
                &app_handle,
            ).await;

            // 更新任务状态
            match result {
                Ok(_) => {
                    *task_state.lock().unwrap() = TransferState::Completed;
                }
                Err(e) => {
                    *task_state.lock().unwrap() = TransferState::Failed {
                        error: e.user_message(),
                    };

                    // 发送错误事件
                    let _ = app_handle.emit(
                        "transfer://error",
                        ErrorEvent {
                            id: id.clone(),
                            error: e.user_message(),
                        },
                    );
                }
            }

            // 从活动任务列表中移除
            tokio::time::sleep(Duration::from_secs(3)).await;
            active_tasks.lock().unwrap().remove(&id);

            // 通知调度器检查队列
            if let Some(tx) = scheduler_tx {
                let _ = tx.send(());
            }
        });
        
        Ok(())
    }
    
    /// 开始下载任务
    pub async fn start_download(
        &self,
        id: String,
        remote_path: String,
        local_path: PathBuf,
        sftp: Arc<SftpSession>,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        // 获取远程文件大小
        let metadata = sftp.metadata(&remote_path)
            .await
            .map_err(|e| format!("Failed to get remote file metadata: {}", e))?;
        let total_bytes = metadata.size.unwrap_or(0);
        
        // 创建任务
        let task = Arc::new(TransferTask::new(
            id.clone(),
            TransferType::Download {
                remote_path: remote_path.clone(),
                local_path: local_path.clone(),
            },
            total_bytes,
        ));
        
        // 添加到活动任务列表
        {
            let mut tasks = self.active_tasks.lock().unwrap();
            tasks.insert(id.clone(), task.clone());
        }
        
        // 更新状态为运行中
        *task.state.lock().unwrap() = TransferState::Running { offset: 0 };
        
        // 创建进度跟踪器
        let progress_tracker = Arc::new(ProgressTracker::new(
            id.clone(),
            total_bytes,
            Duration::from_millis(self.config.progress_emit_interval),
            Duration::from_secs(self.config.speed_window_size),
        ));
        
        // 创建 SFTP 处理器
        let handler = SftpHandler::new(sftp);
        
        // 克隆需要的变量
        let cancel_token = task.cancel_token.clone();
        let task_state = task.state.clone();
        let active_tasks = self.active_tasks.clone();
        let chunk_size = self.config.chunk_size;
        let scheduler_tx = self.scheduler_tx.clone();

        // 在后台任务中执行下载
        tokio::spawn(async move {
            let result = handler.download_chunked(
                remote_path,
                local_path,
                chunk_size,
                progress_tracker,
                cancel_token,
                &app_handle,
            ).await;

            // 更新任务状态
            match result {
                Ok(_) => {
                    *task_state.lock().unwrap() = TransferState::Completed;
                }
                Err(e) => {
                    *task_state.lock().unwrap() = TransferState::Failed {
                        error: e.user_message(),
                    };

                    // 发送错误事件
                    let _ = app_handle.emit(
                        "transfer://error",
                        ErrorEvent {
                            id: id.clone(),
                            error: e.user_message(),
                        },
                    );
                }
            }

            // 从活动任务列表中移除
            tokio::time::sleep(Duration::from_secs(3)).await;
            active_tasks.lock().unwrap().remove(&id);

            // 通知调度器检查队列
            if let Some(tx) = scheduler_tx {
                let _ = tx.send(());
            }
        });
        
        Ok(())
    }
    
    /// 暂停任务
    pub fn pause_task(&self, id: &str) -> Result<(), String> {
        let tasks = self.active_tasks.lock().unwrap();
        let task = tasks.get(id)
            .ok_or_else(|| format!("Task not found: {}", id))?;
        
        let mut state = task.state.lock().unwrap();
        
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
            let tasks = self.active_tasks.lock().unwrap();
            tasks.get(id)
                .ok_or_else(|| format!("Task not found: {}", id))?
                .clone()
        };
        
        let offset = {
            let mut state = task.state.lock().unwrap();
            
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
                    *task_state.lock().unwrap() = TransferState::Completed;
                }
                Err(e) => {
                    *task_state.lock().unwrap() = TransferState::Failed {
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
            active_tasks.lock().unwrap().remove(&task_id);
        });
        
        Ok(())
    }
    
    /// 取消任务
    pub fn cancel_task(&self, id: &str) -> Result<(), String> {
        let mut tasks = self.active_tasks.lock().unwrap();
        let task = tasks.remove(id)
            .ok_or_else(|| format!("Task not found: {}", id))?;
        
        // 取消任务
        task.cancel_token.cancel();
        
        // 清理文件
        match &task.task_type {
            TransferType::Upload { remote_path, .. } => {
                // 注意：这里无法异步删除远程文件，需要在 SFTP 处理器中处理
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
        self.active_tasks.lock().unwrap().len()
    }

    /// 获取任务状态
    #[allow(dead_code)]
    pub fn get_task_state(&self, id: &str) -> Option<TransferState> {
        let tasks = self.active_tasks.lock().unwrap();
        tasks.get(id).map(|task| task.state.lock().unwrap().clone())
    }
}
