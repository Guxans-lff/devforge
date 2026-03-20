use crate::services::crash_reporter;

/// 获取崩溃日志列表
#[tauri::command]
pub fn list_crash_logs() -> Vec<crash_reporter::CrashLogEntry> {
    crash_reporter::list_crash_logs()
}

/// 读取指定崩溃日志内容
#[tauri::command]
pub fn read_crash_log(filename: String) -> Result<String, String> {
    crash_reporter::read_crash_log(&filename)
        .ok_or_else(|| "日志文件不存在或无法读取".to_string())
}

/// 清除所有崩溃日志
#[tauri::command]
pub fn clear_crash_logs() -> usize {
    crash_reporter::clear_crash_logs()
}

/// 写入前端错误日志（追加模式，写入 AppData/devforge/logs/error_YYYYMMDD.log）
#[tauri::command]
pub fn write_error_log(content: String) -> Result<(), String> {
    crash_reporter::append_error_log(&content)
        .map_err(|e| format!("写入错误日志失败: {}", e))
}
