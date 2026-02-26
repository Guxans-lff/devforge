use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// 文件分块器 - 将文件分割成固定大小的块进行读取
pub struct FileChunker {
    file: File,
    #[allow(dead_code)]
    file_path: PathBuf,
    chunk_size: usize,
    total_size: u64,
    current_offset: u64,
}

impl FileChunker {
    /// 创建新的文件分块器
    /// 
    /// # 参数
    /// * `file_path` - 文件路径
    /// * `chunk_size` - 块大小（字节）
    pub fn new(file_path: PathBuf, chunk_size: usize) -> Result<Self, std::io::Error> {
        let file = File::open(&file_path)?;
        let metadata = file.metadata()?;
        let total_size = metadata.len();
        
        Ok(Self {
            file,
            file_path,
            chunk_size,
            total_size,
            current_offset: 0,
        })
    }
    
    /// 读取下一个数据块
    /// 
    /// # 返回
    /// * `Ok(Some(Vec<u8>))` - 成功读取的数据块
    /// * `Ok(None)` - 已到达文件末尾
    /// * `Err` - 读取错误
    pub fn read_next_chunk(&mut self) -> Result<Option<Vec<u8>>, std::io::Error> {
        // 检查是否已到达文件末尾
        if self.current_offset >= self.total_size {
            return Ok(None);
        }
        
        // 计算本次要读取的字节数
        let remaining = self.total_size - self.current_offset;
        let read_size = std::cmp::min(remaining, self.chunk_size as u64) as usize;
        
        // 读取数据
        let mut buffer = vec![0u8; read_size];
        let bytes_read = self.file.read(&mut buffer)?;
        
        // 更新偏移量
        self.current_offset += bytes_read as u64;
        
        // 调整 buffer 大小（如果实际读取的字节数少于预期）
        buffer.truncate(bytes_read);
        
        Ok(Some(buffer))
    }
    
    /// 获取当前进度
    ///
    /// # 返回
    /// * `(已读取字节数, 总字节数)`
    #[allow(dead_code)]
    pub fn progress(&self) -> (u64, u64) {
        (self.current_offset, self.total_size)
    }
    
    /// 定位到指定偏移量（用于断点续传）
    /// 
    /// # 参数
    /// * `offset` - 目标偏移量
    pub fn seek(&mut self, offset: u64) -> Result<(), std::io::Error> {
        self.file.seek(SeekFrom::Start(offset))?;
        self.current_offset = offset;
        Ok(())
    }
    
    /// 获取文件总大小
    #[allow(dead_code)]
    pub fn total_size(&self) -> u64 {
        self.total_size
    }
    
    /// 获取当前偏移量
    #[allow(dead_code)]
    pub fn current_offset(&self) -> u64 {
        self.current_offset
    }
    
    /// 获取块大小
    #[allow(dead_code)]
    pub fn chunk_size(&self) -> usize {
        self.chunk_size
    }
    
    /// 获取文件路径
    #[allow(dead_code)]
    pub fn file_path(&self) -> &Path {
        &self.file_path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;
    
    #[test]
    fn test_read_small_file() {
        // 创建临时文件
        let mut temp_file = NamedTempFile::new().unwrap();
        let content = b"Hello, World!";
        temp_file.write_all(content).unwrap();
        temp_file.flush().unwrap();
        
        // 创建分块器
        let mut chunker = FileChunker::new(
            temp_file.path().to_path_buf(),
            1024 * 1024, // 1MB
        ).unwrap();
        
        // 读取第一个块
        let chunk = chunker.read_next_chunk().unwrap();
        assert!(chunk.is_some());
        assert_eq!(chunk.unwrap(), content);
        
        // 应该已到达文件末尾
        let chunk = chunker.read_next_chunk().unwrap();
        assert!(chunk.is_none());
    }
    
    #[test]
    fn test_read_large_file_in_chunks() {
        // 创建临时文件（10KB）
        let mut temp_file = NamedTempFile::new().unwrap();
        let content = vec![0u8; 10 * 1024];
        temp_file.write_all(&content).unwrap();
        temp_file.flush().unwrap();
        
        // 创建分块器（块大小 4KB）
        let mut chunker = FileChunker::new(
            temp_file.path().to_path_buf(),
            4 * 1024,
        ).unwrap();
        
        let mut total_read = 0;
        let mut chunk_count = 0;
        
        // 读取所有块
        while let Some(chunk) = chunker.read_next_chunk().unwrap() {
            total_read += chunk.len();
            chunk_count += 1;
        }
        
        // 验证
        assert_eq!(total_read, 10 * 1024);
        assert_eq!(chunk_count, 3); // 4KB + 4KB + 2KB
    }
    
    #[test]
    fn test_seek() {
        // 创建临时文件
        let mut temp_file = NamedTempFile::new().unwrap();
        let content = b"0123456789";
        temp_file.write_all(content).unwrap();
        temp_file.flush().unwrap();
        
        // 创建分块器
        let mut chunker = FileChunker::new(
            temp_file.path().to_path_buf(),
            1024,
        ).unwrap();
        
        // 定位到偏移量 5
        chunker.seek(5).unwrap();
        
        // 读取剩余内容
        let chunk = chunker.read_next_chunk().unwrap();
        assert_eq!(chunk.unwrap(), b"56789");
    }
    
    #[test]
    fn test_progress() {
        // 创建临时文件
        let mut temp_file = NamedTempFile::new().unwrap();
        let content = vec![0u8; 100];
        temp_file.write_all(&content).unwrap();
        temp_file.flush().unwrap();
        
        // 创建分块器（块大小 30）
        let mut chunker = FileChunker::new(
            temp_file.path().to_path_buf(),
            30,
        ).unwrap();
        
        // 初始进度
        let (current, total) = chunker.progress();
        assert_eq!(current, 0);
        assert_eq!(total, 100);
        
        // 读取第一个块
        chunker.read_next_chunk().unwrap();
        let (current, _) = chunker.progress();
        assert_eq!(current, 30);
        
        // 读取第二个块
        chunker.read_next_chunk().unwrap();
        let (current, _) = chunker.progress();
        assert_eq!(current, 60);
    }
}
