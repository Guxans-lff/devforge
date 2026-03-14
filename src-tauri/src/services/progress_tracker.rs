#![allow(dead_code)]

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::models::transfer::ProgressEvent;

/// 速度样本 - 用于计算传输速度
#[derive(Debug, Clone)]
struct SpeedSample {
    timestamp: Instant,
    bytes: u64,
}

/// 进度跟踪器 - 跟踪传输进度并计算速度
pub struct ProgressTracker {
    task_id: String,
    total_bytes: u64,
    transferred_bytes: Arc<AtomicU64>,
    speed_window: Arc<Mutex<VecDeque<SpeedSample>>>,
    last_emit_time: Arc<Mutex<Instant>>,
    emit_interval: Duration,
    speed_window_duration: Duration,
}

impl ProgressTracker {
    /// 创建新的进度跟踪器
    /// 
    /// # 参数
    /// * `task_id` - 任务 ID
    /// * `total_bytes` - 文件总字节数
    /// * `emit_interval` - 进度事件发送间隔
    /// * `speed_window_duration` - 速度计算窗口大小
    pub fn new(
        task_id: String,
        total_bytes: u64,
        emit_interval: Duration,
        speed_window_duration: Duration,
    ) -> Self {
        Self::with_atomic(
            task_id,
            total_bytes,
            emit_interval,
            speed_window_duration,
            Arc::new(AtomicU64::new(0)),
        )
    }

    pub fn with_atomic(
        task_id: String,
        total_bytes: u64,
        emit_interval: Duration,
        speed_window_duration: Duration,
        transferred_bytes: Arc<AtomicU64>,
    ) -> Self {
        Self {
            task_id,
            total_bytes,
            transferred_bytes,
            speed_window: Arc::new(Mutex::new(VecDeque::new())),
            last_emit_time: Arc::new(Mutex::new(Instant::now())),
            emit_interval,
            speed_window_duration,
        }
    }
    
    /// 更新已传输字节数
    /// 
    /// # 参数
    /// * `bytes` - 新传输的字节数
    pub fn update(&self, bytes: u64) {
        let current = self.transferred_bytes.fetch_add(bytes, Ordering::Relaxed) + bytes;
        
        // 添加速度样本
        let mut window = self.speed_window.lock().unwrap();
        window.push_back(SpeedSample {
            timestamp: Instant::now(),
            bytes: current,
        });
        
        // 清理过期样本
        let now = Instant::now();
        window.retain(|sample| {
            now.duration_since(sample.timestamp) <= self.speed_window_duration
        });
    }
    
    /// 计算当前速度（字节/秒）
    pub fn calculate_speed(&self) -> u64 {
        let window = self.speed_window.lock().unwrap();
        
        // 如果没有样本,返回 0
        if window.is_empty() {
            return 0;
        }
        
        // 如果只有一个样本，使用从该样本到现在的时间跨度计算
        if window.len() == 1 {
            let sample = window.front().unwrap();
            let duration = Instant::now().duration_since(sample.timestamp).as_secs_f64();
            // 在前 500ms 内，如果只有一个样本，可能还在预热，
            // 我们可以尝试根据当前已传输量和基准时间做一个估算，或者保持 0
            if duration > 0.01 {
                return 0; // 等待更多样本
            }
            return 0;
        }
        
        let oldest = window.front().unwrap();
        let newest = window.back().unwrap();
        
        let duration = newest.timestamp.duration_since(oldest.timestamp).as_secs_f64();
        let bytes = newest.bytes.saturating_sub(oldest.bytes);
        
        if duration > 0.01 {
            // 至少 10ms 的时间差才计算速度
            (bytes as f64 / duration) as u64
        } else {
            0
        }
    }
    
    /// 检查是否应该发送进度事件（节流）
    fn should_emit(&self) -> bool {
        let now = Instant::now();
        let last_emit = self.last_emit_time.lock().unwrap();
        now.duration_since(*last_emit) >= self.emit_interval
    }
    
