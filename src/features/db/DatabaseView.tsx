/**
 * 数据库工具窗口：SQLite（文件）+ MySQL / PostgreSQL（远程连接）。
 * 远程连接每次查询新建连接，密码只保存在本组件状态中，不落盘。
 */
import { useState } from "react";
import { Icon } from "../../ui/icons";
import { ipc } from "../../platform/ipc";
import styles from "./DatabaseView.module.css";

interface DbTable {
  name: string;
  kind: string;
}

interface DbResult {
  columns: string[];
  rows: Array<Array<unknown>>;
  truncated: boolean;
}

type DbType = "sqlite" | "mysql" | "postgres";

interface RemoteConn {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

const ROW_LIMIT = 200;
const DEFAULT_PORT: Record<DbType, number | null> = { sqlite: null, mysql: 3306, postgres: 5432 };

export function DatabaseView() {
  const [dbType, setDbType] = useState<DbType>("sqlite");
  const [path, setPath] = useState("");
  const [conn, setConn] = useState<RemoteConn>({ host: "localhost", port: 3306, user: "root", password: "", database: "" });
  const [dbList, setDbList] = useState<string[] | null>(null);
  const [tables, setTables] = useState<DbTable[] | null>(null);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [result, setResult] = useState<DbResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sql, setSql] = useState("SELECT * FROM ");
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);

  const pickFile = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({
      multiple: false,
      title: "打开 SQLite 数据库",
      filters: [
        { name: "SQLite", extensions: ["db", "sqlite", "sqlite3", "db3"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (typeof sel !== "string") return;
    setPath(sel);
    await loadTables({ path: sel });
  };

  const connErrorPrefix = dbType === "mysql" ? "MySQL" : "PostgreSQL";

  const loadTables = async (opts?: { path?: string; conn?: RemoteConn }) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setActiveTable(null);
    try {
      if (dbType === "sqlite") {
        const file = opts?.path ?? path;
        setTables(await ipc.dbTables(file));
      } else {
        const c = opts?.conn ?? conn;
        const list = dbType === "mysql" ? await ipc.dbMysqlTables(c) : await ipc.dbPgTables(c);
        setTables(list);
        setConnected(true);
        setSql(`SELECT * FROM `);
      }
    } catch (e) {
      setTables(null);
      setConnected(false);
      setError(`${connErrorPrefix}: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // 连接：先拉取服务器上的数据库列表填充下拉框，再自动选中并加载表。
  const connect = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = dbType === "mysql" ? await ipc.dbMysqlDatabases(conn) : await ipc.dbPgDatabases(conn);
      setDbList(list);
      const next = list.includes(conn.database) ? conn.database : (list[0] ?? "");
      const nextConn = { ...conn, database: next };
      setConn(nextConn);
      setConnected(true);
      if (next) {
        await loadTables({ conn: nextConn });
      } else {
        setTables([]);
      }
    } catch (e) {
      setDbList(null);
      setTables(null);
      setConnected(false);
      setError(`${connErrorPrefix}: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // 切换下拉框中的数据库：切换后立即加载该库的表。
  const selectDatabase = async (name: string) => {
    if (!name || name === conn.database) return;
    const nextConn = { ...conn, database: name };
    setConn(nextConn);
    await loadTables({ conn: nextConn });
  };

  const runSql = async (statement: string) => {
    if (!statement.trim()) return;
    if (dbType === "sqlite" && !path) return;
    setLoading(true);
    setError(null);
    try {
      let r: DbResult;
      if (dbType === "sqlite") {
        r = await ipc.dbQuery(path, statement, ROW_LIMIT);
      } else if (dbType === "mysql") {
        r = await ipc.dbMysqlQuery(conn, statement, ROW_LIMIT);
      } else {
        r = await ipc.dbPgQuery(conn, statement, ROW_LIMIT);
      }
      setResult(r);
      setActiveTable(null);
      setConnected(true);
    } catch (e) {
      setResult(null);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const openTable = async (name: string) => {
    setActiveTable(name);
    const statement = `SELECT * FROM ${name} LIMIT ${ROW_LIMIT}`;
    setSql(statement);
    await runSql(statement);
  };

  const switchType = (t: DbType) => {
    setDbType(t);
    setTables(null);
    setResult(null);
    setError(null);
    setConnected(false);
    setActiveTable(null);
    setDbList(null);
    setConn((c) => ({ ...c, port: DEFAULT_PORT[t] ?? c.port }));
  };

  const queryReady = dbType === "sqlite" ? !!path : connected;
  const remote = dbType !== "sqlite";
  // 弹性宽度：窄面板换行、宽面板一行铺开。
  const fieldFlex = {
    host: { flex: "1 1 110px" },
    port: { flex: "0 1 58px" },
    user: { flex: "1 1 80px" },
    password: { flex: "1 1 80px" },
    database: { flex: "1 1 90px" },
  };
  const connField = (key: keyof RemoteConn, extra?: { type?: string; placeholder?: string }) => (
    <input
      className={styles.field}
      style={fieldFlex[key]}
      type={extra?.type ?? "text"}
      value={conn[key]}
      placeholder={extra?.placeholder}
      onChange={(e) => setConn((c) => ({ ...c, [key]: key === "port" ? Number(e.target.value.replace(/\D/g, "")) || 0 : e.target.value }))}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !loading) void connect();
      }}
    />
  );

  // 数据库下拉框：点「连接」后从服务器拉取列表，无需手动输入。
  const databaseSelect = (
    <select
      className={styles.select}
      style={fieldFlex.database}
      value={conn.database}
      onChange={(e) => void selectDatabase(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !loading) void connect();
      }}
      title="数据库"
    >
      {dbList === null ? <option value="">连接后选择</option> : null}
      {(dbList ?? []).map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
      {dbList !== null && dbList.length === 0 ? <option value="">（无数据库）</option> : null}
    </select>
  );

  const grid = () => {
    if (error) return <div className={styles.error}>{error}</div>;
    if (!result) {
      return (
        <div className={styles.empty}>
          <span className={styles.icon}>
            <Icon name="toolwindow-database" size={26} />
          </span>
          {queryReady ? (
            <div className={styles.hint}>
              在左侧选择一个表，或在下方输入 SQL 查询（只读模式，Ctrl+Enter 运行）。
            </div>
          ) : (
            <div className={styles.hint}>
              {dbType === "sqlite"
                ? "选择一个 SQLite 数据库文件（.db / .sqlite）开始浏览。数据以只读方式打开，不会被修改。"
                : `填写 ${connErrorPrefix} 连接信息后点击「连接」。每次查询建立独立连接，密码不会保存到磁盘。`}
            </div>
          )}
        </div>
      );
    }
    return (
      <table className={styles.table}>
        <thead>
          <tr>
            {result.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>
              {row.map((v, j) => (
                <td key={j}>{v === null ? <span className={styles.null}>NULL</span> : String(v)}</td>
              ))}
            </tr>
          ))}
          {result.rows.length === 0 ? (
            <tr>
              <td colSpan={result.columns.length || 1}>（没有数据）</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    );
  };

  return (
    <div className={styles.db}>
      <div className={styles.connectBar}>
        <select
          className={styles.select}
          value={dbType}
          onChange={(e) => switchType(e.target.value as DbType)}
          title="数据库类型"
        >
          <option value="sqlite">SQLite</option>
          <option value="mysql">MySQL</option>
          <option value="postgres">PostgreSQL</option>
        </select>
        {!remote ? (
          <>
            <div className={styles.filePath} title={path}>
              {path || "未打开数据库"}
            </div>
            <button type="button" className={styles.button} data-primary="true" onClick={() => void pickFile()}>
              <Icon name="folder" size={13} />
              打开
            </button>
            <button
              type="button"
              className={styles.button}
              disabled={!path}
              onClick={() => void loadTables()}
              title="刷新表列表"
            >
              <Icon name="refresh" size={13} />
            </button>
          </>
        ) : (
          <>
            {connField("host", { placeholder: "主机" })}
            {connField("port")}
            {connField("user", { placeholder: "用户名" })}
            {connField("password", { type: "password", placeholder: "密码" })}
            {databaseSelect}
            <button
              type="button"
              className={styles.button}
              data-primary="true"
              disabled={loading}
              onClick={() => void connect()}
              title="连接并列出数据库"
            >
              连接
            </button>
          </>
        )}
      </div>
      <div className={styles.main}>
        <aside className={styles.tables}>
          {tables?.map((t) => (
            <div
              key={t.name}
              className={styles.tableRow}
              data-active={activeTable === t.name}
              title={t.name}
              onClick={() => void openTable(t.name)}
            >
              <span className={styles.icon}>
                <Icon name={t.kind === "view" ? "eye" : "file-sql"} size={13} />
              </span>
              {t.name}
              <span className={styles.kind}>{t.kind === "view" ? "视图" : ""}</span>
            </div>
          ))}
          {tables && tables.length === 0 ? (
            <div className={styles.tableRow} style={{ color: "var(--fg-muted)" }}>
              （没有表）
            </div>
          ) : null}
          {remote && !connected ? (
            <div className={styles.tableRow} style={{ color: "var(--fg-muted)" }}>
              连接后显示表
            </div>
          ) : null}
        </aside>
        <div className={styles.dataArea}>
          {loading ? <div className={styles.status}>执行中…</div> : null}
          <div className={styles.grid}>{grid()}</div>
          {result?.truncated ? (
            <div className={styles.status}>已显示前 {ROW_LIMIT} 行</div>
          ) : null}
          <div className={styles.sqlRow}>
            <textarea
              className={styles.sqlInput}
              value={sql}
              placeholder="SQL 查询（Ctrl+Enter 运行）"
              disabled={!queryReady}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey) {
                  e.preventDefault();
                  void runSql(sql);
                }
              }}
            />
            <button
              type="button"
              className={styles.button}
              data-primary="true"
              disabled={!queryReady || loading || !sql.trim()}
              onClick={() => void runSql(sql)}
            >
              运行
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
