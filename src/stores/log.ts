import { defineStore } from 'pinia'
import { ref } from 'vue'

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
export type LogSource = 'SSH' | 'SFTP' | 'DATABASE' | 'SYSTEM' | 'GIT'

export interface LogEntry {
    id: string
    timestamp: number
    level: LogLevel
    source: LogSource
    message: string
    details?: string | object
}

export const useLogStore = defineStore('log', () => {
    const logs = ref<LogEntry[]>([])
    const MAX_LOGS = 1000

    /**
     * 添加一条日志
     */
    function addLog(entry: Omit<LogEntry, 'id' | 'timestamp'>) {
        const newEntry: LogEntry = {
            ...entry,
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            timestamp: Date.now(),
        }

        logs.value.push(newEntry)

        // 内存限额：滑动窗口
        if (logs.value.length > MAX_LOGS) {
            logs.value = logs.value.slice(-MAX_LOGS)
        }

        return newEntry.id
    }

    /**
     * 快捷添加方法
     */
    const info = (source: LogSource, message: string, details?: string | object) => addLog({ level: 'INFO', source, message, details })
    const debug = (source: LogSource, message: string, details?: string | object) => addLog({ level: 'DEBUG', source, message, details })
    const warn = (source: LogSource, message: string, details?: string | object) => addLog({ level: 'WARN', source, message, details })
    const error = (source: LogSource, message: string, details?: string | object) => addLog({ level: 'ERROR', source, message, details })

    function clearLogs() {
        logs.value = []
    }

    return {
        logs,
        addLog,
        info,
        debug,
        warn,
        error,
        clearLogs
    }
})
