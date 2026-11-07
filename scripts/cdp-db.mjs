/** CDP: verify MySQL/PostgreSQL connect forms and failure error paths. */
const list = await fetch("http://127.0.0.1:9223/json/list").then((r) => r.json());
const page = list.find((t) => t.type === "page" && t.url.includes("tauri.localhost")) ?? list.find((t) => t.type === "page");
console.log("TARGETS:", JSON.stringify(list.map((t) => ({ type: t.type, url: t.url }))));
if (!page) {
  console.error("no page target");
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let msgId = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function send(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  return r.result?.result?.value ?? null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openDbWindow() {
  // Welcome screen first: open the recent project, then the DB tool window.
  const inProject = await evaluate(`!!document.querySelector("[role='treeitem']")`);
  if (!inProject) {
    const recent = await evaluate(`(() => {
      const els = [...document.querySelectorAll("*")].filter(
        (e) => e.childElementCount === 0 && e.textContent.trim() === "sample_project" && e.getBoundingClientRect().width > 0,
      );
      const el = els[els.length - 1];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    })()`);
    console.log("RECENT:", JSON.stringify(recent));
    if (!recent || typeof recent !== "string") return;
    const p = JSON.parse(recent);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await sleep(2500);
  }
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('nav[data-stripe-side="right"] button')].find(
      (b) => (b.title || "").includes("数据库"),
    );
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(600);
}

async function switchType(t) {
  return evaluate(`(() => {
    const sel = document.querySelector('[data-tool-window="database"] select');
    if (!sel) return "NO SELECT";
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(sel, ${JSON.stringify(t)});
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return "switched";
  })()`);
}

async function probe() {
  return evaluate(`(() => {
    const body = document.querySelector('[data-tool-window="database"]');
    if (!body) return JSON.stringify({ err: "NOT MOUNTED" });
    const inputs = [...body.querySelectorAll("input")];
    const btns = [...body.querySelectorAll("button")].map((b) => b.textContent.trim());
    return JSON.stringify({
      fields: inputs.map((i) => i.type + (i.value ? ":" + i.value : "")),
      hasConnectBtn: btns.includes("连接"),
      error: body.textContent.includes("连接 MySQL 失败")
        ? "连接 MySQL 失败 (shown)"
        : body.textContent.includes("连接 PostgreSQL 失败")
          ? "连接 PostgreSQL 失败 (shown)"
          : body.textContent.includes("数据库名不能为空")
            ? "数据库名不能为空 (shown)"
            : null,
      tablesShown: body.textContent.includes("连接后显示表"),
    });
  })()`);
}

async function fillDatabaseAndConnect(dbname) {
  return evaluate(`(() => {
    const body = document.querySelector('[data-tool-window="database"]');
    const inputs = [...body.querySelectorAll("input")];
    const dbInput = inputs[inputs.length - 1];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(dbInput, ${JSON.stringify(dbname)});
    dbInput.dispatchEvent(new Event("input", { bubbles: true }));
    const btn = [...body.querySelectorAll("button")].find((b) => b.textContent.trim() === "连接");
    if (!btn || btn.disabled) return "NO/BTN-DISABLED";
    btn.click();
    return "clicked";
  })()`);
}

await openDbWindow();
console.log("STRIPES:", await evaluate(`JSON.stringify({
  left: [...document.querySelectorAll('nav[data-stripe-side="left"] button')].map((b) => b.title),
  right: [...document.querySelectorAll('nav[data-stripe-side="right"] button')].map((b) => b.title),
  welcome: document.body.innerText.includes("欢迎使用"),
})`));

for (const t of ["mysql", "postgres"]) {
  console.log(`--- ${t} ---`);
  console.log("SWITCH:", await switchType(t));
  await sleep(400);
  console.log("FORM:", await probe());
  // Click 连接 (localhost has no server -> expect a connection error message)
  const clicked = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('[data-tool-window="database"] button')].find((b) => b.textContent.trim() === "连接");
    if (!btn || btn.disabled) return "NO/BTN-DISABLED";
    btn.click();
    return "clicked";
  })()`);
  console.log("CONNECT CLICK:", clicked);
  await sleep(3000);
  // Fill database name and connect for a REAL failure path (no server on localhost).
  console.log("FILL+CONNECT:", await fillDatabaseAndConnect("opc_probe_db"));
  await sleep(5000);
  console.log("AFTER CONNECT:", await probe());
}

ws.close();
process.exit(0);
