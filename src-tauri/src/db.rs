//! 数据库工具窗口的后端：SQLite（只读浏览 + 自定义查询）。
//! 通过 rusqlite(bundled) 内嵌 SQLite，无需外部依赖。

use rusqlite::types::ValueRef;
use rusqlite::OpenFlags;
use serde::{Deserialize, Serialize};
use tauri::command;

use mysql::prelude::Queryable;

#[derive(Serialize)]
pub struct DbTable {
    pub name: String,
    pub kind: String, // "table" | "view"
}

fn open_read_only(path: &str) -> Result<rusqlite::Connection, String> {
    if !std::path::Path::new(path).is_file() {
        return Err(format!("文件不存在: {path}"));
    }
    rusqlite::Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("打开数据库失败: {e}"))
}

/// List user tables and views in a SQLite database file.
#[command]
pub fn db_tables(path: String) -> Result<Vec<DbTable>, String> {
    let conn = open_read_only(&path)?;
    let mut stmt = conn
        .prepare(
            "SELECT name, type FROM sqlite_master \
             WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' \
             ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name",
        )
        .map_err(|e| format!("读取表结构失败: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(DbTable {
                name: r.get(0)?,
                kind: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[derive(Serialize)]
pub struct DbResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub truncated: bool,
}

/// Run a SQL statement against a SQLite file (opened read-only) and return up
/// to `limit` rows, values JSON-encoded.
#[command]
pub fn db_query(path: String, sql: String, limit: Option<i64>) -> Result<DbResult, String> {
    let limit = limit.unwrap_or(200).clamp(1, 1000) as usize;
    let conn = open_read_only(&path)?;
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("SQL 错误: {e}"))?;
    let col_count = stmt.column_count();
    let columns: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect();
    let mut rows_iter = stmt.query([]).map_err(|e| format!("SQL 错误: {e}"))?;
    let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut truncated = false;
    loop {
        match rows_iter.next() {
            Ok(Some(r)) => {
                if rows.len() >= limit {
                    truncated = true;
                    break;
                }
                let mut row = Vec::with_capacity(col_count);
                for i in 0..col_count {
                    let v = match r.get_ref(i).map_err(|e| format!("读取列失败: {e}"))? {
                        ValueRef::Null => serde_json::Value::Null,
                        ValueRef::Integer(n) => serde_json::Value::from(n),
                        ValueRef::Real(f) => serde_json::Value::from(f),
                        ValueRef::Text(t) => {
                            serde_json::Value::String(String::from_utf8_lossy(t).into_owned())
                        }
                        ValueRef::Blob(b) => {
                            serde_json::Value::String(format!("<blob {} bytes>", b.len()))
                        }
                    };
                    row.push(v);
                }
                rows.push(row);
            }
            Ok(None) => break,
            Err(e) => return Err(format!("查询失败: {e}")),
        }
    }
    Ok(DbResult {
        columns,
        rows,
        truncated,
    })
}

// --- 远程数据库（MySQL / PostgreSQL） -----------------------------------------

#[derive(Serialize, Deserialize)]
pub struct RemoteConn {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
}

impl RemoteConn {
    fn clean(&self) -> Result<(), String> {
        if self.host.trim().is_empty() {
            return Err("主机地址不能为空".into());
        }
        if self.database.trim().is_empty() {
            return Err("请先连接并选择数据库".into());
        }
        Ok(())
    }
}

/// List databases on a MySQL server (connects without choosing a database).
#[command]
pub fn db_mysql_databases(conn: RemoteConn) -> Result<Vec<String>, String> {
    if conn.host.trim().is_empty() {
        return Err("主机地址不能为空".into());
    }
    let url = format!(
        "mysql://{}:{}@{}:{}",
        urlencode(&conn.user),
        urlencode(&conn.password),
        conn.host.trim(),
        conn.port
    );
    let opts = mysql::Opts::from_url(&url).map_err(|e| format!("连接参数错误: {e}"))?;
    let mut c = mysql::Conn::new(opts).map_err(|e| format!("连接 MySQL 失败: {e}"))?;
    let result_set = c
        .query_iter("SHOW DATABASES")
        .map_err(|e| format!("读取数据库列表失败: {e}"))?;
    let mut out = Vec::new();
    for row in result_set {
        let row = row.map_err(|e| e.to_string())?;
        if let Some(name) = row.get(0) {
            out.push(name);
        }
    }
    Ok(out)
}

/// List databases on a PostgreSQL server (connects to the default "postgres" db).
#[command]
pub fn db_pg_databases(conn: RemoteConn) -> Result<Vec<String>, String> {
    if conn.host.trim().is_empty() {
        return Err("主机地址不能为空".into());
    }
    let mut client = postgres::Config::new()
        .host(conn.host.trim())
        .port(conn.port)
        .user(conn.user.trim())
        .password(&conn.password)
        .dbname("postgres")
        .connect_timeout(std::time::Duration::from_secs(10))
        .connect(postgres::NoTls)
        .map_err(|e| format!("连接 PostgreSQL 失败: {e}"))?;
    let rows = client
        .simple_query(
            "SELECT datname FROM pg_database \
             WHERE datallowconn AND NOT datistemplate \
             ORDER BY datname",
        )
        .map_err(|e| format!("读取数据库列表失败: {e}"))?;
    let mut out = Vec::new();
    for msg in &rows {
        if let postgres::SimpleQueryMessage::Row(row) = msg {
            if let Some(name) = row.get(0) {
                out.push(name.to_string());
            }
        }
    }
    Ok(out)
}

/// List tables/views on a MySQL server.
#[command]
pub fn db_mysql_tables(conn: RemoteConn) -> Result<Vec<DbTable>, String> {
    conn.clean()?;
    let url = format!(
        "mysql://{}:{}@{}:{}/{}",
        urlencode(&conn.user),
        urlencode(&conn.password),
        conn.host.trim(),
        conn.port,
        conn.database.trim()
    );
    let opts = mysql::Opts::from_url(&url).map_err(|e| format!("连接参数错误: {e}"))?;
    let mut c = mysql::Conn::new(opts).map_err(|e| format!("连接 MySQL 失败: {e}"))?;
    let result_set = c
        .query_iter(
            "SELECT table_name, table_type FROM information_schema.tables \
             WHERE table_schema = DATABASE() \
             ORDER BY CASE table_type WHEN 'BASE TABLE' THEN 0 ELSE 1 END, table_name",
        )
        .map_err(|e| format!("读取表结构失败: {e}"))?;
    let mut out = Vec::new();
    for row in result_set {
        let row = row.map_err(|e| e.to_string())?;
        let name: String = row.get(0).ok_or("missing table_name")?;
        let kind_raw: String = row.get(1).ok_or("missing table_type")?;
        out.push(DbTable {
            name,
            kind: if kind_raw.contains("VIEW") { "view".into() } else { "table".into() },
        });
    }
    Ok(out)
}

/// Run a SQL statement on a MySQL server, values returned as display strings.
#[command]
pub fn db_mysql_query(conn: RemoteConn, sql: String, limit: Option<i64>) -> Result<DbResult, String> {
    conn.clean()?;
    let limit = limit.unwrap_or(200).clamp(1, 1000) as usize;
    let url = format!(
        "mysql://{}:{}@{}:{}/{}",
        urlencode(&conn.user),
        urlencode(&conn.password),
        conn.host.trim(),
        conn.port,
        conn.database.trim()
    );
    let opts = mysql::Opts::from_url(&url).map_err(|e| format!("连接参数错误: {e}"))?;
    let mut c = mysql::Conn::new(opts).map_err(|e| format!("连接 MySQL 失败: {e}"))?;
    let result_set = c.query_iter(&sql).map_err(|e| format!("SQL 错误: {e}"))?;
    let columns: Vec<String> = result_set
        .columns()
        .as_ref()
        .iter()
        .map(|col| col.name_str().into_owned())
        .collect();
    let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut truncated = false;
    for row in result_set {
        if rows.len() >= limit {
            truncated = true;
            break;
        }
        let row = row.map_err(|e| format!("读取行失败: {e}"))?;
        let mut out = Vec::with_capacity(columns.len());
        for i in 0..columns.len() {
            out.push(match row.as_ref(i) {
                None | Some(mysql::Value::NULL) => serde_json::Value::Null,
                Some(mysql::Value::Bytes(b)) => {
                    serde_json::Value::String(String::from_utf8_lossy(b.as_slice()).into_owned())
                }
                Some(mysql::Value::Int(n)) => serde_json::Value::from(*n),
                Some(mysql::Value::UInt(n)) => serde_json::Value::from(*n),
                Some(mysql::Value::Float(f)) => serde_json::Value::from(*f),
                Some(mysql::Value::Double(f)) => serde_json::Value::from(*f),
                Some(mysql::Value::Date(y, mo, d, h, mi, s, us)) => serde_json::Value::String(format!(
                    "{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}.{us:06}"
                )),
                Some(mysql::Value::Time(neg, d, h, mi, s, us)) => serde_json::Value::String(format!(
                    "{}{d:02}d {h:02}:{mi:02}:{s:02}.{us:06}",
                    if *neg { "-" } else { "" }
                )),
            });
        }
        rows.push(out);
    }
    Ok(DbResult {
        columns,
        rows,
        truncated,
    })
}

/// List tables/views on a PostgreSQL server.
#[command]
pub fn db_pg_tables(conn: RemoteConn) -> Result<Vec<DbTable>, String> {
    let mut client = pg_connect(&conn)?;
    let rows = client
        .simple_query(
            "SELECT table_name, table_type FROM information_schema.tables \
             WHERE table_schema = current_schema() AND table_type IN ('BASE TABLE','VIEW') \
             ORDER BY CASE table_type WHEN 'BASE TABLE' THEN 0 ELSE 1 END, table_name",
        )
        .map_err(|e| format!("读取表结构失败: {e}"))?;
    let mut out = Vec::new();
    for msg in &rows {
        if let postgres::SimpleQueryMessage::Row(row) = msg {
            out.push(DbTable {
                name: row.get("table_name").unwrap_or("").to_string(),
                kind: match row.get("table_type") {
                    Some("VIEW") => "view".to_string(),
                    _ => "table".to_string(),
                },
            });
        }
    }
    Ok(out)
}

/// Run a SQL statement on a PostgreSQL server via the text-mode protocol,
/// values returned as display strings.
#[command]
pub fn db_pg_query(conn: RemoteConn, sql: String, limit: Option<i64>) -> Result<DbResult, String> {
    let limit = limit.unwrap_or(200).clamp(1, 1000) as usize;
    let mut client = pg_connect(&conn)?;
    let rows = client.simple_query(&sql).map_err(|e| format!("SQL 错误: {e}"))?;
    let mut columns: Vec<String> = Vec::new();
    let mut rows_out: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut truncated = false;
    for msg in rows.iter() {
        match msg {
            postgres::SimpleQueryMessage::RowDescription(desc) => {
                columns = desc.iter().map(|c| c.name().to_string()).collect();
            }
            postgres::SimpleQueryMessage::Row(row) => {
                if rows_out.len() >= limit {
                    truncated = true;
                    continue;
                }
                let mut out = Vec::with_capacity(row.len());
                for i in 0..row.len() {
                    out.push(match row.try_get(i) {
                        Ok(Some(s)) => serde_json::Value::String(s.to_string()),
                        _ => serde_json::Value::Null,
                    });
                }
                rows_out.push(out);
            }
            _ => {}
        }
    }
    Ok(DbResult {
        columns,
        rows: rows_out,
        truncated,
    })
}

fn pg_connect(conn: &RemoteConn) -> Result<postgres::Client, String> {
    conn.clean()?;
    postgres::Config::new()
        .host(conn.host.trim())
        .port(conn.port)
        .user(conn.user.trim())
        .password(&conn.password)
        .dbname(conn.database.trim())
        .connect_timeout(std::time::Duration::from_secs(10))
        .connect(postgres::NoTls)
        .map_err(|e| format!("连接 PostgreSQL 失败: {e}"))
}

/// Percent-encode a URL component (user/password may contain @ : / etc).
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
