use serde::{Deserialize, Serialize};
use sysinfo::{Disks, Networks, ProcessesToUpdate, System};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub cpu_usage: f32,
    pub cpu_cores: Vec<f32>,
    pub memory_total: u64,
    pub memory_used: u64,
    pub memory_available: u64,
    pub swap_total: u64,
    pub swap_used: u64,
    pub disks: Vec<DiskInfo>,
    pub networks: Vec<NetworkInfo>,
    pub system_name: String,
    pub os_version: String,
    pub host_name: String,
    pub uptime: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskInfo {
    pub name: String,
    pub mount_point: String,
    pub total_space: u64,
    pub available_space: u64,
    pub used_space: u64,
    pub file_system: String,
    pub is_removable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInfo {
    pub name: String,
    pub received: u64,
    pub transmitted: u64,
    pub received_packets: u64,
    pub transmitted_packets: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_usage: f32,
    pub memory: u64,
    pub memory_percent: f32,
    pub status: String,
    pub run_time: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingResult {
    pub host: String,
    pub success: bool,
    pub latency_ms: Option<f64>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    let mut sys = System::new_all();
    sys.refresh_all();

    // CPU
    std::thread::sleep(std::time::Duration::from_millis(200));
    sys.refresh_cpu_all();
    let cpu_usage = sys.global_cpu_usage();
    let cpu_cores: Vec<f32> = sys.cpus().iter().map(|cpu| cpu.cpu_usage()).collect();

    // Memory
    let memory_total = sys.total_memory();
    let memory_used = sys.used_memory();
    let memory_available = sys.available_memory();
    let swap_total = sys.total_swap();
    let swap_used = sys.used_swap();

    // Disks
    let disks = Disks::new_with_refreshed_list();
    let disk_list: Vec<DiskInfo> = disks
        .iter()
        .map(|disk| {
            let total = disk.total_space();
            let available = disk.available_space();
            DiskInfo {
                name: disk.name().to_string_lossy().to_string(),
                mount_point: disk.mount_point().to_string_lossy().to_string(),
                total_space: total,
                available_space: available,
                used_space: total - available,
                file_system: disk.file_system().to_string_lossy().to_string(),
                is_removable: disk.is_removable(),
            }
        })
        .collect();

    // Networks
    let networks = Networks::new_with_refreshed_list();
    let network_list: Vec<NetworkInfo> = networks
        .iter()
        .map(|(name, data)| NetworkInfo {
            name: name.to_string(),
            received: data.total_received(),
            transmitted: data.total_transmitted(),
            received_packets: data.total_packets_received(),
            transmitted_packets: data.total_packets_transmitted(),
        })
        .collect();

    Ok(SystemInfo {
        cpu_usage,
        cpu_cores,
        memory_total,
        memory_used,
        memory_available,
        swap_total,
        swap_used,
        disks: disk_list,
        networks: network_list,
        system_name: System::name().unwrap_or_default(),
        os_version: System::os_version().unwrap_or_default(),
        host_name: System::host_name().unwrap_or_default(),
        uptime: System::uptime(),
    })
}

#[tauri::command]
pub async fn get_processes() -> Result<Vec<ProcessInfo>, String> {
    let mut sys = System::new_all();
    sys.refresh_all();

    std::thread::sleep(std::time::Duration::from_millis(200));
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let total_memory = sys.total_memory() as f32;
    let mut processes: Vec<ProcessInfo> = sys
        .processes()
        .iter()
        .map(|(pid, process)| {
            let memory = process.memory();
            ProcessInfo {
                pid: pid.as_u32(),
                name: process.name().to_string_lossy().to_string(),
                cpu_usage: process.cpu_usage(),
                memory,
                memory_percent: if total_memory > 0.0 {
                    (memory as f32 / total_memory) * 100.0
                } else {
                    0.0
                },
                status: format!("{:?}", process.status()),
                run_time: process.run_time(),
            }
        })
        .collect();

    processes.sort_by(|a, b| b.cpu_usage.partial_cmp(&a.cpu_usage).unwrap_or(std::cmp::Ordering::Equal));
    Ok(processes)
}

#[tauri::command]
pub async fn kill_process(pid: u32) -> Result<bool, String> {
    let mut sys = System::new_all();
    sys.refresh_all();

    let process_pid = sysinfo::Pid::from_u32(pid);
    if let Some(process) = sys.process(process_pid) {
        Ok(process.kill())
    } else {
        Err(format!("Process with PID {} not found", pid))
    }
}

#[tauri::command]
pub async fn ping_host(host: String) -> Result<PingResult, String> {
    let count = 4;
    let timeout = 5;

    #[cfg(target_os = "windows")]
    let cmd = format!("ping -n {} -w {} {}", count, timeout * 1000, host);

    #[cfg(not(target_os = "windows"))]
    let cmd = format!("ping -c {} -W {} {}", count, timeout, host);

    match std::process::Command::new("sh")
        .arg("-c")
        .arg(&cmd)
        .output()
    {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if output.status.success() {
                // Parse average latency
                let latency = parse_ping_latency(&stdout);
                Ok(PingResult {
                    host,
                    success: true,
                    latency_ms: latency,
                    error: None,
                })
            } else {
                Ok(PingResult {
                    host,
                    success: false,
                    latency_ms: None,
                    error: Some(stdout.to_string()),
                })
            }
        }
        Err(e) => Ok(PingResult {
            host,
            success: false,
            latency_ms: None,
            error: Some(e.to_string()),
        }),
    }
}

fn parse_ping_latency(output: &str) -> Option<f64> {
    // Try to parse "Average = Xms" (Windows) or "avg = X/Y/Z ms" (Linux/Mac)
    for line in output.lines() {
        if line.contains("Average =") || line.contains("average =") {
            if let Some(ms_str) = line.split("= ").last() {
                if let Some(ms) = ms_str.split("ms").next() {
                    if let Ok(latency) = ms.trim().parse::<f64>() {
                        return Some(latency);
                    }
                }
            }
        }
        if line.contains("avg") && line.contains('/') {
            // Format: min/avg/max/mdev = X.X/X.X/X.X/X.X ms
            if let Some(stats) = line.split("= ").last() {
                if let Some(avg) = stats.split('/').nth(1) {
                    if let Ok(latency) = avg.trim().parse::<f64>() {
                        return Some(latency);
                    }
                }
            }
        }
    }
    None
}
