/// SQL 智能分割器模块
///
/// 将包含多条 SQL 语句的文本智能分割为独立语句列表。
/// 支持：
/// - 单引号/双引号/反引号内的分号忽略
/// - 行注释（-- 和 #）和块注释（/* */）内的分号忽略
/// - MySQL DELIMITER 指令（动态切换分隔符）
/// - 自动排除空语句、纯注释语句和 DELIMITER 指令

/// 智能分割 SQL 文本为独立语句列表
///
/// # 参数
/// - `content` - 包含一条或多条 SQL 语句的文本
///
/// # 返回
/// 分割后的 SQL 语句列表（不含 DELIMITER 指令、空语句和纯注释）
pub fn split_sql_statements(content: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut delimiter = ";".to_string();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_backtick = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    
    let mut chars = content.chars().peekable();
    
    while let Some(ch) = chars.next() {
        let next = chars.peek().cloned();

        // === 行注释状态 ===
        if in_line_comment {
            if ch == '\n' {
                in_line_comment = false;
            }
            current.push(ch);
            continue;
        }

        // === 块注释状态 ===
        if in_block_comment {
            current.push(ch);
            if ch == '*' && next == Some('/') {
                current.push('/');
                chars.next(); // consume '/'
                in_block_comment = false;
                continue;
            }
            continue;
        }

        // === 单引号字符串状态 ===
        if in_single_quote {
            current.push(ch);
            if ch == '\\' && next.is_some() {
                // 转义字符，跳过下一个字符
                current.push(chars.next().unwrap());
                continue;
            }
            if ch == '\'' && next == Some('\'') {
                // 转义引号 ''
                current.push(chars.next().unwrap());
                continue;
            }
            if ch == '\'' {
                in_single_quote = false;
            }
            continue;
        }

        // === 双引号字符串状态 ===
        if in_double_quote {
            current.push(ch);
            if ch == '"' {
                in_double_quote = false;
            }
            continue;
        }

        // === 反引号标识符状态 ===
        if in_backtick {
            current.push(ch);
            if ch == '`' {
                in_backtick = false;
            }
            continue;
        }

        // === 检测注释开头 ===
        if ch == '-' && next == Some('-') {
            // 确保 -- 后面是空格或行尾（标准 SQL 注释）
            // 这里需要 peek 两个字符，或者用更复杂逻辑。为简单起见，这里假设 -- 就是注释。
            // 实际上 SQL 标准要求 -- 后面有空格，但很多驱动不强制。
            in_line_comment = true;
            current.push(ch);
            continue;
        }

        if ch == '#' {
            in_line_comment = true;
            current.push(ch);
            continue;
        }

        if ch == '/' && next == Some('*') {
            in_block_comment = true;
            current.push(ch);
            current.push(chars.next().unwrap()); // consume '*'
            continue;
        }

        // === 检测字符串/标识符开头 ===
        if ch == '\'' {
            in_single_quote = true;
            current.push(ch);
            continue;
        }

        if ch == '"' {
            in_double_quote = true;
            current.push(ch);
            continue;
        }

        if ch == '`' {
            in_backtick = true;
            current.push(ch);
            continue;
        }

        // === 检测 DELIMITER 指令 ===
        // === 检测 DELIMITER 指令 ===
        if (ch == 'D' || ch == 'd') && current.trim().is_empty() {
            // 需要检查后续字符是否匹配 "ELIMITER "
            let mut matched = true;
            let pattern = "ELIMITER";
            let mut peeked = Vec::new();
            
            for p_ch in pattern.chars() {
                if let Some(&next_ch) = chars.peek() {
                    if next_ch.to_uppercase().next() == p_ch.to_uppercase().next() {
                        peeked.push(chars.next().unwrap());
                    } else {
                        matched = false;
                        break;
                    }
                } else {
                    matched = false;
                    break;
                }
            }
            
            if matched {
                // 消耗空白
                while let Some(&c) = chars.peek() {
                    if c.is_whitespace() && c != '\n' {
                        chars.next();
                    } else {
                        break;
                    }
                }
                
                // 提取新分隔符
                let mut new_delim = String::new();
                while let Some(&c) = chars.peek() {
                    if !c.is_whitespace() {
                        new_delim.push(chars.next().unwrap());
                    } else {
                        break;
                    }
                }
                
                if !new_delim.is_empty() {
                    delimiter = new_delim;
                    current.clear();
                    // 跳到行尾
                    while let Some(c) = chars.next() {
                        if c == '\n' { break; }
                    }
                    continue;
                }
            }
            
            // 如果不匹配，把 peek 出来的字符塞回 current (或者直接 continue)
            // 实际上前面的 chars.next() 已经消耗了。所以我们需要手动补回。
            current.push(ch);
            for p in peeked {
                current.push(p);
            }
            continue;
        }

        // === 检测分隔符 ===
        if delimiter == ";" {
            if ch == ';' {
                emit_statement(&mut statements, &current);
                current.clear();
                continue;
            }
        } else {
            // 自定义分隔符处理
            if ch == delimiter.chars().next().unwrap() {
                let mut matched = true;
                let mut peeked = Vec::new();
                for d_ch in delimiter.chars().skip(1) {
                    if let Some(&next_ch) = chars.peek() {
                        if next_ch == d_ch {
                            peeked.push(chars.next().unwrap());
                        } else {
                            matched = false;
                            break;
                        }
                    } else {
                        matched = false;
                        break;
                    }
                }
                if matched {
                    emit_statement(&mut statements, &current);
                    current.clear();
                    continue;
                } else {
                    current.push(ch);
                    for p in peeked {
                        current.push(p);
                    }
                    continue;
                }
            }
        }

        current.push(ch);
    }

    emit_statement(&mut statements, &current);
    statements
}

