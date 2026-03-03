export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  /** Unix timestamp (seconds) */
  modified: number | null
  /** Unix permission bits */
  permissions: number | null
}

export interface FileInfo {
  name: string
  path: string
  isDir: boolean
  size: number
  modified: number | null
  permissions: number | null
  owner: string | null
  group: string | null
}

export interface TransferProgress {
  transferId: string
  fileName: string
  bytesTransferred: number
  totalBytes: number
  /** 0.0 – 1.0 */
  progress: number
  /** Bytes per second */
  speed: number
}

export interface TransferResult {
  transferId: string
  success: boolean
  error: string | null
}

export interface TransferTask {
  transferId: string
  fileName: string
  direction: 'upload' | 'download'
  status: 'pending' | 'transferring' | 'completed' | 'error'
  progress: number
  bytesTransferred: number
  totalBytes: number
  speed: number
  error: string | null
}

export interface SearchResult {
  name: string
  path: string
  isDir: boolean
  size: number
  modified: number | null
}
