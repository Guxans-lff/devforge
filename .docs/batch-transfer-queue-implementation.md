# Batch Transfer Queue Implementation

## Overview

Implemented a task queue system with concurrency control for the DevForge file transfer manager. The system now supports queuing multiple file transfers and automatically manages concurrent execution based on configured limits.

## Changes Made

### 1. TransferManager Updates (`src-tauri/src/services/transfer_manager.rs`)

#### New Data Structures

- **PendingTransfer**: Represents a queued transfer waiting to execute
  - Contains: id, transfer_type, connection_id, sftp_session, total_bytes

#### New Fields in TransferManager

- `pending_queue: Arc<Mutex<VecDeque<PendingTransfer>>>` - FIFO queue for pending tasks
- `scheduler_tx: Option<mpsc::UnboundedSender<()>>` - Channel to signal the scheduler

#### New Methods

- **start_scheduler(&mut self, app_handle: AppHandle)**
  - Initializes the background queue scheduler
  - Must be called once during application startup
  - Spawns a long-running tokio task that processes the queue

- **process_queue(...)** (private, async)
  - Checks if more tasks can run (based on max_concurrent_tasks)
  - Pops tasks from pending_queue and starts them
  - Runs in a loop until queue is empty or concurrency limit reached

- **execute_upload(...)** (private, async)
  - Extracted upload logic from start_upload
  - Creates task, adds to active_tasks, spawns background execution
  - Signals scheduler when task completes

- **execute_download(...)** (private, async)
  - Extracted download logic from start_download
  - Creates task, adds to active_tasks, spawns background execution
  - Signals scheduler when task completes

- **enqueue_transfer(...)**
  - Adds a transfer to the pending queue
  - Signals scheduler to check for available slots
  - Does NOT start the transfer immediately

- **get_queue_status() -> (usize, usize)**
  - Returns (active_count, pending_count)
  - Useful for UI to display queue status

#### Modified Methods

- **start_upload** and **start_download**
  - Now signal the scheduler when tasks complete
  - This allows queued tasks to start automatically when slots become available

### 2. New Tauri Commands (`src-tauri/src/commands/transfer.rs`)

#### enqueue_batch_upload

```rust
pub async fn enqueue_batch_upload(
    connection_id: String,
    files: Vec<(String, String, u64)>, // (local_path, remote_path, size)
    transfer_manager: State<'_, TransferManagerState>,
    sftp_engine: State<'_, SftpEngineState>,
) -> Result<Vec<String>, String>
```

- Accepts multiple files to upload
- Generates UUID for each task
- Adds all tasks to the queue
- Returns list of task IDs

#### enqueue_batch_download

```rust
pub async fn enqueue_batch_download(
    connection_id: String,
    files: Vec<(String, String, u64)>, // (remote_path, local_path, size)
    transfer_manager: State<'_, TransferManagerState>,
    sftp_engine: State<'_, SftpEngineState>,
) -> Result<Vec<String>, String>
```

- Accepts multiple files to download
- Generates UUID for each task
- Adds all tasks to the queue
- Returns list of task IDs

#### get_queue_status

```rust
pub async fn get_queue_status(
    transfer_manager: State<'_, TransferManagerState>,
) -> Result<(usize, usize), String>
```

- Returns (active_tasks, pending_tasks)
- Can be polled by frontend to update UI

### 3. Application Initialization (`src-tauri/src/lib.rs`)

#### Updated TransferManager Setup

```rust
// Initialize TransferManager
let mut transfer_manager = TransferManager::with_default_config();
transfer_manager.start_scheduler(handle.clone());
let transfer_manager_state: TransferManagerState =
    Arc::new(Mutex::new(transfer_manager));
app.manage(transfer_manager_state);
```

- Creates TransferManager as mutable to call start_scheduler
- Starts the scheduler before wrapping in Arc<Mutex<>>
- Scheduler runs in background for the lifetime of the application

#### Registered New Commands

- `enqueue_batch_upload`
- `enqueue_batch_download`
- `get_queue_status`

## How It Works