/// 解析 DELIMITER 指令，返回新的分隔符
/// 输入示例："DELIMITER //" 或 "delimiter $$"
fn parse_delimiter_directive(line: &str) -> Option<String> {
    let upper = line.to_uppercase();
    if !upper.starts_with("DELIMITER") {
        return None;
    }

    // "DELIMITER" 后面必须跟空白
    let rest = &line[9..];
    if rest.is_empty() || (!rest.starts_with(' ') && !rest.starts_with('\t')) {
        return None;
    }

    // 提取新分隔符（取到行尾或空白结束）
    let trimmed = rest.trim();
    // 取第一个"词"作为分隔符（到空白或行尾）
    let new_delim: String = trimmed.chars()
        .take_while(|c| !c.is_whitespace())
        .collect();

    if new_delim.is_empty() {
        return None;
    }

    Some(new_delim)
}

/// 将非空、非纯注释的语句加入结果列表
fn emit_statement(statements: &mut Vec<String>, raw: &str) {
    let trimmed = raw.trim().to_string();
    if trimmed.is_empty() {
        return;
    }
    // 排除纯注释语句（只包含 -- 或 # 或 /* */ 注释）
    if is_pure_comment(&trimmed) {
        return;
    }
    statements.push(trimmed);
}

/// 判断语句是否为纯注释（不含可执行 SQL）
fn is_pure_comment(sql: &str) -> bool {
    let mut chars = sql.chars().peekable();

    while let Some(ch) = chars.next() {
        // 跳过空白
        if ch.is_whitespace() {
            continue;
        }

        // 行注释 --
        if ch == '-' && chars.peek() == Some(&'-') {
            chars.next(); // consume '-'
            // 跳到行尾
            while let Some(c) = chars.next() {
                if c == '\n' { break; }
            }
            continue;
        }

        // 行注释 #
        if ch == '#' {
            while let Some(c) = chars.next() {
                if c == '\n' { break; }
            }
            continue;
        }

        // 块注释 /* */
        if ch == '/' && chars.peek() == Some(&'*') {
            chars.next(); // consume '*'
            while let Some(c) = chars.next() {
                if c == '*' && chars.peek() == Some(&'/') {
                    chars.next(); // consume '/'
                    break;
                }
            }
            continue;
        }

        // 遇到非注释、非空白字符，说明不是纯注释
        return false;
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_split() {
        let sql = "SELECT 1; SELECT 2; SELECT 3";
        let result = split_sql_statements(sql);
        assert_eq!(result, vec!["SELECT 1", "SELECT 2", "SELECT 3"]);
    }

    #[test]
    fn test_string_with_semicolon() {
        let sql = "SELECT 'hello;world'; SELECT 2";
        let result = split_sql_statements(sql);
        assert_eq!(result, vec!["SELECT 'hello;world'", "SELECT 2"]);
    }

    #[test]
    fn test_double_quote_with_semicolon() {
        let sql = r#"SELECT "col;name"; SELECT 2"#;
        let result = split_sql_statements(sql);
        assert_eq!(result, vec![r#"SELECT "col;name""#, "SELECT 2"]);
    }

    #[test]
    fn test_backtick_with_semicolon() {
        let sql = "SELECT `col;name`; SELECT 2";
        let result = split_sql_statements(sql);
        assert_eq!(result, vec!["SELECT `col;name`", "SELECT 2"]);
    }

    #[test]
    fn test_line_comment() {
        let sql = "SELECT 1; -- this is; a comment\nSELECT 2";
        let result = split_sql_statements(sql);
        assert_eq!(result, vec!["SELECT 1", "-- this is; a comment\nSELECT 2"]);
    }

    #[test]
    fn test_hash_comment() {
        let sql = "SELECT 1; # comment with; semicolon\nSELECT 2";
        let result = split_sql_statements(sql);
        assert_eq!(result, vec!["SELECT 1", "# comment with; semicolon\nSELECT 2"]);
    }

    #[test]
    fn test_block_comment() {
        let sql = "SELECT /* ; */ 1; SELECT 2";
        let result = split_sql_statements(sql);
        assert_eq!(result, vec!["SELECT /* ; */ 1", "SELECT 2"]);
    }

    #[test]
    fn test_delimiter_stored_procedure() {
        let sql = "DELIMITER //\nCREATE PROCEDURE test()\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND //\nDELIMITER ;\nSELECT 3;";
        let result = split_sql_statements(sql);
        assert_eq!(result, vec![
            "CREATE PROCEDURE test()\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND",
            "SELECT 3",
        ]);
    }

    #[test]
    fn test_empty_statements_filtered() {
        let sql = ";;SELECT 1;;;SELECT 2;;";
        let result = split_sql_statements(sql);
        assert_eq!(result, vec!["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn test_pure_comment_filtered() {
        let sql = "-- just a comment\n; SELECT 1;";
        let result = split_sql_statements(sql);
        assert_eq!(result, vec!["SELECT 1"]);
    }

    #[test]
    fn test_trailing_statement_without_delimiter() {
        let sql = "SELECT 1; SELECT 2";
        let result = split_sql_statements(sql);
        assert_eq!(result, vec!["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn test_escaped_quote() {
        let sql = "SELECT 'it''s'; SELECT 2";
        let result = split_sql_statements(sql);
        assert_eq!(result, vec!["SELECT 'it''s'", "SELECT 2"]);
    }

    #[test]
    fn test_backslash_escape() {
        let sql = "SELECT 'hello\\';world'; SELECT 2";
        let result = split_sql_statements(sql);
        assert_eq!(result, vec!["SELECT 'hello\\';world'", "SELECT 2"]);
    }
}