    /// 发送进度事件（带节流）
    /// 
    /// # 参数
    /// * `app_handle` - Tauri 应用句柄
    pub fn emit_progress(&self, app_handle: &AppHandle) -> Result<(), String> {
        if self.should_emit() {
            self.emit_progress_force(app_handle)?;
        }
        Ok(())
    }
    
    /// 强制发送进度事件（忽略节流）
    /// 
    /// # 参数
    /// * `app_handle` - Tauri 应用句柄
    pub fn emit_progress_force(&self, app_handle: &AppHandle) -> Result<(), String> {
        let speed = self.calculate_speed();
        let transferred = self.transferred_bytes.load(Ordering::Relaxed);
        
        let event = ProgressEvent {
            id: self.task_id.clone(),
            transferred,
            total: self.total_bytes,
            speed,
        };
        
        log::debug!(
            "Emitting progress: id={}, transferred={}, total={}, speed={}",
            event.id, event.transferred, event.total, event.speed
        );
        
        app_handle
            .emit("transfer://progress", event)
            .map_err(|e| format!("Failed to emit progress event: {}", e))?;
        
        *self.last_emit_time.lock().unwrap() = Instant::now();
        
        Ok(())
    }
    
    /// 获取当前已传输字节数
    #[allow(dead_code)]
    pub fn transferred_bytes(&self) -> u64 {
        self.transferred_bytes.load(Ordering::Relaxed)
    }
    
    /// 获取总字节数
    #[allow(dead_code)]
    pub fn total_bytes(&self) -> u64 {
        self.total_bytes
    }
    
    /// 获取任务 ID
    pub fn task_id(&self) -> &str {
        &self.task_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    
    #[test]
    fn test_update_and_calculate_speed() {
        let tracker = ProgressTracker::new(
            "test-task".to_string(),
            1000,
            Duration::from_millis(100),
            Duration::from_secs(3),
        );
        
        // 初始速度应该为 0
        assert_eq!(tracker.calculate_speed(), 0);
        
        // 更新一些字节
        tracker.update(100);
        thread::sleep(Duration::from_millis(100));
        tracker.update(100);
        
        // 现在应该有速度了
        let speed = tracker.calculate_speed();
        assert!(speed > 0);
    }
    
    #[test]
    fn test_transferred_bytes() {
        let tracker = ProgressTracker::new(
            "test-task".to_string(),
            1000,
            Duration::from_millis(100),
            Duration::from_secs(3),
        );
        
        assert_eq!(tracker.transferred_bytes(), 0);
        
        tracker.update(100);
        assert_eq!(tracker.transferred_bytes(), 100);
        
        tracker.update(200);
        assert_eq!(tracker.transferred_bytes(), 300);
    }
    
    #[test]
    fn test_speed_window_cleanup() {
        let tracker = ProgressTracker::new(
            "test-task".to_string(),
            1000,
            Duration::from_millis(100),
            Duration::from_millis(200), // 200ms 窗口
        );
        
        // 添加一些样本
        tracker.update(100);
        thread::sleep(Duration::from_millis(100));
        tracker.update(100);
        thread::sleep(Duration::from_millis(150)); // 超过窗口时间
        tracker.update(100);
        
        // 旧样本应该被清理
        let window = tracker.speed_window.lock().unwrap();
        assert!(window.len() <= 2); // 最多保留最近的 2 个样本
    }
    
    #[test]
    fn test_should_emit_throttle() {
        let tracker = ProgressTracker::new(
            "test-task".to_string(),
            1000,
            Duration::from_millis(100),
            Duration::from_secs(3),
        );
        
        // 更新 last_emit_time 到现在
        *tracker.last_emit_time.lock().unwrap() = Instant::now();
        
        // 立即检查，应该不能发送
        assert!(!tracker.should_emit());
        
        // 等待超过间隔时间
        thread::sleep(Duration::from_millis(110));
        assert!(tracker.should_emit());
    }
}