### Queue Flow

1. **Enqueue Phase**
   - Frontend calls `enqueue_batch_upload` or `enqueue_batch_download`
   - Tasks are added to `pending_queue`
   - Scheduler is signaled via `scheduler_tx.send(())`

2. **Scheduling Phase**
   - Scheduler receives signal and calls `process_queue`
   - Checks `active_tasks.len() < max_concurrent_tasks`
   - If slots available, pops task from queue and calls `execute_upload/download`

3. **Execution Phase**
   - Task is added to `active_tasks`
   - Background tokio task performs the actual transfer
   - Progress events are emitted to frontend

4. **Completion Phase**
   - Task completes (success or failure)
   - Task is removed from `active_tasks` after 3 second delay
   - Scheduler is signaled again to check for pending tasks
   - Cycle repeats until queue is empty

### Concurrency Control

- Maximum concurrent tasks: `config.max_concurrent_tasks` (default: 3)
- Queue uses `VecDeque` for FIFO ordering
- Scheduler automatically starts pending tasks when slots become available
- No manual intervention needed after enqueueing

### Thread Safety

- `active_tasks`: `Arc<Mutex<HashMap<...>>>` - shared across threads
- `pending_queue`: `Arc<Mutex<VecDeque<...>>>` - shared across threads
- `scheduler_tx`: `mpsc::UnboundedSender` - thread-safe channel
- All operations use proper locking to prevent race conditions

## Configuration

Current default configuration (in `TransferConfig`):

```rust
max_concurrent_tasks: 3,
chunk_size: 1024 * 1024,           // 1MB
progress_emit_interval: 100,       // 100ms
speed_window_size: 3,              // 3 seconds
```

## Frontend Integration (Future Work)

### Example Usage

```typescript
// Batch upload multiple files
const files = [
  ['/local/file1.txt', '/remote/file1.txt', 1024],
  ['/local/file2.txt', '/remote/file2.txt', 2048],
  ['/local/file3.txt', '/remote/file3.txt', 4096],
];

const taskIds = await invoke('enqueue_batch_upload', {
  connectionId: 'conn-123',
  files: files,
});

// Poll queue status
const [active, pending] = await invoke('get_queue_status');
console.log(`Active: ${active}, Pending: ${pending}`);
```

### Event Listeners

Existing events still work:
- `transfer:progress` - Progress updates
- `transfer:complete` - Task completed
- `transfer:error` - Task failed

## Testing Recommendations

1. **Single File Transfer**
   - Verify existing `start_upload_chunked` still works
   - Verify existing `start_download_chunked` still works

2. **Batch Transfer**
   - Enqueue 10 files, verify only 3 run concurrently
   - Verify tasks start automatically as others complete
   - Check queue status updates correctly

3. **Concurrency Limit**
   - Enqueue more tasks than max_concurrent_tasks
   - Verify excess tasks wait in queue
   - Verify queue drains completely

4. **Error Handling**
   - Enqueue task with invalid path
   - Verify error doesn't block other tasks
   - Verify scheduler continues processing queue

## Known Limitations

1. **No Priority Queue**: Tasks are processed in FIFO order only
2. **No Pause Queue**: Cannot pause the entire queue, only individual tasks
3. **No Folder Recursion**: Must manually enumerate files (planned for future)
4. **No Retry Logic**: Failed tasks are not automatically retried

## Future Enhancements

1. Add folder recursion support
2. Add priority levels for tasks
3. Add queue persistence (survive app restart)
4. Add retry logic for failed transfers
5. Add bandwidth throttling per connection
6. Add queue manipulation (reorder, remove pending tasks)

## Files Modified

- `D:\Project\devforge\src-tauri\src\services\transfer_manager.rs` - Core queue implementation
- `D:\Project\devforge\src-tauri\src\commands\transfer.rs` - New batch commands
- `D:\Project\devforge\src-tauri\src\lib.rs` - Initialization and command registration

## Build Status

✅ Compiles successfully with no errors
⚠️ 13 warnings (unused fields/methods - expected for incomplete features)
