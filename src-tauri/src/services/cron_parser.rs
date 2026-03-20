use chrono::{DateTime, Datelike, Duration, NaiveDate, Timelike, Utc};

/// 轻量级 cron 表达式解析器
/// 支持标准 5 字段格式：分 时 日 月 周
/// 支持的语法：*、*/n（步进）、n-m（范围）、n,m（列表）、固定值

/// 解析 cron 表达式，计算给定时间之后的下一次执行时间
///
/// - `cron_expr`：标准 5 字段 cron 表达式（分 时 日 月 周）
/// - `after`：从此时间之后开始搜索
/// - 返回：下一次匹配的 UTC 时间，最多向前搜索 366 天
pub fn next_occurrence(cron_expr: &str, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let fields: Vec<&str> = cron_expr.trim().split_whitespace().collect();
    if fields.len() != 5 {
        return None;
    }

    let minutes = parse_field(fields[0], 0, 59)?;
    let hours = parse_field(fields[1], 0, 23)?;
    let days = parse_field(fields[2], 1, 31)?;
    let months = parse_field(fields[3], 1, 12)?;
    let weekdays = parse_field(fields[4], 0, 6)?;

    // 从 after 的下一分钟开始搜索
    let start = after + Duration::minutes(1);
    let mut current = start
        .with_nanosecond(0)?
        .with_second(0)?;

    // 最多搜索 366 天，防止无限循环
    let end = after + Duration::days(366);

    while current < end {
        let month = current.month();
        let day = current.day();
        let hour = current.hour();
        let minute = current.minute();
        let weekday = current.weekday().num_days_from_sunday(); // 0=周日

        // 检查月份
        if !months.contains(&(month as u8)) {
            // 跳到下个月
            current = next_month(current)?;
            continue;
        }

        // 检查日期（同时检查日和星期几）
        if !days.contains(&(day as u8)) || !weekdays.contains(&(weekday as u8)) {
            current = current + Duration::days(1);
            current = current.with_hour(0)?.with_minute(0)?;
            continue;
        }

        // 检查小时
        if !hours.contains(&(hour as u8)) {
            current = current + Duration::hours(1);
            current = current.with_minute(0)?;
            continue;
        }

        // 检查分钟
        if !minutes.contains(&(minute as u8)) {
            current = current + Duration::minutes(1);
            continue;
        }

        return Some(current);
    }

    None
}

/// 验证 cron 表达式是否合法
pub fn validate_cron(cron_expr: &str) -> Result<(), String> {
    let fields: Vec<&str> = cron_expr.trim().split_whitespace().collect();
    if fields.len() != 5 {
        return Err(format!("cron 表达式需要 5 个字段（分 时 日 月 周），当前有 {} 个", fields.len()));
    }

    parse_field(fields[0], 0, 59).ok_or("分钟字段无效（0-59）")?;
    parse_field(fields[1], 0, 23).ok_or("小时字段无效（0-23）")?;
    parse_field(fields[2], 1, 31).ok_or("日期字段无效（1-31）")?;
    parse_field(fields[3], 1, 12).ok_or("月份字段无效（1-12）")?;
    parse_field(fields[4], 0, 6).ok_or("星期字段无效（0-6，0=周日）")?;

    Ok(())
}

/// 解析单个 cron 字段，返回匹配值的集合
/// 支持：*、*/n、n-m、n,m、固定值
fn parse_field(field: &str, min: u8, max: u8) -> Option<Vec<u8>> {
    let mut values = Vec::new();

    for part in field.split(',') {
        let part = part.trim();

        if part == "*" {
            // 通配符：所有值
            return Some((min..=max).collect());
        } else if let Some(step_str) = part.strip_prefix("*/") {
            // 步进：*/n
            let step: u8 = step_str.parse().ok()?;
            if step == 0 {
                return None;
            }
            let mut val = min;
            while val <= max {
                values.push(val);
                val = val.checked_add(step)?;
            }
        } else if part.contains('-') {
            // 范围：n-m
            let parts: Vec<&str> = part.split('-').collect();
            if parts.len() != 2 {
                return None;
            }
            let start: u8 = parts[0].parse().ok()?;
            let end: u8 = parts[1].parse().ok()?;
            if start < min || end > max || start > end {
                return None;
            }
            for v in start..=end {
                values.push(v);
            }
        } else {
            // 固定值
            let val: u8 = part.parse().ok()?;
            if val < min || val > max {
                return None;
            }
            values.push(val);
        }
    }

    if values.is_empty() {
        None
    } else {
        values.sort();
        values.dedup();
        Some(values)
    }
}

/// 跳到下个月的第一天 00:00
fn next_month(dt: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let (year, month) = if dt.month() == 12 {
        (dt.year() + 1, 1)
    } else {
        (dt.year(), dt.month() + 1)
    };
    let date = NaiveDate::from_ymd_opt(year, month, 1)?;
    let datetime = date.and_hms_opt(0, 0, 0)?;
    Some(DateTime::from_naive_utc_and_offset(datetime, Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_every_minute() {
        let after = Utc.with_ymd_and_hms(2026, 3, 20, 10, 30, 0).unwrap();
        let next = next_occurrence("* * * * *", after).unwrap();
        assert_eq!(next.minute(), 31);
        assert_eq!(next.hour(), 10);
    }

    #[test]
    fn test_specific_time() {
        let after = Utc.with_ymd_and_hms(2026, 3, 20, 10, 30, 0).unwrap();
        let next = next_occurrence("0 12 * * *", after).unwrap();
        assert_eq!(next.minute(), 0);
        assert_eq!(next.hour(), 12);
        assert_eq!(next.day(), 20);
    }

    #[test]
    fn test_step() {
        let after = Utc.with_ymd_and_hms(2026, 3, 20, 10, 0, 0).unwrap();
        let next = next_occurrence("*/15 * * * *", after).unwrap();
        assert!(next.minute() % 15 == 0);
    }

    #[test]
    fn test_validate_cron() {
        assert!(validate_cron("* * * * *").is_ok());
        assert!(validate_cron("0 12 * * 1-5").is_ok());
        assert!(validate_cron("*/5 * * * *").is_ok());
        assert!(validate_cron("bad").is_err());
        assert!(validate_cron("60 * * * *").is_err());
    }
}
